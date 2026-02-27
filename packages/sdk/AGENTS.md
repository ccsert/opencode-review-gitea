# AGENTS.md — packages/sdk

## Overview

Zero-dependency TypeScript API client for the OpenCode Review platform REST API. Standalone package — no imports from core, server, or web. Used by external consumers to interact with the platform programmatically.

## Structure

```
src/
  client.ts   → OpenCodeReviewClient class (235 lines — all API methods)
  types.ts    → Request/response type definitions (mirrors server API shapes)
  index.ts    → Re-exports client + types
package.json  → Zero dependencies, dual ESM/CJS build via tsup
tsconfig.json → Strict TypeScript, ES2020 target
```

## Key Patterns

### Client Architecture

- Single class `OpenCodeReviewClient` with constructor `{ baseUrl, apiKey?, token? }`
- Auth: API key via `X-API-Key` header OR JWT via `Authorization: Bearer` header
- All methods return typed responses, throw on non-2xx
- Internal `fetch` wrapper handles auth headers + JSON serialization

### API Coverage

- `auth.*` — login, refresh, me
- `repositories.*` — CRUD, test connection, list
- `reviews.*` — list, get, stats, retry
- `templates.*` — CRUD, list
- `aiProviders.*` — CRUD, test, list
- `system.*` — health, info, models
- `webhooks.*` — trigger

## Where to Look

| Task                       | File                                 |
| -------------------------- | ------------------------------------ |
| Add new API method         | `src/client.ts` → add method + types |
| Add request/response types | `src/types.ts`                       |
| Change auth behavior       | `src/client.ts` → `request()` method |
| Change build config        | `package.json` → tsup config         |

## Gotchas

- No retry logic or request timeout — consumer must handle
- Types are manually maintained — not auto-generated from server schema (can drift)
- No validation on responses — trusts server contract
- `token` vs `apiKey` auth: if both provided, API key takes precedence
