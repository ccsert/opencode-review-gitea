/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./gitea-incremental-diff.txt"

/**
 * Gitea/Forgejo Incremental PR Diff Tool
 *
 * This MCP tool fetches only the incremental diff for a pull request,
 * showing changes since the last review.
 *
 * Environment Variables:
 *   GITEA_TOKEN - API token for Gitea/Forgejo
 *   GITEA_SERVER_URL - Base URL (e.g., https://gitea.example.com)
 */

interface Commit {
  sha: string
  created: string
  commit: {
    message: string
    author: {
      date: string
    }
  }
}

interface Review {
  id: number
  user: {
    login: string
  }
  commit_id: string
  submitted_at: string
  state: string
}

interface PRInfo {
  head: {
    sha: string
  }
  base: {
    sha: string
  }
  merged: boolean
}

async function giteaFetch(endpoint: string, options: RequestInit = {}) {
  const baseUrl = process.env.GITEA_SERVER_URL || process.env.GITHUB_SERVER_URL
  const token = process.env.GITEA_TOKEN || process.env.GITHUB_TOKEN

  if (!baseUrl) throw new Error("GITEA_SERVER_URL environment variable is required")
  if (!token) throw new Error("GITEA_TOKEN environment variable is required")

  const url = `${baseUrl}/api/v1${endpoint}`
  
  // Build headers properly
  const headers: Record<string, string> = {
    Authorization: `token ${token}`,
    Accept: "application/json",
  }
  
  // Override Accept if provided in options
  if (options.headers) {
    const optHeaders = options.headers as Record<string, string>
    if (optHeaders.Accept) {
      headers.Accept = optHeaders.Accept
    }
  }
  
  const response = await fetch(url, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Gitea API error: ${response.status} ${response.statusText} - ${text}`)
  }

  return response
}

async function giteaFetchJson<T>(endpoint: string): Promise<T> {
  const response = await giteaFetch(endpoint)
  return response.json() as Promise<T>
}

async function giteaFetchText(endpoint: string): Promise<string> {
  const response = await giteaFetch(endpoint, {
    headers: { Accept: "text/plain" },
  })
  return response.text()
}

// Identify bot reviews by checking for our review marker
const BOT_REVIEW_MARKER = "<!-- opencode-review -->"

function isBotReview(review: Review): boolean {
  // Check if review was made by a bot-like user or contains our marker
  // Since we can't easily identify our own reviews, we look for any APPROVED or REQUEST_CHANGES
  // reviews that have a commit_id
  return Boolean(review.commit_id && review.commit_id.length > 0 && 
         (review.state === "APPROVED" || review.state === "REQUEST_CHANGES" || review.state === "COMMENT"))
}

function findLastReviewedCommit(reviews: Review[], commits: Commit[]): string | null {
  if (!reviews || reviews.length === 0) return null
  
  // Get commit SHAs in order
  const commitShas = new Set(commits.map(c => c.sha))
  
  // Find the most recent review with a valid commit_id
  const validReviews = reviews
    .filter(r => r.commit_id && commitShas.has(r.commit_id))
    .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())
  
  return validReviews.length > 0 ? validReviews[0].commit_id : null
}

function findCommitsAfter(commits: Commit[], afterSha: string | null): Commit[] {
  if (!afterSha) return commits
  
  const afterIndex = commits.findIndex(c => c.sha === afterSha)
  if (afterIndex === -1) {
    // Commit not found - likely rebased, return all
    return commits
  }
  
  // Return commits after the found one (commits are usually in chronological order)
  return commits.slice(afterIndex + 1)
}

interface ParsedChange {
  type: "add" | "del" | "normal"
  content: string
  oldLine?: number
  newLine?: number
}

interface ParsedHunk {
  oldStart: number
  newStart: number
  changes: ParsedChange[]
}

interface ParsedFile {
  path: string
  status: string
  hunks: ParsedHunk[]
}

function parseDiff(diffText: string): ParsedFile[] {
  const files: ParsedFile[] = []
  const lines = diffText.split("\n")
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith("diff --git")) {
      const pathMatch = line.match(/b\/(.+)$/)
      const path = pathMatch ? pathMatch[1] : "unknown"

      let status = "modified"
      while (i < lines.length && !lines[i].startsWith("@@")) {
        if (lines[i].startsWith("new file")) status = "added"
        else if (lines[i].startsWith("deleted file")) status = "deleted"
        else if (lines[i].startsWith("rename")) status = "renamed"
        i++
      }

      const hunks: ParsedHunk[] = []

      while (i < lines.length && !lines[i].startsWith("diff --git")) {
        if (lines[i].startsWith("@@")) {
          const hunkMatch = lines[i].match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
          if (hunkMatch) {
            const oldStart = parseInt(hunkMatch[1], 10)
            const newStart = parseInt(hunkMatch[2], 10)
            const changes: ParsedChange[] = []
            let oldLine = oldStart
            let newLine = newStart

            i++
            while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff --git")) {
              const content = lines[i].slice(1)
              if (lines[i].startsWith("+")) {
                changes.push({ type: "add", content, newLine: newLine++ })
              } else if (lines[i].startsWith("-")) {
                changes.push({ type: "del", content, oldLine: oldLine++ })
              } else if (lines[i].startsWith(" ")) {
                changes.push({ type: "normal", content, oldLine: oldLine++, newLine: newLine++ })
              }
              i++
            }

            hunks.push({ oldStart, newStart, changes })
          } else {
            i++
          }
        } else {
          i++
        }
      }

      files.push({ path, status, hunks })
    } else {
      i++
    }
  }

  return files
}

function formatDiffForReview(files: ParsedFile[]): string {
  const parts: string[] = []

  for (const file of files) {
    parts.push(`\n## ${file.path} (${file.status})\n`)

    for (const hunk of file.hunks) {
      parts.push(`@@ starting at line ${hunk.newStart} (old: ${hunk.oldStart}) @@`)

      for (const change of hunk.changes) {
        if (change.type === "add") {
          parts.push(`[NEW:${change.newLine}] +${change.content}`)
        } else if (change.type === "del") {
          parts.push(`[OLD:${change.oldLine}] -${change.content}`)
        } else {
          parts.push(`[NEW:${change.newLine}]  ${change.content}`)
        }
      }
      parts.push("")
    }
  }

  return parts.join("\n")
}

