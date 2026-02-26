# Mastra Integration + Runtime Migration Design

**Date**: 2026-02-26
**Branch**: `feature/mastra-integration` (from `feature/webhook-platform`)
**Status**: Approved

## Goal

Replace the current AI layer (`DirectAIClient` + `OpenCodeClient`) with Mastra Agent framework, and migrate runtime from Bun to Node/pnpm. This gives the platform real agent capabilities (structured output, multi-step reasoning, MCP tools) instead of simple prompt concatenation with brittle regex parsing.

**Scope**: `packages/` only. `.opencode-review/` (CI/Actions mode) is untouched.

## Background

### Current Problems

1. **No agent capabilities**: `DirectAIClient` does single-shot `generateText()` → text → regex parse. `OpenCodeClient` uses `@opencode-ai/sdk` only as a remote LLM API — no MCP tools, no agent behavior.
2. **Brittle parsing**: `parseAIResponse()` has three fallback paths (JSON.parse → codeblock extraction → Chinese markdown regex). Silent degradation to empty results on failure.
3. **No structured output**: AI response is raw text. The engine manually instructs the LLM to output JSON via Chinese prompt instructions, then tries to parse it.
4. **Single provider**: Only OpenAI-compatible API via `@ai-sdk/openai-compatible`. No native DeepSeek/Anthropic/Google support.
5. **No extensibility**: diff → prompt → AI → parse is a hardcoded pipeline. No way to inject static analysis, lint results, or other context.

### Why Mastra

- Native structured output via Zod schemas (eliminates regex parsing entirely)
- Multi-provider support: OpenAI, Anthropic, DeepSeek, Google, 20+ providers
- Multi-step agent reasoning with `maxSteps` + `prepareStep` control
- MCP tool integration for future extensibility
- TypeScript native, v1.0+ stable (released Jan 2026)

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────┐
│                  ReviewEngine                    │
│                                                  │
│  1. provider.getPullRequestDiff()  ← engine I/O  │
│  2. enricher.enrich()              ← extensible  │
│  3. agent.generate(structuredOutput) ← Mastra    │
│  4. provider.createReview()        ← engine I/O  │
└─────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
  ┌─────────────┐    ┌──────────────────┐
  │ GitProvider  │    │  Mastra Agent    │
  │ (Gitea/     │    │  - instructions  │
  │  GitHub/    │    │  - model config  │
  │  GitLab)    │    │  - tools (预留)  │
  └─────────────┘    │  - structured    │
                     │    output schema │
                     └──────────────────┘
                            │
                     ┌──────┴──────┐
                     │ AI Provider │
                     │ DeepSeek /  │
                     │ OpenAI /    │
                     │ Anthropic   │
                     └─────────────┘
```

**Design decision — Hybrid mode**: Agent handles analysis only (structured output). Engine controls all I/O (fetching diff, submitting review). This gives us deterministic control over Git platform interactions while leveraging Agent intelligence for code analysis.

### New File Structure

```
packages/core/src/ai/
├── agent.ts          # Mastra Agent factory (createReviewAgent)
├── tools/
│   ├── git-diff.ts   # PR diff tool (reserved for future autonomous mode)
│   ├── git-review.ts # Review submission tool (reserved)
│   └── index.ts
├── schemas.ts        # Zod schemas for structured output
├── provider.ts       # AI provider config resolution
└── index.ts          # Module exports

packages/core/src/review/
├── engine.ts         # ReviewEngine (rewritten, ~150 lines)
└── enricher.ts       # ReviewContextEnricher (extensibility pipeline)
```

## Detailed Design

### 1. Structured Output Schema (`schemas.ts`)

Replaces all regex parsing with Zod schema validation.

```typescript
import { z } from "zod";

export const reviewCommentSchema = z.object({
  path: z.string().describe("File path"),
  line: z.number().describe("Line number in new file"),
  body: z.string().describe("Comment content in [Category:Severity] format"),
  category: z.enum([
    "BUG",
    "SECURITY",
    "PERFORMANCE",
    "STYLE",
    "LOGIC",
    "TEST",
    "DOCS",
    "REFACTOR",
  ]),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
});

export const reviewResultSchema = z.object({
  decision: z.enum(["APPROVED", "REQUEST_CHANGES", "COMMENT"]),
  summary: z.string().describe("1-3 sentence summary"),
  comments: z.array(reviewCommentSchema),
  score: z.number().min(0).max(100).optional(),
});

export type ReviewOutput = z.infer<typeof reviewResultSchema>;
export type ReviewComment = z.infer<typeof reviewCommentSchema>;
```

### 2. AI Provider Configuration (`provider.ts`)

Dynamic model resolution for multi-provider support.

```typescript
export interface AIProviderConfig {
  provider: string; // 'openai' | 'deepseek' | 'anthropic'
  model: string; // 'gpt-4o' | 'deepseek-chat'
  apiKey: string;
  baseUrl?: string;
}

