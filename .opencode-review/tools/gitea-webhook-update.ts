/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { initI18n, t } from "./i18n"

/**
 * Gitea/Forgejo Webhook Update Tool
 *
 * Updates an existing webhook in a repository.
 *
 * Environment Variables:
 *   GITEA_TOKEN - API token for Gitea/Forgejo (requires write:repository scope)
 *   GITEA_SERVER_URL - Base URL (e.g., https://gitea.example.com)
 *   REVIEW_LANGUAGE - Language for messages (auto | en | zh-CN)
 */

interface UpdateWebhookRequest {
  config?: {
    url?: string
    content_type?: string
    secret?: string
  }
  events?: string[]
  active?: boolean
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
  description: "Update an existing webhook in a Gitea/Forgejo repository. Requires repository write permissions.",
  args: {
    owner: tool.schema.string().describe("Repository owner"),
    repo: tool.schema.string().describe("Repository name"),
    webhook_id: tool.schema.number().describe("Webhook ID to update"),
    url: tool.schema.string().optional().describe("New webhook URL"),
    content_type: tool.schema
      .enum(["json", "form"])
      .optional()
      .describe("New content type for webhook payload"),
    secret: tool.schema.string().optional().describe("New secret for webhook signature validation"),
    events: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("New events that trigger the webhook"),
    active: tool.schema.boolean().optional().describe("Whether the webhook is active"),
  },
  async execute(args) {
    const { owner, repo, webhook_id, url, content_type, secret, events, active } = args
    
    initI18n()

    try {
      // Get current webhook configuration
      const currentWebhook = await giteaFetch(`/repos/${owner}/${repo}/hooks/${webhook_id}`)
      
      // Build update payload with only changed fields
      const payload: UpdateWebhookRequest = {
        config: {
          ...currentWebhook.config,
          ...(url && { url }),
          ...(content_type && { content_type }),
          ...(secret !== undefined && { secret }),
        },
        ...(events && { events }),
        ...(active !== undefined && { active }),
      }

      const webhook = await giteaFetch(`/repos/${owner}/${repo}/hooks/${webhook_id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      })

      const status = webhook.active ? t("webhook.list.status.active") : t("webhook.list.status.inactive")
      return `${t("webhook.update.success")}

**Webhook #${webhook.id}**
- URL: ${webhook.config.url}
- Status: ${status}
- Events: ${webhook.events.join(", ")}
- Content Type: ${webhook.config.content_type}`
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return t("webhook.update.error", { error: errorMsg })
    }
  },
})
