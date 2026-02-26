# Platform Agent + AG-UI + MCP + SDK Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full platform agent system with Mastra Tools, AG-UI real-time chat, MCP server, and TypeScript SDK.

**Architecture:** Mastra-Native full-stack integration. All platform capabilities as Mastra Tools in `core`, Agent runtime in `server` with DB context injection, AG-UI via CopilotKit + `@ag-ui/mastra`, MCP server wrapping Mastra Tools, SDK as zero-dependency HTTP client.

**Tech Stack:** Mastra (`@mastra/core`), CopilotKit (`@copilotkit/react-core`, `@copilotkit/react-ui`), AG-UI (`@ag-ui/core`, `@ag-ui/mastra`), MCP (`@modelcontextprotocol/sdk`), Hono SSE, Drizzle ORM, React 19, Zod.

**Design Doc:** `docs/plans/2026-02-26-platform-agent-agui-design.md`

---

## Phase 1: Mastra Tools + Platform Agent (Foundation)

### Task 1: Create new branch

**Step 1: Create branch from feature/webhook-platform**

```bash
git checkout -b feature/platform-agent
```

**Step 2: Verify branch**

```bash
git branch --show-current
```

Expected: `feature/platform-agent`

---

### Task 2: Add DB tables for Agent threads and messages

**Files:**

- Modify: `packages/server/src/db/schema/index.ts`
- Modify: `packages/server/src/db/client.ts` (add migration SQL)

**Step 1: Add `agent_threads` and `agent_messages` tables to schema**

Add after the `aiProviders` table definition in `packages/server/src/db/schema/index.ts`:

```typescript
// ============ Agent Threads 表 ============
// Agent 对话线程

export const agentThreads = pgTable(
  "agent_threads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: text("org_id"), // 多用户预留
    title: text("title"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => ({
    userIdx: index("idx_agent_threads_user").on(table.userId),
  }),
);

export type AgentThread = typeof agentThreads.$inferSelect;
export type NewAgentThread = typeof agentThreads.$inferInsert;

// ============ Agent Messages 表 ============
// Agent 对话消息

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => agentThreads.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // 'user' | 'assistant' | 'tool'
    content: text("content"),
    toolCalls: jsonb("tool_calls").$type<
      Array<{
        id: string;
        name: string;
        args: Record<string, unknown>;
        result?: unknown;
      }>
    >(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    threadIdx: index("idx_agent_messages_thread").on(
      table.threadId,
      table.createdAt,
    ),
  }),
);

export type AgentMessage = typeof agentMessages.$inferSelect;
export type NewAgentMessage = typeof agentMessages.$inferInsert;
```

**Step 2: Add `orgId` column to `reviewTemplates` and `repositories` tables**

In the existing `reviewTemplates` table definition, add after `userId`:

```typescript
orgId: text('org_id'),  // 多用户预留
```

In the existing `repositories` table definition, add after `userId`:

```typescript
orgId: text('org_id'),  // 多用户预留
```

**Step 3: Add migration SQL for new tables in `db/client.ts`**

Add the CREATE TABLE statements for `agent_threads` and `agent_messages` to the raw SQL migrations in `runMigrations()`. Also add ALTER TABLE for `orgId` columns.

**Step 4: Run dev to verify schema compiles**

```bash
bun run typecheck --filter @opencode-review/server
```

Expected: No type errors

**Step 5: Commit**

```bash
git add packages/server/src/db/
git commit -m "feat: add agent_threads and agent_messages DB tables, orgId columns"
```

---

### Task 3: Define PlatformToolContext and ToolResult types

**Files:**

- Create: `packages/core/src/ai/tools/platform/types.ts`

**Step 1: Create the types file**

