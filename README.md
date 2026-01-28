# OpenCode Gitea Review

[![OpenCode](https://img.shields.io/badge/OpenCode-AI%20Code%20Review-blue)](https://opencode.ai)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[中文文档](README_zh.md) | English

An AI-powered **automatic code review tool for Gitea/Forgejo PRs**, built on the [OpenCode](https://opencode.ai) plugin system. It listens for PR and comment events via Gitea Actions, automatically fetches code diffs, and submits structured reviews.

## ✨ Features

- 🤖 **AI-Powered Code Review** - Uses Claude/GPT models to analyze code changes
- 📝 **Line-Level Comments** - Provides precise feedback on specific code lines
- ✅ **Review Decisions** - Supports approve, request_changes, and comment states
- 🔄 **Auto-Trigger** - Triggered by `/oc` or `/opencode` comments
- 🛡️ **Isolated Configuration** - Uses `.opencode-review/` directory, won't conflict with your existing `.opencode/` setup

## 📦 Quick Installation

### Option 1: One-Line Install Script (Recommended)

Run in your project root:

```bash
curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash
```

### Option 2: Manual Installation

```bash
# 1. Clone the repository
git clone https://github.com/ccsert/opencode-review-gitea.git /tmp/opencode-review-gitea

# 2. Copy files to your project
cp -r /tmp/opencode-review-gitea/.opencode-review .
mkdir -p .gitea/workflows
cp /tmp/opencode-review-gitea/.gitea/workflows/opencode-review.yaml .gitea/workflows/

# 3. Install dependencies
cd .opencode-review && bun install && cd ..

# 4. Cleanup
rm -rf /tmp/opencode-review-gitea
```

## ⚙️ Configuration

### 1. Set Up Secrets

Configure the following secrets in your Gitea repository:

| Secret Name | Description |
|-------------|-------------|
| `OPENCODE_GIT_TOKEN` | Gitea API Token (requires repo permissions) |
| `DEEPSEEK_API_KEY` | DeepSeek API Key (or other LLM provider) |

### 2. Configure Model (Optional)

Edit `.gitea/workflows/opencode-review.yaml` to change the default model:

```yaml
env:
  MODEL: opencode/claude-sonnet-4-5  # or opencode/gpt-4o etc.
```

### 3. Isolated from Your Development Environment

This tool uses the **`OPENCODE_CONFIG_DIR`** environment variable ([official docs](https://opencode.ai/docs/config/#custom-directory)) to load agents from `.opencode-review/` instead of `.opencode/`:

```
.opencode-review/           # ← Isolated! Won't affect your .opencode/
├── agents/                 # AI Agent definitions
├── tools/                  # Custom Gitea API tools
├── skills/                 # Reusable skills
└── package.json            # Dependencies
```

**Why this matters:**
- Your existing `.opencode/` configuration remains untouched
- The CI workflow sets `OPENCODE_CONFIG_DIR` to point to `.opencode-review/`
- Locally, without this env var, `opencode` only sees your `.opencode/`
- No tool naming conflicts

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

### Local Testing

```bash
# Set environment variables
export GITEA_TOKEN="your-token"
export GITEA_SERVER_URL="https://your-gitea.example.com"
export PR_NUMBER=123
export REPO_OWNER="your-org"
export REPO_NAME="your-repo"

# IMPORTANT: Set custom config directory
export OPENCODE_CONFIG_DIR="$(pwd)/.opencode-review"

# Run review
opencode run --agent code-review \
  "Please review PR #${PR_NUMBER} in ${REPO_OWNER}/${REPO_NAME}"
```

## 🔧 Customization

### Modify Review Style

Edit `.opencode-review/agents/code-review.md`:

```markdown
---
description: AI code reviewer for Gitea/Forgejo PRs
model: opencode/claude-sonnet-4-5
tools:
  "*": false
  "gitea-review": true
  "gitea-pr-diff": true
---

You are a code review expert focusing on [your domain]...
```

### Add New Tools

Create a new TypeScript file in `.opencode-review/tools/`:

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Tool description",
  args: {
    param: tool.schema.string().describe("Parameter description"),
  },
  async execute(args, context) {
    // Tool logic
    return "Result"
  },
})
```

## 📁 Project Structure

```
.
├── .gitea/
│   └── workflows/
│       └── opencode-review.yaml    # Gitea Actions workflow
└── .opencode-review/               # Isolated config directory
    ├── agents/
    │   ├── code-review.md          # Code review agent
    │   └── gitea-assistant.md      # General assistant agent
    ├── tools/
    │   ├── gitea-comment.ts        # Post comments
    │   ├── gitea-pr-diff.ts        # Get PR diff
    │   └── gitea-review.ts         # Submit review
    ├── skills/
    │   └── pr-review/
    │       └── SKILL.md            # PR review skill
    ├── opencode.json               # OpenCode config
    └── package.json                # Dependencies
```

## 🔗 Related Links

- [OpenCode Documentation](https://opencode.ai/docs)
- [OpenCode Custom Tools](https://opencode.ai/docs/custom-tools/)
- [OpenCode Agent Configuration](https://opencode.ai/docs/agents/)
- [Gitea API Documentation](https://docs.gitea.io/en-us/api-usage/)

## 📄 License

MIT License - See [LICENSE](LICENSE)
