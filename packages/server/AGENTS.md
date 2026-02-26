# AGENTS.md — packages/server

## Overview

Hono HTTP API server on Bun runtime. Drizzle ORM with PGlite. Handles auth, webhook reception, review orchestration, and CRUD for all platform entities. Imports `@opencode-review/core` directly.

## Structure

```
src/
  index.ts           → Hono app setup, Bun.serve, middleware chain, route mounting
  routes/
    auth.ts           → Login, register, refresh token, user management
    repos.ts          → Repository CRUD, webhook auto-registration, import (841 lines)
    reviews.ts        → Review listing, detail, stats
    webhooks.ts       → Webhook receiver, signature verify, review trigger (610 lines)
    templates.ts      → Review template CRUD
    platforms.ts      → Platform connection CRUD
    ai-providers.ts   → AI provider config CRUD + connection test (507 lines)
    api-keys.ts       → API key management
    system.ts         → System info, health check
  middleware/
    auth.ts           → JWT + API key auth middleware
    error.ts          → Global error handler
    index.ts          → Middleware re-exports
  db/
    client.ts         → PGlite + Drizzle init, raw SQL migrations, seeding
    schema/index.ts   → Drizzle table definitions (all tables)
```

## Webhook Flow

1. POST `/:provider/:repositoryId` receives webhook
2. Verify signature → parse event → insert webhookLog
3. If `shouldTriggerReview` → create review record, fire `executeReviewAsync` (fire-and-forget)

## Key Patterns

- Each route file exports Hono app, mounted in `index.ts` — all use Zod validation
- PGlite (embedded Postgres) + Drizzle ORM. ULID IDs. **No transactions**
- `reviewEngineCache`: Map keyed by `${aiProviderId}:${updatedAt}`. Naive eviction, not LRU


## Where to Look

| Task                    | File                                                                |
| ----------------------- | ------------------------------------------------------------------- |
| Add new API endpoint    | Create/edit route file in `routes/`, mount in `index.ts`            |
| Change auth flow        | `middleware/auth.ts` + `routes/auth.ts`                             |
| Modify DB schema        | `db/schema/index.ts` → add table, then `bun run db:generate`        |
| Change webhook handling | `routes/webhooks.ts` → POST handler + executeReviewAsync            |
| Fix review execution    | `routes/webhooks.ts` → executeReviewAsync (calls core ReviewEngine) |

## Gotchas

- `SKIP_WEBHOOK_VERIFICATION=true` bypasses signature checks — NEVER in production
- Tokens/API keys stored plaintext in DB (TODO: encrypt at rest)
- `executeReviewAsync` is fire-and-forget — no queue, no concurrency limit, no retry
- No fetch timeouts on provider API calls from webhook handler
- repos.ts import endpoint loops remote calls synchronously — can timeout on bulk imports
- DB operations not transactional — partial failures leave inconsistent state
