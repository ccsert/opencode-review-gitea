/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./gitea-review.txt"

/**
 * Gitea/Forgejo Code Review Tool
 *
 * This MCP tool allows AI agents to submit code reviews on PRs.
 * The AI generates the summary and comments, this tool just submits them.
 *
 * Environment Variables:
 *   GITEA_TOKEN - API token for Gitea/Forgejo
 *   GITEA_SERVER_URL - Base URL (e.g., https://gitea.example.com)
 */

interface ReviewRequest {
  body: string
  event: "COMMENT" | "APPROVED" | "REQUEST_CHANGES"
  commit_id?: string
  comments?: Array<{
    path: string
    body: string
    new_position?: number
    old_position?: number
  }>
}

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
      "Content-Type": "application/json",
      ...options.headers,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    
    if (response.status === 403 || text.includes("required scope")) {
      throw new Error(
        `Gitea API permission error: Your token lacks required permissions.\n` +
        `Required: write:repository scope\n` +
        `Please create a new token with write:repository permission in Gitea Settings → Applications → Access Tokens\n` +
        `Original error: ${text}`
      )
    }
    
    throw new Error(`Gitea API error: ${response.status} ${response.statusText} - ${text}`)
  }

  return response.json()
}

/**
 * Review Tag Categories and Severities
 * Used for structured review comments that can be parsed for statistics
 * 
 * Format: [CATEGORY:SEVERITY] message
 * 
 * Categories:
 *   - BUG: Logic errors, null access, race conditions
 *   - SECURITY: SQL injection, XSS, auth issues, hardcoded secrets
 *   - PERFORMANCE: N+1 queries, memory leaks, inefficient algorithms
 *   - STYLE: Naming, formatting, code organization
 *   - DOCS: Missing or incorrect documentation
 *   - TEST: Missing tests, test quality issues
 * 
 * Severities:
 *   - CRITICAL: Must fix before merge
 *   - HIGH: Should fix before merge
 *   - MEDIUM: Recommended to fix
 *   - LOW: Nice to have, optional
 */
export const REVIEW_CATEGORIES = ["BUG", "SECURITY", "PERFORMANCE", "STYLE", "DOCS", "TEST"] as const
export const REVIEW_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const

export type ReviewCategory = typeof REVIEW_CATEGORIES[number]
export type ReviewSeverity = typeof REVIEW_SEVERITIES[number]

/**
 * Format a structured review tag
 */
export function formatReviewTag(category: ReviewCategory, severity: ReviewSeverity): string {
  return `**[${category}:${severity}]**`
}

/**
 * Parse a review comment to extract category and severity
 */
export function parseReviewTag(body: string): { category?: ReviewCategory; severity?: ReviewSeverity } | null {
  const match = body.match(/\*?\*?\[([A-Z]+):([A-Z]+)\]\*?\*?/)
  if (!match) return null
  
  const category = match[1] as ReviewCategory
  const severity = match[2] as ReviewSeverity
  
  if (REVIEW_CATEGORIES.includes(category) && REVIEW_SEVERITIES.includes(severity)) {
    return { category, severity }
  }
  return null
}

/**
 * Format a comment with optional suggestion block
 */
export function formatCommentBody(body: string, suggestion?: string): string {
  if (!suggestion) return body
  
  const trimmedBody = body.trimEnd()
  
  return `${trimmedBody}

\`\`\`suggestion
${suggestion}
\`\`\`
`
}

// ═══════════════════════════════════════════════════════════════
// MAIN TOOL EXPORT
// ═══════════════════════════════════════════════════════════════

export default tool({
  description: DESCRIPTION,
  args: {
    owner: tool.schema.string().describe("Repository owner"),
    repo: tool.schema.string().describe("Repository name"),
    pull_number: tool.schema.number().describe("Pull request number"),
    summary: tool.schema.string().describe("Review summary/report content. This is the main review body that will be displayed. AI should generate a complete, well-formatted summary including overview, key findings, file table, etc."),
    comments: tool.schema
      .array(
        tool.schema.object({
          path: tool.schema.string().describe("File path"),
          line: tool.schema.number().optional().describe("Line number in the NEW file (for added/context lines). Use this OR old_line, not both."),
          old_line: tool.schema.number().optional().describe("Line number in the OLD file (for deleted lines). Use this OR line, not both."),
          body: tool.schema.string().describe("Comment content. Use structured tags like **[BUG:HIGH]** or **[SECURITY:CRITICAL]** for categorization."),
          suggestion: tool.schema.string().optional().describe("Optional: Suggested replacement code. Will create a one-click applicable suggestion block in Gitea."),
        }),
      )
      .optional()
      .describe("Line-level review comments. Use 'line' for new/context lines, 'old_line' for deleted lines. Include 'suggestion' for auto-fix proposals."),
    approval: tool.schema
      .enum(["comment", "approve", "request_changes"])
      .optional()
      .default("comment")
      .describe("Review decision"),
  },
  async execute(args) {
    const { 
      owner, 
      repo, 
      pull_number, 
      summary, 
      comments = [], 
      approval = "comment",
    } = args

    // Map approval to Gitea event type
    const eventMap: Record<string, "COMMENT" | "APPROVED" | "REQUEST_CHANGES"> = {
      comment: "COMMENT",
      approve: "APPROVED",
      request_changes: "REQUEST_CHANGES",
    }
    const event = eventMap[approval] || "COMMENT"

    // Get PR info for commit SHA
    const pr = await giteaFetch(`/repos/${owner}/${repo}/pulls/${pull_number}`)
    const commitId = pr.head?.sha

    // Process summary - convert escaped newlines to actual newlines
    const processedSummary = summary
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")

    // Format review comments for API
    const reviewComments = comments.map((c) => {
      const processedBody = c.body.replace(/\\n/g, "\n").replace(/\\t/g, "\t")
      const processedSuggestion = c.suggestion?.replace(/\\n/g, "\n").replace(/\\t/g, "\t")
      const finalBody = formatCommentBody(processedBody, processedSuggestion)
      
      const comment: {
        path: string
        body: string
        new_position?: number
        old_position?: number
      } = {
        path: c.path,
        body: finalBody,
      }
      
      if (c.old_line !== undefined && c.old_line > 0) {
        comment.old_position = c.old_line
        comment.new_position = 0
      } else if (c.line !== undefined && c.line > 0) {
        comment.new_position = c.line
        comment.old_position = 0
      }
      
      return comment
    })

    // Count suggestions
    const suggestionCount = comments.filter(c => c.suggestion).length

    // Create the review
    const reviewPayload: ReviewRequest = {
      body: processedSummary,
      event,
      commit_id: commitId,
      comments: reviewComments.length > 0 ? reviewComments : undefined,
    }

    await giteaFetch(`/repos/${owner}/${repo}/pulls/${pull_number}/reviews`, {
      method: "POST",
      body: JSON.stringify(reviewPayload),
    })

    const suggestionMsg = suggestionCount > 0 ? ` | 💡 ${suggestionCount} auto-fix` : ""
    return `✅ Review submitted successfully!\n\n**Decision:** ${approval} | **Comments:** ${comments.length}${suggestionMsg}`
  },
})
