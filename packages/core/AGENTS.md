# AGENTS.md — packages/core

## Overview

Core library package for platform logic. No HTTP server/UI layer.

Main responsibilities:
- Git provider abstraction (`gitea`, `github`, `gitlab`)
- Review engine and prompt/template rendering
- AI agent/model routing and tool definitions
- Platform Mastra toolset and MCP server wrapping
- Webhook/event types and normalization helpers

## Structure

```
src/
  providers/         -> Provider interface, base class, provider implementations, factory
  review/            -> Review engine + diff enrichment
  templates/         -> Default templates + renderer
  events/            -> Event types
  ai/                -> Agent factories, model/provider resolution, tool registry
  mcp/               -> MCP platform server
  types.ts           -> Shared domain types
```

## Key Files

- `src/providers/index.ts` -> `createProvider`, `createProviderFromEnv`, supported providers
- `src/review/engine.ts` -> main review orchestration
- `src/ai/agent.ts` -> review agent factory
- `src/ai/platform-agent.ts` -> platform management agent factory
- `src/ai/tools/platform/*.ts` -> platform tool domains (template/repo/review/ai/webhook/system)
- `src/mcp/server.ts` -> MCP server builder for platform tools

## Scripts

```bash
pnpm --filter @opencode-review/core run dev
pnpm --filter @opencode-review/core run build
pnpm --filter @opencode-review/core run test
pnpm --filter @opencode-review/core run typecheck
```

## Notes

- Keep core independent from server/web concerns (no DB or Hono imports).
- Reuse existing provider and tool abstractions instead of adding ad-hoc logic.
- Public API is exported via `src/index.ts` and package `exports` map.
