/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import { initI18n, t } from "./i18n"

/**
 * Gitea/Forgejo Webhook Create Tool
 *
 * Creates a new webhook for a repository.
 *
 * Environment Variables:
 *   GITEA_TOKEN - API token for Gitea/Forgejo (requires write:repository scope)
 *   GITEA_SERVER_URL - Base URL (e.g., https://gitea.example.com)
 *   REVIEW_LANGUAGE - Language for messages (auto | en | zh-CN)
 */

interface CreateWebhookRequest {
  type: string
  config: {
    url: string
    content_type: string
    secret?: string
  }
  events: string[]
  active: boolean
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
    
    throw new Error(t("webhook.errors.server_error", { error: `${response.status} ${text}` }))
  }

  return response.json()
}

export default tool({
  description: "Create a new webhook for a Gitea/Forgejo repository. Requires repository write permissions.",
  args: {
    owner: tool.schema.string().describe("Repository owner"),
    repo: tool.schema.string().describe("Repository name"),
    url: tool.schema.string().describe("Webhook URL (e.g., https://example.com/webhook)"),
    content_type: tool.schema
      .enum(["json", "form"])
      .optional()
      .default("json")
      .describe("Content type for webhook payload"),
    secret: tool.schema.string().optional().describe("Secret for webhook signature validation"),
    events: tool.schema
      .array(tool.schema.string())
      .optional()
      .default(["push"])
      .describe("Events that trigger the webhook (e.g., push, pull_request, issue_comment)"),
    active: tool.schema.boolean().optional().default(true).describe("Whether the webhook is active"),
  },
  async execute(args) {
    const { owner, repo, url, content_type = "json", secret, events = ["push"], active = true } = args
    
    initI18n()

    try {
      const payload: CreateWebhookRequest = {
        type: "gitea",
        config: {
          url,
          content_type,
          ...(secret && { secret }),
        },
        events,
        active,
      }

      const webhook = await giteaFetch(`/repos/${owner}/${repo}/hooks`, {
        method: "POST",
        body: JSON.stringify(payload),
      })

      const status = webhook.active ? t("webhook.list.status.active") : t("webhook.list.status.inactive")
      return `${t("webhook.create.success")}

**Webhook #${webhook.id}**
- URL: ${webhook.config.url}
- Status: ${status}
- Events: ${webhook.events.join(", ")}
- Content Type: ${webhook.config.content_type}`
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      return t("webhook.create.error", { error: errorMsg })
    }
  },
})