```typescript
/**
 * Platform Tool types
 * Shared context and result types for all platform management tools
 */

import type { GitProvider } from "../../../providers/types";

/**
 * Error codes for tool results
 */
export enum ToolErrorCode {
  NOT_FOUND = "NOT_FOUND",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  PROVIDER_ERROR = "PROVIDER_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

/**
 * Discriminated union result type for all tools
 */
export type ToolResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code: ToolErrorCode };

/**
 * Database interface for platform tools
 * Abstract over Drizzle to keep core independent of DB implementation
 */
export interface PlatformDB {
  query: <T>(fn: () => Promise<T>) => Promise<T>;
}

/**
 * Context injected into every platform tool at creation time
 */
export interface PlatformToolContext {
  /** Database access (abstracted) */
  db: PlatformDB;
  /** Current authenticated user ID */
  userId: string;
  /** User role for permission checks */
  userRole: "admin" | "member" | "viewer";
  /** Organization ID (multi-tenant, optional) */
  orgId?: string;
  /** Git provider instance for repo operations */
  gitProvider?: GitProvider;
}

/**
 * Helper to create a success result
 */
export function ok<T>(data: T): ToolResult<T> {
  return { success: true, data };
}

/**
 * Helper to create an error result
 */
export function err<T>(error: string, code: ToolErrorCode): ToolResult<T> {
  return { success: false, error, code };
}
```

**Step 2: Verify it compiles**

```bash
bun run typecheck --filter @opencode-review/core
```

Expected: No type errors

**Step 3: Commit**

```bash
git add packages/core/src/ai/tools/platform/
git commit -m "feat: add PlatformToolContext and ToolResult types"
```

---

### Task 4: Implement template management tools

**Files:**

- Create: `packages/core/src/ai/tools/platform/template-tools.ts`

**Step 1: Write the template tools**

Create `packages/core/src/ai/tools/platform/template-tools.ts` implementing these Mastra tools using the `createTool` pattern from `@mastra/core/tools`:

- `listTemplates` — list all templates for current user
- `getTemplate` — get template by ID
- `createTemplate` — create new template
- `updateTemplate` — update existing template
- `deleteTemplate` — delete template
- `testTemplate` — render template with sample data (using `renderTemplate` from `../../templates/renderer`)
- `optimizeTemplate` — return template analysis suggestions (placeholder for AI optimization)

Each tool:

- Uses `createTool({ id, description, inputSchema: z.object({...}), execute: async (input) => {...} })`
- Follows the factory pattern: `export function createTemplateTools(ctx: PlatformToolContext)`
- Returns `ToolResult<T>` from execute
- References: existing tool pattern in `git-diff.ts`, existing template CRUD in `packages/server/src/routes/templates.ts`

The factory function returns an object: `{ listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate, testTemplate, optimizeTemplate }`

**Important**: The tools in `core` cannot import Drizzle directly (core has no DB dependency). Instead, `PlatformToolContext.db` is an abstracted interface. The actual DB queries will be injected via callback functions. Use a `PlatformToolDeps` interface:

```typescript
export interface TemplateToolDeps {
  listTemplates: (userId: string) => Promise<any[]>;
  getTemplate: (id: string) => Promise<any | null>;
  createTemplate: (data: any) => Promise<any>;
  updateTemplate: (id: string, data: any) => Promise<any | null>;
  deleteTemplate: (id: string) => Promise<boolean>;
  isSystemTemplate: (id: string) => boolean;
}

export function createTemplateTools(ctx: PlatformToolContext, deps: TemplateToolDeps) { ... }
```

**Step 2: Verify it compiles**

```bash
bun run typecheck --filter @opencode-review/core
```

**Step 3: Commit**

```bash
git add packages/core/src/ai/tools/platform/template-tools.ts
git commit -m "feat: implement template management Mastra tools"
```

---

### Task 5: Implement repository management tools

**Files:**

- Create: `packages/core/src/ai/tools/platform/repo-tools.ts`

**Step 1: Write the repo tools**

Same factory pattern as template tools. Implement:

- `listRepos` — list user's repositories
- `getRepo` — get repo by ID with config
- `configureRepo` — update repo settings
- `getRepoStats` — get review statistics for a repo

Use `RepoToolDeps` interface for DB abstraction.

