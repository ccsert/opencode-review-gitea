# AGENTS.md — packages/core

## Overview

Pure library package — no HTTP server, no DB. Provides provider abstraction, AI clients, review engine, template system, and webhook event normalization. Imported by `packages/server`.

## Structure

```
src/
  providers/
    types.ts      → GitProvider interface, ProviderConfig, ProviderError
    base.ts       → BaseProvider abstract (shared fetch, error handling)
    gitea.ts      → GiteaProvider (556 lines — diff, review, webhooks)
    gitlab.ts     → GitLabProvider (779 lines — MR diffs, discussions, approve)
    index.ts      → createProvider / createProviderFromEnv factory
  review/
    engine.ts     → ReviewEngine (544 lines — orchestrates AI review flow)
  ai/
    client.ts     → OpenCodeClient (SDK-based AI calls)
    direct-client.ts → DirectAIClient (direct OpenAI-compatible API calls)
  templates/
    defaults.ts   → Built-in system prompt templates
    renderer.ts   → {{var}} template renderer
  events/
    types.ts      → WebhookEvent types, shouldTriggerReview()
  types.ts        → Shared domain types (User, Repository, PullRequest, Review, etc.)
  index.ts        → Re-exports all submodules
```

## Key Abstractions

### Provider Pattern

```
GitProvider (interface) → BaseProvider (abstract) → GiteaProvider | GitLabProvider
```

- Factory: `createProvider(config)` selects by `config.type`
- `createProviderFromEnv()` reads env vars to auto-configure
- Each provider implements: getPullRequestDiff, createReview, createLineComment, verifyWebhookSignature, parseWebhookEvent

### ReviewEngine

- Constructor picks `DirectAIClient` or `OpenCodeClient` based on config
- `executeReview(context)`: fetch diff → build prompts → call AI → parse response → submit review
- `parseAIResponse`: tries JSON.parse → JSON codeblock extraction → markdown regex fallback
- **Gotcha**: Markdown fallback uses regexes including Chinese headings — brittle parsing

### AI Clients

- `DirectAIClient`: POST to OpenAI-compatible `/chat/completions` endpoint
- `OpenCodeClient`: Uses `@opencode-ai/sdk` for agent-based review
- Both return `{ text: string }` — engine parses the text

## Where to Look

| Task                    | File                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| Add a new git provider  | `providers/types.ts` (interface), create `providers/new.ts`, register in `providers/index.ts` |
| Change review prompt    | `templates/defaults.ts` + `review/engine.ts` (buildSystemPrompt/buildUserPrompt)              |
| Fix AI response parsing | `review/engine.ts` → parseAIResponse, parseMarkdownResponse                                   |
| Add webhook event type  | `events/types.ts` → WebhookEvent union, shouldTriggerReview                                   |
| Change diff format      | Provider's `getPullRequestDiff` method                                                        |

## Gotchas

- No fetch timeouts — large diffs can hang indefinitely
- GitLab `assembleDiff` manually reconstructs unified diff — fragile for renames/binary
- `parseAIResponse` silently falls back to empty results on parse failure
- GitLab `createReview` loops network calls per line comment — partial reviews possible
- Provider `verifyWebhookSignature` implementations differ (HMAC vs token comparison)
