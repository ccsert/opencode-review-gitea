# OpenCode Gitea Review

[![OpenCode](https://img.shields.io/badge/OpenCode-AI%20Code%20Review-blue)](https://opencode.ai)
[![Docker Image](https://img.shields.io/badge/Docker-ghcr.io-blue)](https://ghcr.io/ccsert/opencode-review)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[中文文档](README_zh.md) | English

An AI-powered **automatic code review tool for Gitea/Forgejo PRs**, built on the [OpenCode](https://opencode.ai) plugin system. It listens for PR and comment events via Gitea Actions, automatically fetches code diffs, and submits structured reviews.

## ✨ Features

- 🤖 **AI-Powered Code Review** - Uses Claude/GPT/DeepSeek models to analyze code changes
- 📝 **Line-Level Comments** - Provides precise feedback on specific code lines
- ✅ **Review Decisions** - Supports approve, request_changes, and comment states
- 🔄 **Auto-Trigger** - Triggered by `/oc` or `/opencode` comments
- � **Incremental Review** - Only reviews new changes since last review (for updated PRs)
- 🏷️ **Structured Tags** - Categorizes issues by type (BUG, SECURITY, PERFORMANCE) and severity
- �🐳 **Docker Support** - Zero-config installation with pre-built image
- 🛡️ **Isolated Configuration** - Uses `.opencode-review/` directory, won't conflict with your existing `.opencode/` setup
- 🔗 **Webhook Management** - Real-time webhook querying and management (no database required)
- 🌐 **Internationalization** - Full support for English and Chinese (en, zh-CN)

## 📦 Installation

### Interactive Installation (Recommended)

Run in your project root:

```bash
curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash
```

You'll see an interactive menu to choose your installation method.

### Direct Installation Options

```bash
# Docker-based (Recommended) - Zero files added to repo
curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash -s -- --docker

# Source-based - Full customization
curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash -s -- --source

# Both methods
curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash -s -- --both
```

## 🔄 Installation Methods Comparison

| Aspect | Docker 🐳 | Source 📦 |
|--------|----------|-----------|
| **Files added** | 1 workflow file | .opencode-review/ + workflow |
| **CI speed** | Fast (cached image) | Slower (install deps each run) |
| **Customization** | Environment variables | Full control over agents/tools |
| **Updates** | Automatic with `:latest` | Manual update required |
| **Best for** | Quick setup, standard use | Custom prompts, advanced users |

## ⚙️ Configuration

### 1. Set Up Secrets

Configure the following secrets in your Gitea repository:

| Secret Name | Description |
|-------------|-------------|
| `OPENCODE_GIT_TOKEN` | Gitea API Token (requires repo permissions) |
| `DEEPSEEK_API_KEY` | DeepSeek API Key (default model) |

### 2. Configure Model (Optional)

Edit `.gitea/workflows/opencode-review.yaml`:

```yaml
env:
  # Format: provider/model-id
  MODEL: deepseek/deepseek-chat        # Default (requires DEEPSEEK_API_KEY)
  # MODEL: anthropic/claude-sonnet-4-5  # Requires ANTHROPIC_API_KEY
  # MODEL: openai/gpt-4o                # Requires OPENAI_API_KEY
```

### 3. Review Configuration

These options work with both Docker and Source installations:

```yaml
env:
  # Response language
  REVIEW_LANGUAGE: auto      # auto | en | zh-CN
  
  # Review depth and focus
  REVIEW_STYLE: balanced     # concise | balanced | thorough | security
  
  # File filtering (glob patterns, comma-separated)
  FILE_PATTERNS: ""          # e.g., "*.ts,*.go,src/**" (empty = all files)
```

#### Language Options

| Value | Description |
|-------|-------------|
| `auto` | Auto-detect from code comments (default) |
| `en` | Review in English |
| `zh-CN` | 使用简体中文审查 |

#### File Filtering Examples

```yaml
# Only review TypeScript files
FILE_PATTERNS: "*.ts,*.tsx"

# Only review source files (exclude tests)
FILE_PATTERNS: "src/**/*.go"

# Multiple patterns
FILE_PATTERNS: "*.py,*.js"

# Note: currently only positive matching is supported (no leading '!').
```

## 🚀 Usage

### Trigger Code Review

Comment on a PR:

```
/oc
```

or

```
/opencode please review this PR
```

### Local Testing (Docker)

```bash
docker run --rm \
  -v $(pwd):/workspace \
  -e GITEA_TOKEN="your-token" \
  -e GITEA_SERVER_URL="https://your-gitea.example.com" \
  -e DEEPSEEK_API_KEY="your-key" \
  -e PR_NUMBER=123 \
  -e REPO_OWNER="your-org" \
  -e REPO_NAME="your-repo" \
  ghcr.io/ccsert/opencode-review:latest
```

`REPO_NAME` can be either `repo` or `owner/repo` (entrypoint will normalize it).

### Local Testing (Source)

```bash
export GITEA_TOKEN="your-token"
export GITEA_SERVER_URL="https://your-gitea.example.com"
export OPENCODE_CONFIG_DIR="$(pwd)/.opencode-review"

opencode run --agent code-review \
  "Please review PR #123 in owner/repo"
```

## 🔧 Customization (Source Installation)

### Modify Review Style

Edit `.opencode-review/agents/code-review.md`:

```markdown
---
description: AI code reviewer for Gitea/Forgejo PRs
tools:
  "*": false
  "gitea-review": true
  "gitea-pr-diff": true
---

You are a code review expert focusing on [your domain]...
```

### Add New Tools

Create a TypeScript file in `.opencode-review/tools/`:

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Tool description",
  args: {
    param: tool.schema.string().describe("Parameter description"),
  },
  async execute(args, context) {
    return "Result"
  },
})
```

## 📁 Project Structure

```
.
├── Dockerfile                      # Docker image definition
├── docker-compose.yaml             # Local testing
├── entrypoint.sh                   # Container entrypoint
├── install.sh                      # Installation script
├── templates/
│   ├── workflow-docker.yaml        # Docker workflow template
│   └── workflow-source.yaml        # Source workflow template
├── .github/workflows/
│   └── docker-publish.yaml         # Auto-build Docker image
└── .opencode-review/               # Isolated config directory
    ├── agents/
    │   ├── code-review.md          # Code review agent (main)
    │   ├── gitea-assistant.md      # General assistant agent
    │   └── webhook-manager.md      # Webhook management agent
    ├── tools/
    │   ├── gitea-pr-diff.ts        # Get full PR diff
    │   ├── gitea-pr-files.ts       # List changed files
    │   ├── gitea-incremental-diff.ts # Get incremental diff (new changes only)
    │   ├── gitea-review.ts         # Submit review with comments
    │   ├── gitea-comment.ts        # Post comments on issues/PRs
    │   ├── gitea-webhook-list.ts   # List webhooks (real-time)
    │   ├── gitea-webhook-create.ts # Create webhooks
    │   ├── gitea-webhook-delete.ts # Delete webhooks
    │   ├── gitea-webhook-update.ts # Update webhooks
    │   └── i18n.ts                 # Internationalization utilities
    ├── locales/
    │   ├── en.json                 # English translations
    │   └── zh-CN.json              # Chinese translations
    ├── skills/
    │   └── pr-review/SKILL.md      # Reusable review skill
    └── package.json                # Dependencies
```

> **Note**: After installation, `.gitea/workflows/opencode-review.yaml` will be created in your project.

## 🔗 Webhook Management

This project includes comprehensive webhook management tools. See [WEBHOOK_GUIDE.md](WEBHOOK_GUIDE.md) for:
- Real-time webhook querying (no database)
- Creating and deleting webhooks
- Fixing "Repository has no access token configured" errors
- Webhook security best practices
- Full internationalization support

## 🔗 Related Links

- [OpenCode Documentation](https://opencode.ai/docs)
- [OpenCode Custom Tools](https://opencode.ai/docs/custom-tools/)
- [Gitea API Documentation](https://docs.gitea.io/en-us/api-usage/)
- [Docker Image](https://ghcr.io/ccsert/opencode-review)

## 📄 License

MIT License - See [LICENSE](LICENSE)