**Step 2: Verify, commit**

```bash
bun run typecheck --filter @opencode-review/core
git add packages/core/src/ai/tools/platform/repo-tools.ts
git commit -m "feat: implement repository management Mastra tools"
```

---

### Task 6: Implement review operation tools

**Files:**

- Create: `packages/core/src/ai/tools/platform/review-tools.ts`

**Step 1: Write the review tools**

Implement:

- `triggerReview` — trigger a manual PR review (calls into existing `executeReviewAsync` logic)
- `getReview` — get review result by ID
- `listReviews` — list reviews with filters (repo, status, date range)
- `getReviewSummary` — aggregate review stats over a period

Use `ReviewToolDeps` interface.

**Step 2: Verify, commit**

```bash
bun run typecheck --filter @opencode-review/core
git add packages/core/src/ai/tools/platform/review-tools.ts
git commit -m "feat: implement review operation Mastra tools"
```

---

### Task 7: Implement AI config tools

**Files:**

- Create: `packages/core/src/ai/tools/platform/ai-config-tools.ts`

**Step 1: Write AI config tools**

Implement:

- `listAIProviders` — list user's configured AI providers
- `configureAIProvider` — create or update an AI provider config
- `testAIProvider` — test AI provider connectivity (simple API call)

Use `AIConfigToolDeps` interface. Reference existing logic in `packages/server/src/routes/ai-providers.ts`.

**Step 2: Verify, commit**

```bash
bun run typecheck --filter @opencode-review/core
git add packages/core/src/ai/tools/platform/ai-config-tools.ts
git commit -m "feat: implement AI config Mastra tools"
```

---

### Task 8: Implement webhook management tools

**Files:**

- Create: `packages/core/src/ai/tools/platform/webhook-tools.ts`

**Step 1: Write webhook tools**

Implement:

- `listWebhooks` — list webhooks for a repo
- `registerWebhook` — register a new webhook
- `deleteWebhook` — remove a webhook
- `getWebhookHistory` — get webhook delivery logs

Use `WebhookToolDeps` interface.

**Step 2: Verify, commit**

```bash
bun run typecheck --filter @opencode-review/core
git add packages/core/src/ai/tools/platform/webhook-tools.ts
git commit -m "feat: implement webhook management Mastra tools"
```

---

### Task 9: Implement system tools

**Files:**

- Create: `packages/core/src/ai/tools/platform/system-tools.ts`

**Step 1: Write system tools**

Implement:

- `getSystemHealth` — check DB, AI provider, git provider status
- `getSystemConfig` — return current system configuration summary
- `getDashboardData` — aggregate dashboard data for user (repo count, review count, recent activity)

Use `SystemToolDeps` interface.

**Step 2: Verify, commit**

```bash
bun run typecheck --filter @opencode-review/core
git add packages/core/src/ai/tools/platform/system-tools.ts
git commit -m "feat: implement system Mastra tools"
```

---

### Task 10: Create platform tools index and update core exports

**Files:**

- Create: `packages/core/src/ai/tools/platform/index.ts`
- Modify: `packages/core/src/ai/tools/index.ts`
- Modify: `packages/core/src/index.ts` (if needed)

**Step 1: Create platform tools barrel export**

```typescript
// packages/core/src/ai/tools/platform/index.ts
export * from "./types";
export * from "./template-tools";
export * from "./repo-tools";
export * from "./review-tools";
export * from "./ai-config-tools";
export * from "./webhook-tools";
export * from "./system-tools";
```

**Step 2: Update tools index**

Add to `packages/core/src/ai/tools/index.ts`:

```typescript
export * from "./platform";
```

**Step 3: Verify full core build**

```bash
bun run typecheck --filter @opencode-review/core
```

**Step 4: Commit**

```bash
git add packages/core/src/ai/tools/
git commit -m "feat: export all platform tools from core"
```

---

### Task 11: Create Platform Agent definition

**Files:**

- Create: `packages/core/src/ai/platform-agent.ts`