export function resolveModelId(config: AIProviderConfig): string {
  return `${config.provider}/${config.model}`;
}

export function resolveModelConfig(config: AIProviderConfig) {
  return {
    id: resolveModelId(config),
    apiKey: config.apiKey,
    ...(config.baseUrl && { url: config.baseUrl }),
  };
}
```

### 3. Mastra Agent (`agent.ts`)

Factory function that creates a configured review agent.

```typescript
import { Agent } from "@mastra/core/agent";
import type { GitProvider } from "../providers/types";

export interface ReviewAgentConfig {
  model: string;
  apiKey: string;
  baseUrl?: string;
  instructions: string;
  provider: GitProvider;
  maxSteps?: number; // default 3
}

export function createReviewAgent(config: ReviewAgentConfig): Agent {
  return new Agent({
    id: "code-review-agent",
    instructions: config.instructions,
    model: {
      id: config.model,
      apiKey: config.apiKey,
      ...(config.baseUrl && { url: config.baseUrl }),
    },
    // Tools reserved for future autonomous mode
    tools: {},
  });
}
```

### 4. Mastra Tools (`tools/` — reserved)

Tool factory pattern using GitProvider abstraction. Tools are defined but not wired into the initial agent — reserved for future autonomous mode.

```typescript
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { GitProvider } from "../../providers/types";

export const createGitDiffTool = (provider: GitProvider) =>
  createTool({
    id: "git-pr-diff",
    description: "Get Pull Request code diff",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
    }),
    outputSchema: z.object({
      diff: z.string(),
      filesChanged: z.number(),
      additions: z.number(),
      deletions: z.number(),
    }),
    execute: async ({ context }) => {
      const diff = await provider.getPullRequestDiff(
        context.owner,
        context.repo,
        context.pullNumber,
      );
      return { diff, filesChanged: 0, additions: 0, deletions: 0 };
    },
  });

export const createGitReviewTool = (provider: GitProvider) =>
  createTool({
    id: "git-submit-review",
    description: "Submit code review with decision, summary, and line comments",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
      decision: z.enum(["APPROVED", "REQUEST_CHANGES", "COMMENT"]),
      summary: z.string(),
      comments: z
        .array(
          z.object({
            path: z.string(),
            line: z.number(),
            body: z.string(),
          }),
        )
        .optional(),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      reviewId: z.number().optional(),
    }),
    execute: async ({ context }) => {
      const result = await provider.createReview(
        context.owner,
        context.repo,
        context.pullNumber,
        {
          body: context.summary,
          decision: context.decision,
          comments: context.comments,
        },
      );
      return { success: true, reviewId: result?.id };
    },
  });
```

**Design decision — Tool factory pattern**: `createGitDiffTool(provider)` rather than global tools, because each review may target a different GitProvider instance (different repo, different platform).

### 5. Review Context Enricher (`enricher.ts`)

Extensible pipeline for injecting additional context before AI analysis. Initial version ships with no registered sources — the interface is the deliverable.

```typescript
export interface EnrichmentSource {
  id: string;
  name: string;
  enrich(context: EnrichmentContext): Promise<EnrichmentResult | null>;
}

export interface EnrichmentContext {
  owner: string;
  repo: string;
  pullNumber: number;
  diff: string;
  changedFiles: string[];
}

