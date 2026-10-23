import { tool } from "@opencode-ai/plugin"
import { GiteaClient, prPath } from "../lib/gitea"
import { filterFilesByPatterns } from "../lib/diff"

interface ChangedFile {
  filename: string
  status: string
  additions: number
  deletions: number
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

Use the file_patterns parameter to filter results by glob patterns (e.g., "*.ts", "src/**/*.go").
A pattern without "/" matches file names at any depth.`

const STATUS_ICONS: Record<string, string> = {
  added: "🆕", modified: "📝", changed: "📝", deleted: "🗑️", removed: "🗑️", renamed: "📋",
}

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
    const patterns = args.file_patterns?.filter(Boolean) ?? []
    // The endpoint is paginated (30 rows by default); a partial list hides files from review.
    const files = await new GiteaClient().list<ChangedFile>(`${prPath(args)}/files`)
    const matched = filterFilesByPatterns(files.map(file => ({ ...file, path: file.filename })), patterns)
    const additions = matched.reduce((sum, file) => sum + (file.additions || 0), 0)
    const deletions = matched.reduce((sum, file) => sum + (file.deletions || 0), 0)
    const lines = [
      `# PR #${args.pull_number} Changed Files`,
      "",
      `**Total:** ${matched.length} file(s) | +${additions} -${deletions}`,
    ]
    if (patterns.length) {
      lines.push(`**Filter:** ${patterns.join(", ")}`, `**Matched:** ${matched.length} of ${files.length} files`)
    }
    lines.push("", "| Status | File | Changes |", "|--------|------|---------|")
    for (const file of matched) {
      lines.push(`| ${STATUS_ICONS[file.status] || "📄"} ${file.status} | \`${file.filename}\` | +${file.additions || 0} -${file.deletions || 0} |`)
    }
    return lines.join("\n")
  },
})
