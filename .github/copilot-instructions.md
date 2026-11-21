# Copilot Instructions - OpenCode Gitea Review

## Project Overview

This is an **AI-powered Gitea/Forgejo PR code review tool** built on the [OpenCode](https://opencode.ai) plugin system. It supports two installation methods: Docker-based and source-based. It listens for PR and comment events via Gitea Actions, automatically fetches code diffs, and submits structured reviews.

## Architecture

```
.
├── Dockerfile                 → Docker image definition
├── docker-compose.yaml        → Local testing
├── entrypoint.sh              → Container entrypoint with env var handling
├── install.sh                 → Interactive installer (--docker/--source/--both)
├── templates/
│   ├── workflow-docker.yaml   → Docker-based workflow template
│   └── workflow-source.yaml   → Source-based workflow template
├── .github/workflows/
│   └── docker-publish.yaml    → Auto-build Docker image to ghcr.io
├── .gitea/workflows/          → Gitea Actions workflow
└── .opencode-review/          → ISOLATED config directory (not .opencode/)
    ├── agents/                → AI Agent definitions (Markdown + YAML frontmatter)
    ├── plugins/gitea-review/  → OpenCode V2 plugin that registers the tools (@opencode/plugin)
    ├── tools/                 → Tool definitions (zod input schema + execute)
    ├── skills/                → Reusable skills (SKILL.md format)
    ├── opencode.json          → OpenCode config
    └── package.json           → Tool dependencies
```

> **Important**: This project uses `.opencode-review/` instead of `.opencode/` to avoid conflicts with user's existing OpenCode configuration.

## Installation Methods

| Method               | Command               | Files Added                  |
| -------------------- | --------------------- | ---------------------------- |
| Docker (Recommended) | `bash -s -- --docker` | 1 workflow file              |
| Source               | `bash -s -- --source` | .opencode-review/ + workflow |
| Both                 | `bash -s -- --both`   | Both for customization       |

## Custom Tool Pattern

All tools follow a unified structure (see `.opencode-review/tools/gitea-review.ts`):

```typescript
import { z } from "zod";
import { giteaTool } from "../lib/tool";

export default giteaTool({
  name: "my-tool",
  description: "Tool description",
  input: z.object({
    param: z.string().describe("Parameter description"),
  }),
  async execute(input, context) {
    // context.sessionID identifies the OpenCode session
    return "Result message";
  },
});
```

**Key conventions**:

- Filename = tool name (e.g., `gitea-review.ts` → tool `gitea-review`)
- Register each tool in `.opencode-review/plugins/gitea-review/index.ts`
- Use zod for the input schema; `giteaTool` registers it as a direct (non-Code Mode) tool
- `giteaFetch()` helper handles API authentication
- Supports both `GITEA_*` and `GITHUB_*` env vars for compatibility

## Agent Configuration Pattern

Agent files use Markdown + YAML frontmatter (see `.opencode-review/agents/code-review.md`):

```yaml
---
description: Agent description (required)
mode: primary | subagent
# Model is configured via MODEL env var or opencode.json
permissions: # Ordered rules; the last match wins
  - { action: "*", resource: "*", effect: deny } # Deny all tools by default
  - { action: gitea-review, resource: "*", effect: allow } # Explicitly allow needed tools
---
System prompt content...
```

## Code Review Workflow

1. `gitea-pr-diff` → Fetch full diff with line numbers (`[NEW:行号] +/-/space` format)
2. `gitea-incremental-diff` → (Optional) Fetch only new changes since last review
3. Analyze code changes and categorize issues with structured tags
4. `gitea-review` → Submit review (summary + line comments + approval)

**Available Tools**:
- `gitea-pr-diff` - Full PR diff
- `gitea-incremental-diff` - Incremental diff (new changes only)
- `gitea-pr-files` - List changed files
- `gitea-review` - Submit structured review
- `gitea-comment` - Post general comments (used by gitea-assistant agent)

**Structured Tags**: Use `**[CATEGORY:SEVERITY]**` format in comments:
- Categories: BUG, SECURITY, PERFORMANCE, STYLE, DOCS, TEST
- Severities: CRITICAL, HIGH, MEDIUM, LOW

## Development Commands

```bash
cd .opencode-review && bun install    # Install dependencies
opencode run --standalone --agent code-review   # Test Agent locally
opencode debug agents --standalone              # Show resolved agents and permissions
```

## Isolation Strategy

This tool is designed to NOT interfere with user's development environment:

- Uses **`OPENCODE_CONFIG_DIR`** environment variable to point to `.opencode-review/`
- Based on [OpenCode official documentation](https://opencode.ai/docs/config/#custom-directory)
- All tools prefixed with `gitea-` to avoid naming conflicts
- Agents explicitly declare tool permissions (`"*": false` + whitelist)
- User's local `opencode` TUI won't see these agents (no env var set locally)

## Notes

- Restart OpenCode after modifying tools to reload
- Review comments can only reference lines in the diff
- Gitea Actions trigger keywords: `/oc` or `/opencode`
