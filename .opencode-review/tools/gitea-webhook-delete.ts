/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { initI18n, t } from "./i18n"

/**
 * Gitea/Forgejo Webhook Delete Tool
 *
 * Deletes a webhook from a repository.
 * Fixes the "Repository has no access token configured" error by ensuring proper token handling.
 *
 * Environment Variables:
 *   GITEA_TOKEN - API token for Gitea/Forgejo (requires write:repository scope)
 *   GITEA_SERVER_URL - Base URL (e.g., https://gitea.example.com)
 *   REVIEW_LANGUAGE - Language for messages (auto | en | zh-CN)
 */

async function giteaFetch(endpoint: string, options: RequestInit = {}) {
  const baseUrl = process.env.GITEA_SERVER_URL || process.env.GITHUB_SERVER_URL
  const token = process.env.GITEA_TOKEN || process.env.GITHUB_TOKEN

  if (!baseUrl) throw new Error("GITEA_SERVER_URL environment variable is required")
  if (!token) {
    initI18n()
    throw new Error(t("webhook.delete.token_missing"))
  }

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
    initI18n()
    
    if (response.status === 401) {
      throw new Error(t("webhook.errors.invalid_token"))
    }
    if (response.status === 403) {
      throw new Error(t("webhook.delete.permission_denied_details"))
    }
    if (response.status === 404) {
      throw new Error(t("webhook.errors.not_found"))
    }
    
    throw new Error(t("webhook.errors.server_error", { error: `${response.status} ${text}` }))
  }

  // Handle 204 No Content response
  if (response.status === 204) {
    return null
  }

  return response.json()
}

export default tool({
  description: "Delete a webhook from a Gitea/Forgejo repository. Requires repository write permissions and proper access token configuration.",
  args: {
    owner: tool.schema.string().describe("Repository owner"),
    repo: tool.schema.string().describe("Repository name"),
    webhook_id: tool.schema.number().describe("Webhook ID to delete"),
  },
  async execute(args) {
    const { owner, repo, webhook_id } = args
    
    initI18n()

    try {
      // Verify webhook exists first
      await giteaFetch(`/repos/${owner}/${repo}/hooks/${webhook_id}`)
      
      // Delete the webhook
      await giteaFetch(`/repos/${owner}/${repo}/hooks/${webhook_id}`, {
        method: "DELETE",
      })

      return `${t("webhook.delete.success")} (ID: ${webhook_id})`
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return t("webhook.delete.error", { error: errorMsg })
    }
  },
})