**Step 1: Write the Platform Agent factory**

Create a `createPlatformAgent` function that:

- Takes `PlatformToolContext` + all `ToolDeps` interfaces
- Calls all `createXxxTools()` factories
- Creates a Mastra `Agent` with all tools loaded
- Uses a well-crafted system prompt describing the agent's capabilities
- Follows the existing `createReviewAgent` pattern in `agent.ts`

```typescript
import { Agent } from "@mastra/core/agent";
import type { OpenAICompatibleConfig } from "@mastra/core/llm";
import {
  createTemplateTools,
  type TemplateToolDeps,
} from "./tools/platform/template-tools";
import {
  createRepoTools,
  type RepoToolDeps,
} from "./tools/platform/repo-tools";
import {
  createReviewTools,
  type ReviewToolDeps,
} from "./tools/platform/review-tools";
import {
  createAIConfigTools,
  type AIConfigToolDeps,
} from "./tools/platform/ai-config-tools";
import {
  createWebhookTools,
  type WebhookToolDeps,
} from "./tools/platform/webhook-tools";
import {
  createSystemTools,
  type SystemToolDeps,
} from "./tools/platform/system-tools";
import type { PlatformToolContext } from "./tools/platform/types";

export interface PlatformAgentConfig {
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxSteps?: number;
  ctx: PlatformToolContext;
  deps: {
    template: TemplateToolDeps;
    repo: RepoToolDeps;
    review: ReviewToolDeps;
    aiConfig: AIConfigToolDeps;
    webhook: WebhookToolDeps;
    system: SystemToolDeps;
  };
}

const PLATFORM_AGENT_SYSTEM_PROMPT = `You are the OpenCode Review Platform Agent...`; // detailed prompt

export function createPlatformAgent(config: PlatformAgentConfig): Agent {
  const tools = {
    ...createTemplateTools(config.ctx, config.deps.template),
    ...createRepoTools(config.ctx, config.deps.repo),
    ...createReviewTools(config.ctx, config.deps.review),
    ...createAIConfigTools(config.ctx, config.deps.aiConfig),
    ...createWebhookTools(config.ctx, config.deps.webhook),
    ...createSystemTools(config.ctx, config.deps.system),
  };

  const modelConfig: OpenAICompatibleConfig = {
    id: config.model as `${string}/${string}`,
    apiKey: config.apiKey,
    ...(config.baseUrl ? { url: config.baseUrl } : {}),
  };

  return new Agent({
    id: "platform-agent",
    name: "OpenCode Review Platform Agent",
    instructions: PLATFORM_AGENT_SYSTEM_PROMPT,
    model: modelConfig,
    tools,
  });
}
```

**Step 2: Export from core**

Add to `packages/core/src/ai/index.ts` (or create if needed):

```typescript
export {
  createPlatformAgent,
  type PlatformAgentConfig,
} from "./platform-agent";
```

**Step 3: Verify, commit**

```bash
bun run typecheck --filter @opencode-review/core
git add packages/core/src/ai/platform-agent.ts packages/core/src/ai/index.ts
git commit -m "feat: implement Platform Agent factory with all tools"
```

---

### Task 12: Create Agent Runtime in server

**Files:**

- Create: `packages/server/src/services/agent-runtime.ts`

**Step 1: Write the agent runtime**

This is the server-side glue that:

- Takes a user ID and DB instance
- Creates `PlatformToolContext` with real DB queries
- Implements all `ToolDeps` interfaces using Drizzle queries
- Calls `createPlatformAgent()` from core
- Caches Agent instances per user (similar to `reviewEngineCache` pattern)

Reference: `packages/server/src/services/review-executor.ts` for DB query patterns, `packages/server/src/routes/templates.ts` for template CRUD queries.

