# AGENTS.md — packages/server

## Overview

Hono HTTP API server on Bun runtime. Drizzle ORM with PGlite. Handles auth, webhook reception, review orchestration, agent runtime, and multi-protocol agent endpoints (A2A, AG-UI, MCP). Imports `@opencode-review/core` directly.

## Structure

```
src/
  index.ts           → Hono app setup, Bun.serve, middleware chain, route mounting
  routes/
    auth.ts           → Login, register, refresh token, user management
    repos.ts          → Repository CRUD, webhook auto-registration, import (894 lines)
    reviews.ts        → Review listing, detail, stats
    webhooks.ts       → Webhook receiver, signature verify, review trigger
    templates.ts      → Review template CRUD
    platforms.ts      → Platform connection CRUD (722 lines)
    ai-providers.ts   → AI provider config CRUD + connection test (525 lines)
    api-keys.ts       → API key management (498 lines)
    system.ts         → System info, health check
    a2a.ts            → A2A protocol — JSON-RPC 2.0, tasks/send/get/cancel, Agent Card (578 lines)
    agui.ts           → AG-UI SSE — CopilotKit runtime + raw AG-UI streaming (315 lines)
    mcp.ts            → MCP HTTP proxy — stateless per-request MCP server (43 lines)
    agent-threads.ts  → Agent thread/message persistence CRUD
  middleware/
    auth.ts           → JWT + API key auth middleware
    error.ts          → Global error handler
    index.ts          → Middleware re-exports
  db/
    client.ts         → PGlite + Drizzle init, raw SQL migrations, seeding
    schema/index.ts   → Drizzle table definitions (all tables incl. agentThreads, agentMessages)
  services/
    agent-runtime.ts  → PlatformAgent wiring with DB, tool deps, agent caching (1014 lines)
    review-executor.ts → Review execution orchestration
  utils/
    crypto.ts         → AES-256-GCM encrypt/decrypt for tokens at rest
```

## Webhook Flow

1. POST `/:provider/:repositoryId` receives webhook
2. Verify signature → parse event → insert webhookLog
3. If `shouldTriggerReview` → create review record, fire `executeReviewAsync` (fire-and-forget)

## Agent System

### Agent Runtime (`services/agent-runtime.ts`)

- `getPlatformAgent(userId)` — creates/caches Mastra Agent per user + AI provider
- Implements all `*ToolDeps` interfaces (TemplateToolDeps, RepoToolDeps, etc.) with Drizzle queries
- Cache key: `${userId}:${providerId}:${updatedAt}` — no LRU eviction, grows unbounded
- `buildPlatformContext(userId, role)` — constructs PlatformToolContext + deps for MCP/A2A/AgUI

### Protocol Endpoints

- **A2A** (`routes/a2a.ts`): Google A2A protocol. JSON-RPC 2.0 over POST. Methods: `tasks/send`, `tasks/get`, `tasks/cancel`. GET `/card` returns Agent Card. Persists threads to `agentThreads`/`agentMessages` tables.
- **AG-UI** (`routes/agui.ts`): Two sub-endpoints. POST `/` — CopilotKit runtime (wraps agent in MastraAgent). POST `/stream` — raw AG-UI SSE with EventEncoder. Both persist to agent thread tables.
- **MCP** (`routes/mcp.ts`): Stateless HTTP proxy. Creates fresh MCP server + WebStandard transport per request. 43 lines — simplest endpoint.
## Key Patterns

- Each route file exports Hono app, mounted in `index.ts` — all use Zod validation
- PGlite (embedded Postgres) + Drizzle ORM. ULID IDs. **No transactions**
- `reviewEngineCache`: Map keyed by `${aiProviderId}:${updatedAt}`. Naive eviction, not LRU
## Where to Look

| Task                        | File                                                                |
| --------------------------- | ------------------------------------------------------------------- |
| Add new API endpoint        | Create/edit route file in `routes/`, mount in `index.ts`            |
| Change auth flow            | `middleware/auth.ts` + `routes/auth.ts`                             |
| Modify DB schema            | `db/schema/index.ts` → add table, then `bun run db:generate`        |
| Change webhook handling     | `routes/webhooks.ts` → POST handler + executeReviewAsync            |
| Fix review execution        | `services/review-executor.ts` or `routes/webhooks.ts`              |
| Modify agent tool deps      | `services/agent-runtime.ts` → relevant `*ToolDeps` implementation  |
| Add new agent protocol      | Create `routes/new-protocol.ts`, mount in `index.ts`               |

## Gotchas

- `SKIP_WEBHOOK_VERIFICATION=true` bypasses signature checks — NEVER in production
- `executeReviewAsync` is fire-and-forget — no queue, no concurrency limit, no retry
- Agent cache grows unbounded — no LRU eviction, memory leak risk under many users
- A2A endpoint processes tasks synchronously in request — long-running agent calls block
- repos.ts import endpoint loops remote calls synchronously — can timeout on bulk imports
- DB operations not transactional — partial failures leave inconsistent state
- agui.ts uses `@copilotkit/runtime` ExperimentalEmptyAdapter — may break on CopilotKit updates
