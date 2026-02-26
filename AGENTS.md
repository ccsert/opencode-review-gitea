# AGENTS.md

## Overview

AI-powered code review platform for Gitea/Forgejo, GitHub, and GitLab. Two deployment modes:

- **Platform Mode** (`packages/`): Web UI + API server + webhook-driven reviews
- **Actions Mode** (`.opencode-review/`): CI-based review via OpenCode agent tools

TypeScript monorepo. Bun runtime. Turborepo orchestration.

## Structure

```
packages/
  core/     → Provider abstraction, AI clients, review engine, templates, events
  server/   → Hono HTTP API, Drizzle ORM + PGlite, auth, webhook processing
  web/      → React 19 frontend, Shadcn/UI, Zustand, React Query
.opencode-review/  → CI/Actions mode: MCP tools, agent configs, skills
docs/architecture/ → Design documents (API, DB, provider, template)
docker/            → Platform mode Docker configs
templates/         → CI workflow templates
```

## Dependency Graph

```
web → (HTTP/fetch) → server → core → Git provider APIs + AI provider APIs
```

- `core` is a pure library — no HTTP server, no DB
- `server` imports `core` directly (workspace dependency)
- `web` communicates with `server` via REST API only (no direct import)
- `.opencode-review` is fully independent — separate runtime, own dependencies

## Commands

```bash
bun install              # Install all workspace dependencies
bun run dev              # Start all packages in dev mode (Turborepo)
bun run build            # Build all packages
bun run lint             # Lint all packages
bun run format           # Format all packages
bun run test             # Run tests (currently only in .opencode-review/)
bun run db:generate      # Generate Drizzle migrations (server)
bun run db:migrate       # Run Drizzle migrations (server)
```

## Key Patterns

### Provider Pattern

`GitProvider` interface → `BaseProvider` abstract → `GiteaProvider` | `GitLabProvider`
Factory: `createProvider(config)` / `createProviderFromEnv()`

### Review Engine Dual Mode

- **DirectAIClient**: Calls AI provider API directly (OpenAI-compatible)
- **OpenCodeClient**: Uses OpenCode SDK for agent-based review

### API Route Pattern (server)

Hono routes with Zod validation. Middleware chain:
`requestId → logger → secureHeaders → cors → errorHandler → routes`
Auth: JWT + API key via `authMiddleware` per route group.

### Frontend Pattern (web)

React Query hooks in `lib/hooks.ts` → `apiClient` (fetch wrapper) → server REST API.
Zustand stores for auth + theme. Shadcn/UI components in `components/ui/`.

## Conventions

- Bun as runtime and package manager — never use npm/yarn/pnpm
- ULID for all database IDs (not UUID)
- Template variables use `{{var}}` syntax (simple string replacement)
- Environment variables for all secrets — see `docker/.env.example`
- Route files export Hono app instances mounted in `server/src/index.ts`
- UI components follow Shadcn pattern: Radix primitive + cva variants + Tailwind

## Anti-Patterns — DO NOT

- Store API keys/tokens in plaintext DB fields (existing TODOs to fix — encrypt at rest)
- Use `SKIP_WEBHOOK_VERIFICATION=true` in production
- Suppress TypeScript errors with `as any` or `@ts-ignore`
- Add dependencies without checking if Bun-compatible
- Import `core` from `web` directly — always go through `server` API
- Use npm/yarn/pnpm commands — this is a Bun project

## Known Technical Debt

- API keys and provider tokens stored unencrypted in DB (multiple TODOs)
- No tests in `packages/` — tests only in `.opencode-review/tests/`
- AI response parsing uses brittle regex fallbacks (engine.ts)
- No fetch timeouts on provider API calls
- No job queue — webhook review execution is fire-and-forget
- DB operations not wrapped in transactions (partial failure risk)

## Environment Variables

Required for server:

- `DATABASE_URL` — PGlite database path
- `JWT_SECRET` — JWT signing key
- `PUBLIC_URL` — Server public URL (for webhook registration)

Required for .opencode-review (CI mode):

- `GITEA_TOKEN` / `GITHUB_TOKEN` — Git provider API token
- `GITEA_SERVER_URL` / `GITHUB_SERVER_URL` — Provider base URL

## Child AGENTS.md Files

- `packages/core/AGENTS.md` — Provider abstraction, AI clients, review engine
- `packages/server/AGENTS.md` — HTTP API, DB schema, middleware, webhooks
- `packages/web/AGENTS.md` — React frontend, components, state management
- `.opencode-review/AGENTS.md` — CI/Actions mode tools and agent configs