```typescript
import { getDatabase } from "../db/client";
import { createPlatformAgent } from "@opencode-review/core";
import type { TemplateToolDeps } from "@opencode-review/core";
// ... import all deps types and DB tables

const agentCache = new Map<string, Agent>();

export async function getPlatformAgent(userId: string): Promise<Agent> {
  // Check cache
  // Build PlatformToolContext
  // Build all ToolDeps with real Drizzle queries
  // Create agent
  // Cache and return
}
```

**Step 2: Verify, commit**

```bash
bun run typecheck --filter @opencode-review/server
git add packages/server/src/services/agent-runtime.ts
git commit -m "feat: implement Agent runtime with DB context injection"
```

---

### Task 13: Verify Phase 1 builds end-to-end

**Step 1: Build all packages**

```bash
bun run build
```

Expected: Exit code 0, no errors

**Step 2: Run lint**

```bash
bun run lint
```

Expected: No new lint errors

**Step 3: Commit any fixes if needed**

---

## Phase 2: AG-UI Integration (Frontend + Backend)

### Task 14: Install AG-UI and CopilotKit dependencies

**Step 1: Install server dependencies**

```bash
cd packages/server && bun add @ag-ui/core @ag-ui/mastra
```

**Step 2: Install web dependencies**

```bash
cd packages/web && bun add @copilotkit/react-core @copilotkit/react-ui
```

**Step 3: Commit**

```bash
git add packages/server/package.json packages/web/package.json bun.lockb pnpm-lock.yaml
git commit -m "feat: add AG-UI and CopilotKit dependencies"
```

---

### Task 15: Create AG-UI SSE endpoint

**Files:**

- Create: `packages/server/src/routes/agui.ts`
- Modify: `packages/server/src/index.ts` (mount route)

**Step 1: Implement the AG-UI route**

Create `packages/server/src/routes/agui.ts`:

- `POST /` — Main AG-UI endpoint, accepts `RunAgentInput` (threadId, messages), returns SSE stream
- Uses `authMiddleware` for authentication
- Gets Platform Agent via `getPlatformAgent(userId)`
- Uses `@ag-ui/mastra` adapter to bridge Mastra Agent execution → AG-UI events
- Persists messages to `agent_threads` / `agent_messages` tables

Reference Hono SSE streaming: `import { streamSSE } from 'hono/streaming'`

**Step 2: Mount route in server index**

Add to `packages/server/src/index.ts`:

```typescript
import { aguiRoutes } from "./routes/agui";
// In the api chain:
.route("/agui", aguiRoutes)
```

**Step 3: Verify, commit**

```bash
bun run typecheck --filter @opencode-review/server
git add packages/server/src/routes/agui.ts packages/server/src/index.ts
git commit -m "feat: add AG-UI SSE endpoint with Mastra bridge"
```

---

### Task 16: Add Agent thread management routes

**Files:**

- Create: `packages/server/src/routes/agent-threads.ts`
- Modify: `packages/server/src/index.ts`

**Step 1: Implement thread CRUD routes**

- `GET /agent-threads` — list user's conversation threads
- `GET /agent-threads/:id` — get thread with messages
- `DELETE /agent-threads/:id` — delete a thread
- `PATCH /agent-threads/:id` — update thread title

All routes use `authMiddleware` and follow existing Hono + Zod validation pattern from `templates.ts`.

**Step 2: Mount, verify, commit**

```bash
git add packages/server/src/routes/agent-threads.ts packages/server/src/index.ts
git commit -m "feat: add agent thread management API routes"
```

---

### Task 17: Create CopilotKit frontend integration

**Files:**

- Create: `packages/web/src/components/agent/AgentProvider.tsx`
- Create: `packages/web/src/components/agent/AgentPanel.tsx`
- Create: `packages/web/src/components/agent/ToolCallVisualization.tsx`
- Create: `packages/web/src/components/agent/AgentStateIndicator.tsx`
- Create: `packages/web/src/components/agent/index.ts`

**Step 1: Implement AgentProvider**

Wraps the app with `<CopilotKit runtimeUrl="/api/v1/agui">`. Injects auth token from Zustand auth store into CopilotKit headers.

**Step 2: Implement AgentPanel**

