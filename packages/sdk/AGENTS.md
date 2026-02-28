# AGENTS.md — packages/sdk

## Overview

Standalone TypeScript SDK for calling OpenCode Review platform REST APIs.
No dependency on monorepo runtime packages (`core`, `server`, `web`).

## Structure

```
src/
  client.ts   -> OpenCodeReviewClient implementation
  types.ts    -> request/response types
  index.ts    -> public exports
```

## Key Behavior

- Constructor supports `baseUrl` plus auth via `apiKey` or `token`.
- Central request method handles headers, JSON serialization, and non-2xx errors.
- API groups are exposed on the client for auth, repositories, reviews, templates, providers, system, and webhook operations.

## Scripts

```bash
pnpm --filter @opencode-review/sdk run build
pnpm --filter @opencode-review/sdk run typecheck
```

## Notes

- Keep SDK types aligned with server response shapes.
- Avoid importing server internals; SDK must remain transport-only.
