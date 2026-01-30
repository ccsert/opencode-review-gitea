/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./gitea-review.txt"

/**
 * Gitea/Forgejo Code Review Tool
 *
 * This MCP tool allows AI agents to submit code reviews on PRs.
 * It can create line-level comments and a summary review.
 *
 * Environment Variables:
 *   GITEA_TOKEN - API token for Gitea/Forgejo
 *   GITEA_SERVER_URL - Base URL (e.g., https://gitea.example.com)
 */

interface ReviewComment {
  path: string
  line: number
  body: string
  side?: "LEFT" | "RIGHT"
}

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
    
    // Check for permission errors and provide helpful message
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

export default tool({
  description: DESCRIPTION,
  args: {
    owner: tool.schema.string().describe("Repository owner"),
    repo: tool.schema.string().describe("Repository name"),
    pull_number: tool.schema.number().describe("Pull request number"),
    summary: tool.schema.string().describe("Overall review summary"),
    comments: tool.schema
      .array(
        tool.schema.object({
          path: tool.schema.string().describe("File path"),
          line: tool.schema.number().describe("Line number in the new file"),
          body: tool.schema.string().describe("Comment content"),
        }),
      )
      .optional()
      .describe("Line-level review comments"),
    approval: tool.schema
      .enum(["comment", "approve", "request_changes"])
      .optional()
      .default("comment")
      .describe("Review decision"),
  },
  async execute(args) {
    const { owner, repo, pull_number, summary, comments = [], approval = "comment" } = args

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

    // Format review comments for API - also process escaped characters in comments
    const reviewComments = comments.map((c) => ({
      path: c.path,
      body: c.body.replace(/\\n/g, "\n").replace(/\\t/g, "\t"),
      new_position: c.line,
    }))

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

    return `✅ Review submitted successfully!\n\n**Decision:** ${approval}\n**Comments:** ${comments.length} line comment(s)`
  },
})