Uses CopilotKit's `<CopilotSidebar>` or `<CopilotPopup>` component. Customize labels for Chinese UI.

**Step 3: Implement ToolCallVisualization**

Custom component that renders tool calls as cards showing: tool name, arguments, result, status (running/completed/failed). Uses `useCopilotAction` to register renderers for each tool.

**Step 4: Implement AgentStateIndicator**

Small badge/bar showing Agent state: idle, thinking, executing tool. Reads from CopilotKit state.

**Step 5: Commit**

```bash
git add packages/web/src/components/agent/
git commit -m "feat: add CopilotKit agent UI components"
```

---

### Task 18: Integrate Agent UI into the app shell

**Files:**

- Modify: `packages/web/src/main.tsx` (wrap with AgentProvider)
- Modify: `packages/web/src/components/layouts/dashboard-layout.tsx` (add Agent panel toggle)

**Step 1: Wrap app with AgentProvider**

In `main.tsx`, add `<AgentProvider>` inside the existing provider chain.

**Step 2: Add Agent panel to dashboard layout**

Add a floating button or sidebar toggle in `dashboard-layout.tsx` that opens the Agent chat panel.

**Step 3: Verify frontend builds**

```bash
cd packages/web && bun run build
```

**Step 4: Commit**

```bash
git add packages/web/src/main.tsx packages/web/src/components/layouts/dashboard-layout.tsx
git commit -m "feat: integrate Agent chat panel into dashboard UI"
```

---

### Task 19: Add human-in-the-loop for dangerous operations

**Files:**

- Modify: `packages/web/src/components/agent/AgentPanel.tsx`
- Create: `packages/web/src/components/agent/ConfirmAction.tsx`

**Step 1: Register useCopilotAction hooks for dangerous tools**

For `deleteTemplate`, `deleteWebhook`, `configureAIProvider` — register confirmation renderers using `useCopilotAction` that show a confirmation dialog before the tool executes.

**Step 2: Commit**

```bash
git add packages/web/src/components/agent/
git commit -m "feat: add human-in-the-loop confirmation for dangerous agent actions"
```

---

### Task 20: Verify Phase 2 end-to-end

**Step 1: Build all packages**

```bash
bun run build
```

**Step 2: Run typecheck**

```bash
bun run typecheck
```

**Step 3: Manual smoke test**

Start dev server (`bun run dev`), open web UI, open Agent panel, send a message like "列出所有模板". Verify AG-UI SSE events stream correctly and tool calls render.

**Step 4: Commit any fixes**

---

## Phase 3: MCP Server + SDK

### Task 21: Create MCP Server

**Files:**

- Create: `packages/core/src/mcp/server.ts`
- Create: `packages/core/src/mcp/index.ts`
- Modify: `packages/core/package.json` (add `@modelcontextprotocol/sdk` dependency, add `./mcp` export)

**Step 1: Install MCP SDK**

```bash
cd packages/core && bun add @modelcontextprotocol/sdk
```

**Step 2: Implement MCP Server**

Create `packages/core/src/mcp/server.ts`:

- Uses `@modelcontextprotocol/sdk` to create an MCP server
- Maps each Mastra platform tool to an MCP tool (name, description, inputSchema → JSON Schema from Zod)
- Supports stdio transport (for local CLI tools like Claude Desktop)
- Takes `PlatformToolContext` + all `ToolDeps` at creation time

**Step 3: Verify, commit**

```bash
bun run typecheck --filter @opencode-review/core
git add packages/core/src/mcp/ packages/core/package.json
git commit -m "feat: implement MCP server wrapping platform tools"
```

---

### Task 22: Add MCP SSE proxy route in server

**Files:**

- Create: `packages/server/src/routes/mcp.ts`
- Modify: `packages/server/src/index.ts`

**Step 1: Implement MCP SSE endpoint**

Create `packages/server/src/routes/mcp.ts`:

