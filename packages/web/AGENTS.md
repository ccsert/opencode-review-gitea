# AGENTS.md — packages/web

## Overview

React 19 + Vite frontend for platform mode.
Uses Shadcn/UI components, React Query for data fetching, Zustand for local state, and i18next for localization.

## Structure

```
src/
  main.tsx                 -> app bootstrap
  router.tsx               -> route config + protected layout routing
  pages/                   -> top-level pages
  components/
    ui/                    -> shared UI primitives
    layouts/               -> dashboard layout shell
    agent/                 -> agent UI components
    ai-elements/           -> AI conversation/prompt/tool components
  lib/
    api-client.ts          -> API wrapper + auth token handling
    hooks.ts               -> React Query hooks
  stores/                  -> auth/theme/agent-ui Zustand stores
  i18n/                    -> i18n setup
  index.css                -> global styles and theme tokens
```

## Routes

Defined in `src/router.tsx`:
- `/login`
- `/` dashboard
- `/repositories`
- `/reviews`
- `/templates`
- `/api-keys`
- `/platforms`
- `/ai-providers`
- `/settings`

## Scripts

```bash
pnpm --filter @opencode-review/web run dev
pnpm --filter @opencode-review/web run build
pnpm --filter @opencode-review/web run lint
pnpm --filter @opencode-review/web run typecheck
```

## Notes

- Frontend talks to server via REST only; do not import `core` directly.
- Vite is overridden to `rolldown-vite` in package config.
- No frontend tests are currently configured.