export default tool({
  description: DESCRIPTION,
  args: {
    owner: tool.schema.string().describe("Repository owner"),
    repo: tool.schema.string().describe("Repository name"),
    pull_number: tool.schema.number().describe("Pull request number"),
    format: tool.schema
      .enum(["raw", "parsed"])
      .optional()
      .default("parsed")
      .describe("Output format: 'raw' for unified diff, 'parsed' for line-numbered format"),
  },
  async execute(args) {
    const { owner, repo, pull_number, format = "parsed" } = args

    // 1. Get PR info
    const pr = await giteaFetchJson<PRInfo>(`/repos/${owner}/${repo}/pulls/${pull_number}`)
    
    // 2. Get all commits in the PR
    const commits = await giteaFetchJson<Commit[]>(`/repos/${owner}/${repo}/pulls/${pull_number}/commits`)
    
    // 3. Get all reviews
    const reviews = await giteaFetchJson<Review[]>(`/repos/${owner}/${repo}/pulls/${pull_number}/reviews`)
    
    // 4. Find last reviewed commit
    const lastReviewedCommit = findLastReviewedCommit(reviews, commits)
    
    // 5. Determine new commits
    const newCommits = findCommitsAfter(commits, lastReviewedCommit)
    
    // Build status message
    let statusMessage = ""
    let diffText = ""
    
    if (!lastReviewedCommit) {
      // First review - get full diff
      statusMessage = "📋 **First Review** - Showing full PR diff\n"
      diffText = await giteaFetchText(`/repos/${owner}/${repo}/pulls/${pull_number}.diff`)
    } else if (newCommits.length === 0) {
      // No new commits
      return `✅ **No New Changes**\n\nThe PR has not been updated since the last review (commit \`${lastReviewedCommit.slice(0, 7)}\`).\n\nNo review needed.`
    } else if (newCommits.length === commits.length) {
      // All commits are "new" - likely rebased
      statusMessage = `⚠️ **Rebase Detected** - PR appears to have been rebased.\n\nShowing full PR diff for complete re-review.\n\n`
      diffText = await giteaFetchText(`/repos/${owner}/${repo}/pulls/${pull_number}.diff`)
    } else {
      // Incremental review
      const newCommitShas = newCommits.map(c => c.sha.slice(0, 7)).join(", ")
      statusMessage = `🔄 **Incremental Review**\n\n` +
        `- Last reviewed: \`${lastReviewedCommit.slice(0, 7)}\`\n` +
        `- New commits (${newCommits.length}): ${newCommitShas}\n` +
        `- Current HEAD: \`${pr.head.sha.slice(0, 7)}\`\n\n`
      
      // Try to get incremental diff using compare
      try {
        diffText = await giteaFetchText(`/repos/${owner}/${repo}/compare/${lastReviewedCommit}...${pr.head.sha}.diff`)
      } catch (error) {
        // Fallback: get individual commit diffs
        statusMessage += `> Note: Using individual commit diffs as fallback\n\n`
        const diffs: string[] = []
        for (const commit of newCommits) {
          try {
            const commitDiff = await giteaFetchText(`/repos/${owner}/${repo}/git/commits/${commit.sha}.diff`)
            diffs.push(commitDiff)
          } catch {
            // Skip if commit diff not available
          }
        }
        diffText = diffs.join("\n")
      }
    }
    
    if (!diffText || diffText.trim() === "") {
      return `${statusMessage}⚠️ No diff content available.`
    }
    
    const parsed = parseDiff(diffText)
    
    if (format === "raw") {
      return `${statusMessage}---\n\n${diffText}`
    }
    
    const formatted = formatDiffForReview(parsed)
    const summary = parsed.map((f) => `- ${f.path} (${f.status})`).join("\n")
    
    return `# PR #${pull_number} Incremental Diff\n\n${statusMessage}**Files Changed:**\n${summary}\n\n---\n${formatted}`
  },
})