export interface EnrichmentResult {
  sourceId: string;
  label: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export class ReviewContextEnricher {
  private sources: EnrichmentSource[] = [];

  register(source: EnrichmentSource): void {
    this.sources.push(source);
  }

  async enrich(context: EnrichmentContext): Promise<EnrichmentResult[]> {
    const results = await Promise.allSettled(
      this.sources.map((s) => s.enrich(context)),
    );
    return results
      .filter(
        (r): r is PromiseFulfilledResult<EnrichmentResult | null> =>
          r.status === "fulfilled" && r.value !== null,
      )
      .map((r) => r.value!);
  }

  formatForPrompt(results: EnrichmentResult[]): string {
    if (results.length === 0) return "";
    return results
      .map((r) => `\n---\n## Additional Context: ${r.label}\n${r.content}`)
      .join("\n");
  }
}
```

**Future enrichment sources** (not in initial implementation):

- ESLint incremental scan on changed files
- Security scanning (semgrep/snyk)
- Test coverage delta
- Related issue/PR context

### 6. ReviewEngine Rewrite (`engine.ts`)

Simplified from 544 lines to ~150 lines. Core changes:

- Remove `parseAIResponse()`, `parseMarkdownResponse()`, `extractJsonFromCodeBlock()` (~150 lines deleted)
- Remove `DirectAIClient` / `OpenCodeClient` dual-mode switching (~80 lines deleted)
- Remove hardcoded Chinese JSON output instructions in `buildUserPrompt`
- Add `ReviewContextEnricher` integration
- Use `agent.generate()` with `structuredOutput` for type-safe results

```typescript
// Simplified flow
async executeReview(context: ReviewContext): Promise<ReviewResult> {
  const diff = await context.provider.getPullRequestDiff(...)
  const enrichments = await this.enricher.enrich({ diff, changedFiles, ... })
  const systemPrompt = this.buildSystemPrompt(context.template)
  const userPrompt = this.buildUserPrompt(diff, context, enrichments)

  const agent = createReviewAgent({ model, apiKey, baseUrl, instructions: systemPrompt, provider })
  const result = await agent.generate(userPrompt, {
    maxSteps: 3,
    structuredOutput: { schema: reviewResultSchema },
  })

  const { decision, summary, comments } = result.object  // Type-safe!
  await context.provider.createReview(..., { body: summary, decision, comments })

  return { success: true, decision, summary, commentsCount: comments.length, ... }
}
```

### 7. Server Integration Changes

**`webhooks.ts`**: Adapt `getReviewEngineForUser()` to new `ReviewEngineConfig` shape:

```typescript
// Before
const engine = new ReviewEngine({
  apiKey,
  baseUrl,
  model: { providerID, modelID },
  useDirectMode: true,
});

// After
const engine = new ReviewEngine({
  apiKey,
  baseUrl,
  provider: aiProvider.provider,
  model: aiProvider.model,
});
```

**`index.ts`**: Migrate from `Bun.serve()` to `@hono/node-server`:

```typescript
// Before (Bun)
export default { port: PORT, fetch: app.fetch };

// After (Node)
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

app.use("/assets/*", serveStatic({ root: "./dist/web" }));
serve({ fetch: app.fetch, port: PORT });
```

## Runtime Migration

### Dependency Changes

```diff
# packages/core/package.json
- "@opencode-ai/sdk": "^1.1.48"
- "ai": "^4.3.16"
- "@ai-sdk/openai-compatible": "^0.2.14"
+ "@mastra/core": "^1.1.0"
+ "zod": "^3.23.0"

# packages/server/package.json
- "@types/bun": "^1.1.0"
- "bun-types": "^1.1.0"
+ "@hono/node-server": "^1.13.0"
+ "tsup": "^8.0.0"
+ "tsx": "^4.0.0"

# root package.json
- packageManager: "bun@1.1.0"
+ packageManager: "pnpm@9.x"
- "@types/bun": "^1.1.0"
```

### File Changes Summary

| Action      | Files                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create**  | `ai/agent.ts`, `ai/provider.ts`, `ai/schemas.ts`, `ai/tools/git-diff.ts`, `ai/tools/git-review.ts`, `ai/tools/index.ts`, `review/enricher.ts` |
| **Delete**  | `ai/client.ts`, `ai/direct-client.ts`, `bun.lock`                                                                                             |
| **Rewrite** | `ai/index.ts`, `review/engine.ts`, `server/src/index.ts`                                                                                      |
| **Modify**  | `package.json` (root), `core/package.json`, `server/package.json`, `server/src/routes/webhooks.ts`, `Dockerfile`                              |

### Build & Dev Scripts

```diff
# All package.json files
- "dev": "bun run --watch src/index.ts"
+ "dev": "tsx watch src/index.ts"
- "build": "bun build src/index.ts --outdir dist --target bun"
+ "build": "tsup src/index.ts --format esm --dts"
- "start": "bun dist/index.js"
+ "start": "node dist/index.js"
```

### Dockerfile

```diff
- FROM oven/bun:1-alpine AS base
+ FROM node:22-alpine AS base
+ RUN corepack enable && corepack prepare pnpm@9 --activate

- RUN bun install --frozen-lockfile
+ RUN pnpm install --frozen-lockfile

- RUN bun run build
+ RUN pnpm run build

- CMD ["bun", "run", "start"]
+ CMD ["node", "dist/index.js"]
```

## Implementation Order

1. **Runtime migration** — packageManager, scripts, lock file, server entry, Dockerfile
2. **Mastra dependencies** — install `@mastra/core`, `zod`, `@hono/node-server`, `tsup`, `tsx`
3. **AI layer rewrite** — schemas, provider, agent, tools, enricher, engine
4. **Server integration** — webhooks.ts config shape, ai-providers route if needed
5. **Cleanup** — delete old files, remove old dependencies, verify build + typecheck

## Constraints

- `.opencode-review/` directory is NOT modified
- ULID for all database IDs
- No `as any` or `@ts-ignore`
- Existing template system (`defaults.ts`, `renderer.ts`) is preserved
- GitProvider interface is unchanged — tools and engine use it as-is
