# AGENTS.md — packages/server

## Overview

Node.js + Hono API server for platform mode. Handles auth, repository integrations, webhooks, review execution, and agent-facing protocols.

## Structure

```
src/
  index.ts                 -> app bootstrap, middleware, route mounting, startup
  routes/                  -> domain routes (auth/repos/templates/reviews/etc.)
  middleware/              -> request id, logger, error handling, auth
  db/                      -> PGlite + Drizzle client and schema
  services/                -> agent runtime + review executor
  utils/crypto.ts          -> token/API-key encryption helpers
```

## Mounted API Route Groups (`/api/v1`)

- `auth`
- `repositories`
- `templates`
- `reviews`
- `webhooks`
- `api-keys`
- `platforms`
- `ai-providers`
- `system`
- `agui`
- `agent-threads`
- `a2a`

## Key Flows

- Webhook route verifies provider signatures, records events, and triggers async review execution.
- `services/review-executor.ts` coordinates provider + core review engine calls.
- `services/agent-runtime.ts` wires platform tools to DB-backed dependencies for agent protocols.

## Scripts

```bash
pnpm --filter @opencode-review/server run dev
pnpm --filter @opencode-review/server run build
pnpm --filter @opencode-review/server run test
pnpm --filter @opencode-review/server run typecheck
pnpm --filter @opencode-review/server run db:generate
pnpm --filter @opencode-review/server run db:migrate
```

## Notes

- `JWT_SECRET` is required at startup.
- `ENCRYPTION_KEY` is optional but recommended for encrypting stored secrets.
- Keep route-level validation consistent with existing Zod/Hono patterns.
