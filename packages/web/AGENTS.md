# AGENTS.md — packages/web

## Overview

React 19 frontend with Vite. Shadcn/UI component library (Radix + cva + Tailwind). Communicates with server exclusively via REST API — no direct import of core or server packages.

## Structure

```
src/
  main.tsx              → App bootstrap (QueryClientProvider, RouterProvider, Toaster)
  router.tsx            → createBrowserRouter with nested routes, ProtectedRoute wrapper
  lib/
    api-client.ts       → Centralized fetch wrapper, auth header, token refresh on 401
    hooks.ts            → React Query hooks (useRepositories, useReviews, usePlatforms, etc.)
    types.ts            → Frontend-specific type definitions
    utils.ts            → cn() utility (clsx + twMerge)
  stores/
    auth.ts             → Zustand persisted store (accessToken, refreshToken)
    theme.ts            → Zustand store (light/dark/system), applyTheme()
  pages/                → One component per route (dashboard, repos, reviews, etc.)
  components/
    layouts/
      dashboard-layout.tsx → Sidebar + header + Outlet (main app shell)
    ui/                 → ~25 Shadcn/UI primitives (Button, Card, Dialog, Table, etc.)
    protected-route.tsx → Auth guard (redirects to /login if unauthenticated)
    theme-switcher.tsx  → Theme toggle component
    language-switcher.tsx → i18n language selector
  i18n/
    index.ts            → i18next setup with language resources
  index.css             → Tailwind + CSS variables (light/dark theme tokens)
```

## Key Patterns

### Data Flow

```
Page → useQuery hook (lib/hooks.ts) → apiClient (lib/api-client.ts) → server REST API
```

All mutations use `useMutation` + `queryClient.invalidateQueries` for cache updates.

### Auth Flow

- Login → `POST /auth/login` → store tokens in Zustand (persisted to localStorage)
- Every request: `apiClient` reads `useAuthStore.getState().accessToken` → sets `Authorization` header
- On 401: auto-refresh via `POST /auth/refresh` with refreshToken → retry original request
- Refresh failure → `clearTokens()` → `ProtectedRoute` redirects to `/login`

### Component Pattern

Shadcn/UI: Radix primitive → cva variants → Tailwind classes. Example:

```tsx
const buttonVariants = cva("inline-flex items-center...", {
  variants: { variant: { default: "...", destructive: "..." }, size: { ... } }
})
```

### Theming

CSS variables in `index.css` (`:root` + `.dark`). Theme store toggles `dark` class on `documentElement`.

## Where to Look

| Task                 | File                                                     |
| -------------------- | -------------------------------------------------------- |
| Add new page/route   | Create `pages/new.tsx`, add route in `router.tsx`        |
| Add sidebar nav item | `components/layouts/dashboard-layout.tsx` → navItems     |
| Add new API hook     | `lib/hooks.ts` (useQuery/useMutation wrapping apiClient) |
| Change auth behavior | `lib/api-client.ts` + `stores/auth.ts`                   |
| Modify UI primitive  | `components/ui/[component].tsx`                          |
| Change theme tokens  | `index.css` CSS variables                                |

## Gotchas

- `rolldown-vite` override in package.json — experimental Vite replacement
- No tests — frontend is untested
- apiClient token refresh has no retry limit — could loop on persistent 401
