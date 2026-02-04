/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { initI18n, t } from "./i18n"

/**
 * Gitea/Forgejo Webhook List Tool
 *
 * Lists all webhooks configured for a repository.
 * Uses real-time querying instead of database persistence.
 *
 * Environment Variables:
 *   GITEA_TOKEN - API token for Gitea/Forgejo
 *   GITEA_SERVER_URL - Base URL (e.g., https://gitea.example.com)
 *   REVIEW_LANGUAGE - Language for messages (auto | en | zh-CN)
 */

interface Webhook {
  id: number
  type: string
  config: {
    url: string
    content_type: string
    secret?: string
  }
  events: string[]
  active: boolean
  created_at: string
  updated_at: string
}

async function giteaFetch(endpoint: string, options: RequestInit = {}) {
  const baseUrl = process.env.GITEA_SERVER_URL || process.env.GITHUB_SERVER_URL
  const token = process.env.GITEA_TOKEN || process.env.GITHUB_TOKEN

  if (!baseUrl) throw new Error("GITEA_SERVER_URL environment variable is required")
  if (!token) {
    initI18n()
    throw new Error(t("webhook.errors.no_token"))
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
      throw new Error(t("webhook.errors.permission_denied"))
    }
    if (response.status === 404) {
      throw new Error(t("webhook.errors.not_found"))
    }
    
    throw new Error(t("webhook.errors.server_error", { error: `${response.status} ${text}` }))
  }

  return response.json()
}

export default tool({
  description: "List all webhooks for a Gitea/Forgejo repository. Queries webhooks in real-time from Gitea API, including both automatically created and manually configured webhooks.",
  args: {
    owner: tool.schema.string().describe("Repository owner"),
    repo: tool.schema.string().describe("Repository name"),
  },
  async execute(args) {
    const { owner, repo } = args
    
    initI18n()

    try {
      // Query webhooks from Gitea API
      const webhooks: Webhook[] = await giteaFetch(`/repos/${owner}/${repo}/hooks`)

      if (webhooks.length === 0) {
        return t("webhook.list.empty")
      }

      // Format webhook information
      const webhookList = webhooks.map((webhook) => {
        const status = webhook.active ? t("webhook.list.status.active") : t("webhook.list.status.inactive")
        const events = webhook.events.join(", ")
        
        return `
**Webhook #${webhook.id}**
- URL: ${webhook.config.url}
- Status: ${status}
- Events: ${events}
- Content Type: ${webhook.config.content_type}
- Created: ${webhook.created_at}
- Updated: ${webhook.updated_at}
        `.trim()
      }).join("\n\n")

      return `${t("webhook.list.title")} (${webhooks.length})\n\n${webhookList}`
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return t("webhook.list.error", { error: errorMsg })
    }
  },
})
