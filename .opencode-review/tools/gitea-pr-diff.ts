/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./gitea-pr-diff.txt"

/**
 * Gitea/Forgejo PR Diff Tool
 *
 * This MCP tool fetches the diff for a pull request.
 *
 * Environment Variables:
 *   GITEA_TOKEN - API token for Gitea/Forgejo
 *   GITEA_SERVER_URL - Base URL (e.g., https://gitea.example.com)
 */

async function giteaFetch(endpoint: string, options: RequestInit = {}) {
  const baseUrl = process.env.GITEA_SERVER_URL || process.env.GITHUB_SERVER_URL
  const token = process.env.GITEA_TOKEN || process.env.GITHUB_TOKEN

  if (!baseUrl) throw new Error("GITEA_SERVER_URL environment variable is required")
  if (!token) throw new Error("GITEA_TOKEN environment variable is required")

  const url = `${baseUrl}/api/v1${endpoint}`
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      ...options.headers,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Gitea API error: ${response.status} ${response.statusText} - ${text}`)
  }

  return response
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

    // Look for file header
    if (line.startsWith("diff --git")) {
      const pathMatch = line.match(/b\/(.+)$/)
      const path = pathMatch ? pathMatch[1] : "unknown"

      // Determine status
      let status = "modified"
      while (i < lines.length && !lines[i].startsWith("@@")) {
        if (lines[i].startsWith("new file")) status = "added"
        else if (lines[i].startsWith("deleted file")) status = "deleted"
        else if (lines[i].startsWith("rename")) status = "renamed"
        i++
      }

      const hunks: ParsedHunk[] = []

      // Parse hunks
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
      parts.push(`@@ starting at line ${hunk.newStart} @@`)

      for (const change of hunk.changes) {
        if (change.type === "add") {
          parts.push(`[${change.newLine}] +${change.content}`)
        } else if (change.type === "del") {
          parts.push(`[DEL] -${change.content}`)
        } else {
          parts.push(`[${change.newLine}]  ${change.content}`)
        }
      }
      parts.push("")
    }
  }

  return parts.join("\n")
}

function matchPattern(filename: string, pattern: string): boolean {
  // Convert glob pattern to regex
  // Supports: *, **, ?, [abc], [!abc]
  const regexPattern = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*")
    .replace(/\?/g, ".")
  
  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(filename)
}

function filterFilesByPatterns(files: ParsedFile[], patterns: string[]): ParsedFile[] {
  if (!patterns || patterns.length === 0) {
    return files
  }
  
  return files.filter(file => 
    patterns.some(pattern => matchPattern(file.path, pattern))
  )
}

function formatAsRawDiff(files: ParsedFile[]): string {
  // Reconstruct a simplified raw diff from parsed files
  const parts: string[] = []
  
  for (const file of files) {
    parts.push(`diff --git a/${file.path} b/${file.path}`)
    
    for (const hunk of file.hunks) {
      parts.push(`@@ -${hunk.oldStart},0 +${hunk.newStart},0 @@`)
      
      for (const change of hunk.changes) {
        if (change.type === "add") {
          parts.push(`+${change.content}`)
        } else if (change.type === "del") {
          parts.push(`-${change.content}`)
        } else {
          parts.push(` ${change.content}`)
        }
      }
    }
    parts.push("")
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
    file_patterns: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Optional glob patterns to filter files (e.g., ['*.ts', 'src/**/*.go']). Only matching files will be included in the diff."),
  },
  async execute(args) {
    const { owner, repo, pull_number, format = "parsed", file_patterns } = args

    const response = await giteaFetch(`/repos/${owner}/${repo}/pulls/${pull_number}.diff`, {
      headers: { Accept: "text/plain" },
    })
    const diffText = await response.text()

    let parsed = parseDiff(diffText)
    
    // Apply file filtering if patterns provided
    if (file_patterns && file_patterns.length > 0) {
      parsed = filterFilesByPatterns(parsed, file_patterns)
    }

    if (format === "raw") {
      // For raw format with filtering, we reconstruct from parsed
      if (file_patterns && file_patterns.length > 0) {
        return formatAsRawDiff(parsed)
      }
      return diffText
    }

    const formatted = formatDiffForReview(parsed)

    const summary = parsed.map((f) => `- ${f.path} (${f.status})`).join("\n")
    
    const filterNote = file_patterns && file_patterns.length > 0 
      ? `\n**Filter:** ${file_patterns.join(", ")}\n` 
      : ""

    return `# PR #${pull_number} Diff\n${filterNote}\n**Files Changed:**\n${summary}\n\n---\n${formatted}`
  },
})