- `GET /mcp/sse` — SSE transport for remote MCP clients
- `POST /mcp/message` — Message endpoint for MCP SSE transport
- Uses `authMiddleware`, builds `PlatformToolContext` from authenticated user
- Proxies to the MCP server created in Task 21

**Step 2: Mount, verify, commit**

```bash
git add packages/server/src/routes/mcp.ts packages/server/src/index.ts
git commit -m "feat: add MCP SSE proxy route for remote MCP clients"
```

---

### Task 23: Create TypeScript SDK package

**Files:**

- Create: `packages/sdk/package.json`
- Create: `packages/sdk/tsconfig.json`
- Create: `packages/sdk/src/client.ts`
- Create: `packages/sdk/src/types.ts`
- Create: `packages/sdk/src/index.ts`

**Step 1: Create SDK package structure**

`packages/sdk/package.json`:

```json
{
  "name": "@opencode-review/sdk",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {}
}
```

Zero external dependencies. Uses native `fetch` and `EventSource`.

**Step 2: Implement SDK client**

`packages/sdk/src/client.ts`:

- `OpenCodeReviewClient` class with `constructor({ baseUrl, apiKey })`
- Namespaced methods: `client.templates.list()`, `client.repos.get(id)`, etc.
- `client.agent.chat(input)` returns `AsyncIterable<AgUIEvent>` using EventSource
- All methods are typed from `types.ts`

**Step 3: Verify, commit**

```bash
bun run typecheck --filter @opencode-review/sdk
git add packages/sdk/
git commit -m "feat: create TypeScript SDK package for platform API"
```

---

### Task 24: Verify Phase 3

**Step 1: Build all**

```bash
bun run build
```

**Step 2: Test MCP with inspector (manual)**

```bash
npx @modelcontextprotocol/inspector packages/core/dist/mcp/server.js
```

Verify tool listing works.

---

## Phase 4: A2A Protocol

### Task 25: Implement A2A endpoint

**Files:**

- Create: `packages/server/src/routes/a2a.ts`
- Modify: `packages/server/src/index.ts`

**Step 1: Implement A2A JSON-RPC endpoint**

Create `packages/server/src/routes/a2a.ts`:

- `POST /a2a` — JSON-RPC 2.0 endpoint
- Methods: `agent/run`, `agent/status`
- Auth via API Key header
- Routes to Platform Agent execution

**Step 2: Implement Agent Card**

- `GET /.well-known/agent.json` — returns Agent Card describing capabilities
- Add this route directly in `packages/server/src/index.ts` (not under `/api/v1`)

**Step 3: Mount, verify, commit**

```bash
git add packages/server/src/routes/a2a.ts packages/server/src/index.ts
git commit -m "feat: implement A2A protocol endpoint and Agent Card"
```

---

### Task 26: Final verification

**Step 1: Full build**

```bash
bun run build
```

**Step 2: Full typecheck**

```bash
bun run typecheck
```

**Step 3: Run any existing tests**

```bash
bun run test
```

Expected: All existing tests still pass, no regressions.

**Step 4: Final commit if needed**

---

## Summary

| Phase   | Tasks       | Key Deliverables                                                   |
| ------- | ----------- | ------------------------------------------------------------------ |
| Phase 1 | Tasks 1-13  | Branch, DB tables, ~20 Mastra Tools, Platform Agent, Agent Runtime |
| Phase 2 | Tasks 14-20 | AG-UI SSE endpoint, CopilotKit frontend, human-in-the-loop         |
| Phase 3 | Tasks 21-24 | MCP Server (stdio+SSE), TypeScript SDK                             |
| Phase 4 | Tasks 25-26 | A2A JSON-RPC endpoint, Agent Card                                  |

**Files NOT modified:**

- `.opencode-review/` — completely untouched
- `packages/core/src/templates/renderer.ts` — used by tools, not changed
- `packages/core/src/templates/defaults.ts` — not changed
- `packages/core/src/providers/` — interface unchanged
- `packages/core/src/review/engine.ts` — not changed
- Existing REST API routes — not changed
