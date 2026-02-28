# AGENTS.md

## Overview

AI-powered code review platform for Gitea/Forgejo, GitHub, and GitLab.

- **Platform Mode** (`packages/`): web UI + API server + webhook-driven reviews
- **Actions Mode** (`.opencode-review/`): CI-based review via OpenCode tools

Monorepo uses Node.js + pnpm workspaces + Turborepo.

## Structure

```
packages/
  core/     → Provider abstraction, AI/agent integration, review engine, templates, events, MCP server
  server/   → Hono API, Drizzle + PGlite DB, auth, webhooks, agent runtime, A2A/AG-UI endpoints
  web/      → React 19 frontend, Shadcn/UI, Zustand, React Query
  sdk/      → Standalone TypeScript API client
.opencode-review/  → Actions mode tools/agents/skills/tests (independent runtime)
docs/              → Architecture and planning docs
docker/            → Deployment assets
```

## Dependency Graph

```
web -> server -> core
sdk -> server (HTTP only, external usage)
.opencode-review -> independent from packages/
```

## Commands (root)

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm run lint
pnpm run test
pnpm run typecheck
pnpm run db:generate
pnpm run db:migrate
```

## Key Patterns

- Provider pattern: `GitProvider` interface + concrete providers (`gitea`, `github`, `gitlab`)
- Review flow: webhook/event -> review engine -> provider comment/review APIs
- Platform agent tools live in `packages/core/src/ai/tools/platform/`, wired in server runtime
- Server routes are split per domain and mounted in `packages/server/src/index.ts`
- Web uses API hooks (`packages/web/src/lib/hooks.ts`) with shared `apiClient`

## Current Notes

- Root `packageManager` is `pnpm@9.x`
- Tests exist in `packages/core` and `packages/server` (plus `.opencode-review/tests`)
- `web` currently has no test suite
- `.opencode-review` keeps its own lockfile/deps and runs separately from workspace packages

## Child AGENTS.md Files

- `packages/core/AGENTS.md`
- `packages/server/AGENTS.md`
- `packages/web/AGENTS.md`
- `packages/sdk/AGENTS.md`
- `.opencode-review/AGENTS.md`
