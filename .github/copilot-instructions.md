# Copilot Instructions - OpenCode Gitea Review

## Project Overview

This is an **AI-powered Gitea/Forgejo PR code review tool** built on the [OpenCode](https://opencode.ai) plugin system. It listens for PR and comment events via Gitea Actions, automatically fetches code diffs, and submits structured reviews.

## Architecture

```
.gitea/workflows/              → Gitea Actions workflow
.opencode-review/              → ISOLATED config directory (not .opencode/)
├── agents/                    → AI Agent definitions (Markdown + YAML frontmatter)
├── tools/                     → Custom tools (TypeScript with @opencode-ai/plugin)
├── skills/                    → Reusable skills (SKILL.md format)
├── opencode.json              → OpenCode config
└── package.json               → Tool dependencies
```

> **Important**: This project uses `.opencode-review/` instead of `.opencode/` to avoid conflicts with user's existing OpenCode configuration.

## Custom Tool Pattern

All tools follow a unified structure (see `.opencode-review/tools/gitea-review.ts`):

```typescript
import { tool } from "@opencode-ai/plugin";

export default tool({
  description: "Tool description",
  args: {
    param: tool.schema.string().describe("Parameter description"),
  },
  async execute(args, context) {
    // context contains directory, worktree, sessionID, etc.
    return "Result message";
  },
});
```

**Key conventions**:

- Filename = tool name (e.g., `gitea-review.ts` → tool `gitea-review`)
- Use `tool.schema` (Zod) for argument types
- `giteaFetch()` helper handles API authentication
- Supports both `GITEA_*` and `GITHUB_*` env vars for compatibility

## Agent Configuration Pattern

Agent files use Markdown + YAML frontmatter (see `.opencode-review/agents/code-review.md`):

```yaml
---
description: Agent description (required)
mode: primary | subagent
model: opencode/claude-sonnet-4-5
tools:
  "*": false # Disable all tools by default
  "gitea-review": true # Explicitly enable needed tools
---
System prompt content...
```

## Code Review Workflow

1. `gitea-pr-diff` → Fetch diff with line numbers (`[LINE_NUM] +/-/space` format)
2. Analyze code changes
3. `gitea-review` → Submit review (summary + line comments + approval)

**Line number format**: Review comments must reference code lines using `[line_number]` from diff output.

## Development Commands

```bash
cd .opencode-review && bun install    # Install dependencies
opencode run --agent code-review      # Test Agent locally
opencode agent create                 # Create new Agent (interactive)
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
