# AGENTS.md — packages/core

## Overview

Pure library package — no HTTP server, no DB. Provides provider abstraction, AI clients, review engine, template system, webhook event normalization, Mastra platform tools, and MCP server. Imported by `packages/server`.

## Structure

```
src/
  providers/
    types.ts      → GitProvider interface, ProviderConfig, ProviderError
    base.ts       → BaseProvider abstract (shared fetch, error handling)
    gitea.ts      → GiteaProvider | gitlab.ts → GitLabProvider | github.ts → GitHubProvider
    index.ts      → createProvider / createProviderFromEnv factory
  review/
    engine.ts     → ReviewEngine (544 lines — orchestrates AI review flow)
  ai/
    client.ts     → OpenCodeClient | direct-client.ts → DirectAIClient
    platform-agent.ts → createPlatformAgent (Mastra Agent with all platform tools)
    tools/platform/   → 8 Mastra tool files (template, repo, review, ai-config, webhook, system)
  mcp/
    server.ts     → MCP server wrapping all Mastra tools (stdio + HTTP transport)
  templates/      → Built-in system prompt templates + {{var}} renderer
  events/types.ts → WebhookEvent types, shouldTriggerReview()
  types.ts        → Shared domain types
```

## Key Abstractions

### Provider Pattern

```
GitProvider (interface) → BaseProvider (abstract) → GiteaProvider | GitLabProvider
```

- Factory: `createProvider(config)` selects by `config.type`; `createProviderFromEnv()` reads env vars
- Each provider implements: getPullRequestDiff, createReview, createLineComment, verifyWebhookSignature, parseWebhookEvent

### ReviewEngine

- Constructor picks `DirectAIClient` or `OpenCodeClient` based on config
- `executeReview(context)`: fetch diff → build prompts → call AI → parse response → submit review
- `parseAIResponse`: tries JSON.parse → JSON codeblock extraction → markdown regex fallback
- **Gotcha**: Markdown fallback uses regexes including Chinese headings — brittle parsing

### AI Clients

- `DirectAIClient`: POST to OpenAI-compatible `/chat/completions` endpoint
- `OpenCodeClient`: Uses `@opencode-ai/sdk` for agent-based review

### Platform Agent (Mastra)

- `createPlatformAgent(model, deps)` creates a Mastra Agent with all platform tools injected
- Tool domains: template, repo, review, AI config, webhook, system
- Each domain uses dependency injection (`*ToolDeps` interfaces) — no direct DB access
- `PlatformToolContext`: `{ db, userId, userRole }` passed to every tool

### MCP Server

- `createMcpPlatformServer(config)` wraps all Mastra tools as MCP protocol tools
- `registerMastraTool()` maps Mastra tool id/schema/execute → MCP tool format
- Two transports: `connectStdio()` for CLI, `createHttpTransport()` for web servers

## Where to Look

| Task                        | File                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Add a new git provider      | `providers/types.ts` (interface), create `providers/new.ts`, register in `providers/index.ts` |
| Change review prompt        | `templates/defaults.ts` + `review/engine.ts` (buildSystemPrompt/buildUserPrompt)              |
| Fix AI response parsing     | `review/engine.ts` → parseAIResponse, parseMarkdownResponse                                   |
| Add webhook event type      | `events/types.ts` → WebhookEvent union, shouldTriggerReview                                   |
| Change diff format          | Provider's `getPullRequestDiff` method                                                        |
| Add new platform tool       | Create `ai/tools/platform/new-tools.ts`, export from `platform/index.ts`                     |
| Modify MCP server behavior  | `mcp/server.ts` → registerMastraTool, createMcpPlatformServer                                |
| Change agent configuration  | `ai/platform-agent.ts` → createPlatformAgent                                                 |

## Gotchas

- No fetch timeouts — large diffs can hang indefinitely
- GitLab `assembleDiff` manually reconstructs unified diff — fragile for renames/binary
- `parseAIResponse` silently falls back to empty results on parse failure
- GitLab `createReview` loops network calls per line comment — partial reviews possible
- Provider `verifyWebhookSignature` implementations differ (HMAC vs token comparison)
