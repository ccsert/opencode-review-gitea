# AGENTS.md — .opencode-review

## Overview

CI/Actions mode implementation. Provides MCP tools, agent configs, and skills for running AI code reviews in Gitea Actions pipelines. Fully independent from `packages/` — own dependencies, own runtime.

## Structure

```
opencode.json           → OpenCode runtime config (permissions, model source)
package.json            → Dependencies (@opencode-ai/plugin)
env.d.ts                → Required env vars (GITEA_TOKEN, GITEA_SERVER_URL, etc.)
tools/
  gitea-pr-diff.ts      → Fetch and parse PR .diff from Gitea API
  gitea-pr-diff.txt     → Tool description (loaded by MCP)
  gitea-review.ts       → Submit structured review (summary + line comments + approval)
  gitea-review.txt      → Tool description
  gitea-comment.ts      → Post single PR comment
  gitea-comment.txt     → Tool description
  gitea-incremental-diff.ts → Incremental review (find last reviewed commit, diff since)
  gitea-incremental-diff.txt → Tool description
  gitea-pr-files.ts     → File pattern matching for PR file filtering
agents/
  gitea-assistant.md    → Agent role config (which tools to use, behavior guidelines)
  code-review.md        → Code review policies and scoring guidelines
skills/
  pr-review/SKILL.md    → End-to-end review workflow (fetch diff → analyze → submit)
tests/
  gitea-pr-diff.test.ts          → Diff parsing/formatting tests
  gitea-incremental-diff.test.ts → Incremental review logic tests
  gitea-review-tags.test.ts      → Review tag formatting/parsing tests
  gitea-review-stats.test.ts     → Review statistics tests
```

## Runtime Flow

```
CI trigger → OpenCode agent loads agents/*.md + skills/ → calls tools/ → posts review to Gitea
```

1. Agent (guided by `skills/pr-review/SKILL.md`) calls `gitea-pr-diff` to fetch diff
2. Agent analyzes diff and produces structured review
3. Agent calls `gitea-review` to submit review with line comments and approval state

## Environment

Required:

- `GITEA_TOKEN` or `GITHUB_TOKEN` — API token with `write:repository` scope
- `GITEA_SERVER_URL` or `GITHUB_SERVER_URL` — Provider base URL

`opencode.json` restricts agent permissions (read/edit/bash denied by default).

## Commands

```bash
bun install          # Install dependencies (from this directory)
bun test             # Run all tests
bun test tests/gitea-pr-diff.test.ts  # Run specific test
```

## Where to Look

| Task                      | File                                                                   |
| ------------------------- | ---------------------------------------------------------------------- |
| Change diff parsing       | `tools/gitea-pr-diff.ts`                                               |
| Change review format/tags | `tools/gitea-review.ts`                                                |
| Add new tool              | Create `tools/new-tool.ts` + `tools/new-tool.txt`, reference in agents |
| Change agent behavior     | `agents/gitea-assistant.md` or `agents/code-review.md`                 |
| Change review workflow    | `skills/pr-review/SKILL.md`                                            |
| Modify permissions        | `opencode.json`                                                        |

## Gotchas

- Tools use `giteaFetch` helper that throws if env vars missing — fails silently in CI without proper secrets
- Review tags use structured format like `**[BUG:HIGH]**` — tests validate this format
- `opencode.json` denies edit/bash/read by default — update carefully if agent needs more access
- This directory has its own `node_modules` and `bun.lock` — independent from root workspace
