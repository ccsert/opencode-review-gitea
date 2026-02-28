# AGENTS.md — .opencode-review

## Overview

Actions mode assets used by OpenCode in CI workflows.
This directory is independent from `packages/` and contains tool definitions, agent prompts, review skill docs, and tests.

## Structure

```
opencode.json           -> OpenCode runtime config/permissions
agents/                 -> agent behavior prompts
skills/pr-review/       -> review workflow skill
tools/
  gitea-pr-diff.ts
  gitea-incremental-diff.ts
  gitea-review.ts
  gitea-comment.ts
  gitea-pr-files.ts
tests/
  gitea-pr-diff.test.ts
  gitea-incremental-diff.test.ts
  gitea-review-tags.test.ts
  gitea-review-stats.test.ts
```

## Runtime Flow

1. Agent/skill chooses review strategy.
2. Tooling fetches PR changes from Gitea/Forgejo APIs.
3. Agent produces findings and submits comments/review state through tool calls.

## Environment

- `GITEA_TOKEN` / `GITHUB_TOKEN`
- `GITEA_SERVER_URL` / `GITHUB_SERVER_URL`

`opencode.json` currently denies `edit`, `bash`, and `read` permissions by default.

## Commands

```bash
cd .opencode-review
bun test
```

## Notes

- Tool descriptions are stored in `tools/*.txt` for the tools that require external prompt text.
- Keep this directory self-contained; do not couple it to workspace package internals.
