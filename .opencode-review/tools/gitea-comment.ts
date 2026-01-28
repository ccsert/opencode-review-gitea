/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./gitea-comment.txt"

/**
 * Gitea/Forgejo Comment Tool
 *
 * This MCP tool allows AI agents to post comments on issues and PRs.
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
      "Content-Type": "application/json",
      ...options.headers,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Gitea API error: ${response.status} ${response.statusText} - ${text}`)
  }

  return response.json()
}

export default tool({
  description: DESCRIPTION,
  args: {
    owner: tool.schema.string().describe("Repository owner"),
    repo: tool.schema.string().describe("Repository name"),
    issue_number: tool.schema.number().describe("Issue or PR number"),
    body: tool.schema.string().describe("Comment content (supports Markdown)"),
  },
  async execute(args) {
    const { owner, repo, issue_number, body } = args

    await giteaFetch(`/repos/${owner}/${repo}/issues/${issue_number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    })

    return `✅ Comment posted successfully on #${issue_number}`
  },
})
