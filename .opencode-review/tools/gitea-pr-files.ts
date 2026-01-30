/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"

/**
 * Gitea/Forgejo PR Files Tool
 *
 * This MCP tool fetches the list of changed files in a pull request.
 * Useful for filtering which files to review.
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
      Accept: "application/json",
      ...options.headers,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Gitea API error: ${response.status} ${response.statusText} - ${text}`)
  }

  return response.json()
}

interface ChangedFile {
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
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

function filterFiles(files: ChangedFile[], patterns: string[]): ChangedFile[] {
  if (!patterns || patterns.length === 0) {
    return files
  }
  
  return files.filter(file => 
    patterns.some(pattern => matchPattern(file.filename, pattern))
  )
}

const DESCRIPTION = `List all files changed in a Gitea/Forgejo pull request.

This tool returns a summary of all changed files with their status (added/modified/deleted) and line counts.

Use this tool to:
- Get an overview of what files were changed in a PR
- Filter files by pattern before fetching the full diff
- Understand the scope of changes

The output includes:
- File path
- Status (added, modified, deleted, renamed)
- Lines added/deleted

Use the file_patterns parameter to filter results by glob patterns (e.g., "*.ts", "src/**/*.go").`

export default tool({
  description: DESCRIPTION,
  args: {
    owner: tool.schema.string().describe("Repository owner"),
    repo: tool.schema.string().describe("Repository name"),
    pull_number: tool.schema.number().describe("Pull request number"),
    file_patterns: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Optional glob patterns to filter files (e.g., ['*.ts', 'src/**/*.go'])"),
  },
  async execute(args) {
    const { owner, repo, pull_number, file_patterns } = args

    const files: ChangedFile[] = await giteaFetch(`/repos/${owner}/${repo}/pulls/${pull_number}/files`)
    
    const filteredFiles = filterFiles(files, file_patterns || [])
    
    // Build summary
    const stats = {
      total: filteredFiles.length,
      added: filteredFiles.filter(f => f.status === "added").length,
      modified: filteredFiles.filter(f => f.status === "modified" || f.status === "changed").length,
      deleted: filteredFiles.filter(f => f.status === "deleted" || f.status === "removed").length,
      renamed: filteredFiles.filter(f => f.status === "renamed").length,
    }
    
    const totalAdditions = filteredFiles.reduce((sum, f) => sum + (f.additions || 0), 0)
    const totalDeletions = filteredFiles.reduce((sum, f) => sum + (f.deletions || 0), 0)
    
    // Format output
    const lines: string[] = [
      `# PR #${pull_number} Changed Files`,
      "",
      `**Total:** ${stats.total} file(s) | +${totalAdditions} -${totalDeletions}`,
    ]
    
    if (file_patterns && file_patterns.length > 0) {
      lines.push(`**Filter:** ${file_patterns.join(", ")}`)
      lines.push(`**Matched:** ${filteredFiles.length} of ${files.length} files`)
    }
    
    lines.push("")
    lines.push("| Status | File | Changes |")
    lines.push("|--------|------|---------|")
    
    for (const file of filteredFiles) {
      const statusIcon = {
        added: "🆕",
        modified: "📝",
        changed: "📝",
        deleted: "🗑️",
        removed: "🗑️",
        renamed: "📋",
      }[file.status] || "📄"
      
      lines.push(`| ${statusIcon} ${file.status} | \`${file.filename}\` | +${file.additions || 0} -${file.deletions || 0} |`)
    }
    
    return lines.join("\n")
  },
})
