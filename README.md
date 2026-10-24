# OpenCode Gitea Review

[![OpenCode](https://img.shields.io/badge/OpenCode-AI%20Code%20Review-blue)](https://opencode.ai)
[![Docker Image](https://img.shields.io/badge/Docker-ghcr.io-blue)](https://ghcr.io/ccsert/opencode-review)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[中文文档](README_zh.md) | English

An AI-powered **code review tool for Gitea/Forgejo PRs**, built on the [OpenCode](https://opencode.ai) plugin system. Run it externally with Docker for a selected repository/PR, or trigger it through Gitea Actions. It fetches code diffs and either submits a structured review or saves a draft for a human reviewer.

## ✨ Features

- 🤖 **AI-Powered Code Review** - Uses Claude/GPT/DeepSeek models to analyze code changes
- 📝 **Line-Level Comments** - Provides precise feedback on specific code lines
- ✅ **Review Decisions** - Supports approve, request_changes, and comment states
- ✍️ **Draft Reviews** - Save pending comments under the human reviewer's account, then edit and submit in the native UI
- 🔄 **Auto-Trigger** - Triggered by `/oc` or `/opencode` comments
- 🔁 **Incremental Review** - Only reviews new changes since last review (for updated PRs)
- 🏷️ **Structured Tags** - Categorizes issues by type (BUG, SECURITY, PERFORMANCE) and severity
- 📏 **Team Standards** - Checks PRs against your coding standards from the base branch, a shared repository or a URL
- 🧩 **Review Templates & Skills** - Six built-in templates or your own, plus language checklists loaded on demand
- 🐳 **Docker Support** - Zero-config installation with pre-built image
- 🛡️ **Isolated Configuration** - Uses `.opencode-review/` directory, won't conflict with your existing `.opencode/` setup

## 📦 Installation

For manual reviews without installing anything in the target repository, use
[external Docker draft mode](#draft-first-submit-manually). It needs no workflow,
checkout or target-code mount. See the [screenshots and validation](docs/draft-review-validation.md).

### Docker Setup for Actions Without an Install Script

Docker setup only needs **one workflow file**. You do not need to run `install.sh` or add `.opencode-review/` to your repository.

1. Open the [Docker workflow template](templates/workflow-docker.yaml), inspect it, and save it as `.gitea/workflows/opencode-review.yaml` in your project. Alternatively, download the file without executing it:

   ```bash
   mkdir -p .gitea/workflows
   curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/templates/workflow-docker.yaml \
     -o .gitea/workflows/opencode-review.yaml
   ```

   If that workflow already exists, compare the template with your file before replacing it. For a reviewed release or commit, replace `main` in the URL with that tag or full commit SHA.

2. Review the workflow, adjust `runs-on` for your Gitea/Forgejo runner, and choose your `MODEL` and API key. Configure `OPENCODE_GIT_TOKEN` and the matching model provider key in [repository secrets](#1-set-up-secrets). Enable Actions for the repository if needed.
3. Commit the workflow to your default branch. Open a PR or comment `/oc` on a PR to trigger a review.

The workflow uses `ghcr.io/ccsert/opencode-review:latest`, which includes the agents, tools, and runtime dependencies. See [Docker image updates](#docker-image-updates) for refresh and pinning options.

### Optional Interactive Installer

Run in your project root:

```bash
curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash
```

You'll see an interactive menu to choose your installation method.

### Optional Installer Options

```bash
# Docker-based - Adds one workflow file
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
| **Updates** | Weekly rebuilds; pull `:latest` | Update copied files manually; CLI installed each CI run |
| **Best for** | Quick setup, standard use | Custom prompts, advanced users |

### Docker Image Updates

The [Docker publishing workflow](.github/workflows/docker-publish.yaml) builds on relevant changes to `main` and version tags, and rebuilds every Monday at 04:23 UTC. Scheduled and manual builds bypass the build cache and pull the base image so that new OpenCode releases are installed even when this repository has not changed.

Maintainers can also run **Docker Build & Publish** from GitHub Actions. The optional `opencode_version` input defaults to `latest` and can select an exact npm version for a manual build. For a local build, use `docker build --pull --no-cache --build-arg OPENCODE_VERSION=latest -t opencode-review:local .`.

To update a local installation, run `docker pull ghcr.io/ccsert/opencode-review:latest`. Gitea/Forgejo runners must also pull the updated image rather than reuse a cached tag. For reproducible reviews, pin the workflow's `container.image` to a published digest (`ghcr.io/ccsert/opencode-review@sha256:<digest>`); update that digest explicitly when ready.

## ⚙️ Configuration

### 1. Set Up Secrets

Configure the following secrets in your Gitea repository:

| Secret Name | Description |
|-------------|-------------|
| `OPENCODE_GIT_TOKEN` | Gitea API Token (requires repo permissions) |
| `DEEPSEEK_API_KEY` | DeepSeek API Key (default model) |
| `ANTHROPIC_API_KEY` | Anthropic API Key (optional) |
| `OPENAI_API_KEY` | OpenAI API Key (optional) |

### 2. Configure Model (Optional)

Edit `.gitea/workflows/opencode-review.yaml`:

```yaml
env:
  # Format: provider/model-id
  MODEL: deepseek/deepseek-chat        # Default (requires DEEPSEEK_API_KEY)
  # MODEL: anthropic/claude-sonnet-4-5  # Requires ANTHROPIC_API_KEY
  # MODEL: openai/gpt-4o                # Requires OPENAI_API_KEY
```


### 3. Custom / self-hosted gateways (advanced)

You can use self-hosted or alternative LLM gateways (9router, LiteLLM, Together AI, etc.) by defining a custom provider in `.opencode-review/opencode.json`. Unlike the simple `OPENAI_BASE_URL` approach which only works for cataloged providers, custom providers require explicit registration.

**When is this needed?** Only when BOTH are true:
- you use an OpenAI-compatible gateway (9router, LiteLLM, Together AI, ...), AND
- the model id you request is not known under any of opencode's built-in providers.

Gateways like LiteLLM and 9router often expose models under their own names (aggregator
prefixes, no provider prefix, or a custom `model_name`) that opencode's catalog does not know.
Examples of gateway-only ids that need a custom provider: `9router/deepseek-v4-pro`,
`9router/qwen3`, `litellm/my-custom-alias`. If instead the gateway serves a model id that the
catalog already knows (e.g. `openai/gpt-4o`, `deepseek/deepseek-v4-pro`, `anthropic/claude-...`),
no custom provider is required — set `OPENAI_BASE_URL` and use that id directly.

**Why `OPENAI_BASE_URL` alone fails**: The OpenCode catalog contains only predefined providers (OpenAI, DeepSeek, Anthropic, etc.). Setting `OPENAI_BASE_URL` without a custom provider name won't work because opencode validates the model ID against its built-in catalog and routes requests through a recognized provider. The result is a `ProviderModelNotFoundError`. Custom providers require explicit registration via the `@ai-sdk/openai-compatible` package.

**When is a custom provider required?** A custom provider is needed when BOTH are true:
- you use an OpenAI-compatible gateway (9router, LiteLLM, Together AI, ...), AND
- the model id you request is not known under any of opencode's built-in providers.

Gateways like LiteLLM and 9router often expose models under their own names (aggregator
prefixes, no provider prefix, or a custom `model_name`) that opencode's catalog does not know.
Examples of gateway-only ids that need a custom provider: `9router/deepseek-v4-pro`,
`9router/qwen3`, `litellm/my-custom-alias`. If instead the gateway serves a model id that the
catalog already knows (e.g. `openai/gpt-4o`, `deepseek/deepseek-v4-pro`, `anthropic/claude-...`),
no custom provider is required — set `OPENAI_BASE_URL` and use that id directly.

**Custom provider JSON** (add to `.opencode-review/opencode.json`):

```json
{
  "provider": {
    "opencode-review-provider": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "opencode-review-provider",
      "options": {
        "baseURL": "{env:OPENAI_BASE_URL}",
        "apiKey": "{env:OPENAI_API_KEY}"
      },
      "models": {
        "my-model": { "name": "My Model" }
      }
    }
  }
}
```

> **Tune per-model options:** each entry in `models` can also carry gateway-facing attributes.
> Useful examples: remap the id sent to the gateway (`modelID`), set the reasoning level
> (`settings.reasoningEffort`), and control sampling (`body`).

```json
{
  "provider": {
    "opencode-review-provider": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "{env:OPENAI_BASE_URL}", "apiKey": "{env:OPENAI_API_KEY}" },
      "models": {
        "deepseek-v4-pro": {
          "name": "DeepSeek V4 Pro",
          "modelID": "your-gateway-deployment-id",
          "settings": { "reasoningEffort": "high" },
          "body": { "temperature": 0.2 }
        }
      }
    }
  }
}
```

> Note: numeric sampling params like `temperature` go under `body` (a top-level numeric
> `temperature` is not accepted). `limit`/token caps are not yet supported for custom providers.

### Per-model options

Each model entry in the `models` object can carry gateway-facing attributes:

- `modelID`: remap the ID sent to the gateway (useful when the model name differs from the deployment ID)
- `settings.reasoningEffort`: set the reasoning effort level (`low`, `medium`, `high`)
- `body.temperature`: control sampling temperature (0.0 to 1.0)

```json
{
  "provider": {
    "opencode-review-provider": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "{env:OPENAI_BASE_URL}", "apiKey": "{env:OPENAI_API_KEY}" },
      "models": {
        "deepseek-v4-pro": {
          "name": "DeepSeek V4 Pro",
          "modelID": "your-gateway-deployment-id",
          "settings": { "reasoningEffort": "high" },
          "body": { "temperature": 0.2 }
        }
      }
    }
  }
}
```

**Configuration** (`.gitea/workflows/opencode-review.yaml`):

```yaml
env:
  # Custom provider - model format: provider/model-name
  MODEL: opencode-review-provider/my-model
  # OpenAI-compatible gateway base URL and API key referenced by {env:...} in opencode.json
  OPENAI_BASE_URL: "https://your-gateway.example.com/v1"
  OPENAI_API_KEY: "your-gateway-api-key"
```

**Example**: `MODEL=opencode-review-provider/my-model`

> **Note**: For catalog providers (OpenAI, DeepSeek, Anthropic), continue using `MODEL: openai/<model-name>` with `OPENAI_API_KEY` and `OPENAI_BASE_URL` as described in the [Model Configuration](#2-configure-model) section.

### 4. Review Configuration

These options work with both Docker and Source installations:

```yaml
env:
  # Response language
  REVIEW_LANGUAGE: auto      # auto | en | zh-CN
  
  # Review depth and focus
  REVIEW_STYLE: balanced     # concise | balanced | thorough | security
  
  # File filtering (glob patterns, comma-separated)
  FILE_PATTERNS: ""          # e.g., "*.ts,*.go,src/**" (empty = all files)

  # Review template: built-in name, or a path/URL (default: derived from REVIEW_STYLE)
  REVIEW_TEMPLATE: ""        # standard | concise | thorough | security | performance | compliance

  # Team review standards (default: .gitea/review-rules[.md] and .forgejo/review-rules[.md])
  REVIEW_RULES: ""           # e.g., "docs/standards/, org/standards:backend@v2, https://example.com/api.md"

  # Refresh the model catalog before review (set to "false" to skip)
  OPENCODE_REFRESH_MODELS: "true"
```

Before each review, Docker and source workflows run [`opencode models --refresh`](https://opencode.ai/docs/cli/#models). If refreshing fails, a warning is logged and the review continues with the cached catalog. For offline or fully custom provider setups, set `OPENCODE_REFRESH_MODELS: "false"`. For local source runs, execute `opencode models --refresh` before `opencode run` as shown below.

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

A pattern without `/` matches the file name at any depth (`*.ts` matches `src/a.ts`), like `.gitignore`. `**/` also matches zero directories (`src/**/*.ts` matches `src/a.ts`).

#### Review Templates

`REVIEW_TEMPLATE` selects the focus, summary format and approval rules of the review:

| Template | Use for |
|----------|---------|
| `standard` | Bugs, security, performance and maintainability, grouped by severity (default) |
| `concise` | Only blocking issues; short summary |
| `thorough` | Adds error paths, concurrency, compatibility, test coverage and rollout risk |
| `security` | Input → sink → impact analysis; never auto-approves auth, crypto or CI secret changes |
| `performance` | Hot paths, N+1 queries, unbounded memory, blocking I/O, with the data size that matters |
| `compliance` | A checklist of every applicable team standard: complies / violates / not affected |

When unset, `REVIEW_STYLE` maps to `concise`, `thorough`, `security` or `standard`. A custom template is a Markdown file given as a repository path (read from the PR base commit), `owner/repo:path[@ref]`, or URL. Start from one of the [built-in templates](.opencode-review/review-templates/); keep a `**Decision**` section so the model knows when to approve.

#### Team Review Standards

Point `REVIEW_RULES` at your coding standards and the reviewer checks the diff against them, citing `Standard: <source>` on each violation. Sources are comma- or newline-separated:

| Source | Example | Read from |
|--------|---------|-----------|
| Repository path (file or directory of `.md`/`.txt`) | `docs/standards/` | The PR's **base commit**, so a PR cannot relax the standards it is reviewed against |
| Shared repository | `org/standards:backend/go.md@v2` | That repository on the same Gitea server (the token needs read access); `@ref` is optional |
| URL | `https://wiki.example.com/api-rules.md` | HTTP(S); the Gitea token is sent only to the Gitea server's own origin |

Without `REVIEW_RULES`, `.gitea/review-rules.md`, `.gitea/review-rules/`, `.forgejo/review-rules.md` and `.forgejo/review-rules/` are loaded when they exist. A configured source that cannot be read stops the run before any review is published. `REVIEW_RULES: none` disables standards.

A standards file can limit itself to some files with frontmatter, so large rule sets only cost tokens when relevant:

```markdown
---
title: Go error handling
paths: ["*.go"]
---
- Errors MUST be wrapped with `%w` and context: `fmt.Errorf("load user %d: %w", id, err)`.
- Never ignore the error returned by `Close` on writers.
```

Applicable standards are limited to `REVIEW_RULES_MAX_BYTES` (default 30000); split large sets with `paths:`. Combine with `REVIEW_TEMPLATE: compliance` for a rule-by-rule checklist.

#### Review Skills

The reviewer loads built-in checklists on demand for the languages and areas in the diff: `review-security`, `review-typescript`, `review-python`, `review-go`, `review-java` (Java/Kotlin), `review-sql` (queries and migrations), `review-frontend`, `review-infra` (Docker, Kubernetes, Terraform, CI) and `review-tests`. They live in [`.opencode-review/skills/`](.opencode-review/skills/). Team-specific checklists belong in `REVIEW_RULES`, which is pinned to the base commit.

#### Configuration Trust and Fork PRs

The review reads the PR through the Gitea API and never needs the PR's code, so the workflows keep it out of the job that holds the token and model keys:

- The Docker workflow does not check out the repository. The image ignores `.opencode-review/` in the workspace (`/workspace` or `$GITHUB_WORKSPACE`) unless `OPENCODE_REVIEW_TRUST_WORKSPACE_CONFIG=true`; enable that only for a trusted checkout. To customize the Docker image, mount your configuration at `/app/.opencode-review` or set `OPENCODE_CONFIG_DIR` to a path outside the workspace.
- The source workflow checks out only `.opencode-review/` from the PR's base commit (the default branch for `/oc` comments). Changes a PR makes to `.opencode-review/` take effect after it is merged, so the PR that first adds `.opencode-review/` cannot review itself: merge it, then open or comment on the next PR.
- Gitea and Forgejo do not pass repository secrets to `pull_request` workflows from forks, so fork PRs are not reviewed with these templates. `pull_request_target` runs the base branch's workflow with secrets; these templates never run fork code there, but the fork's diff still reaches a model that can approve. Use it only with an approval policy you accept.

#### Large PRs

OpenCode truncates tool output above 2000 lines or 50 KiB. The diff tools therefore return large diffs in pages (`REVIEW_DIFF_PAGE_BYTES`, default 40000), and a review is refused until every page of the run has been read.

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
  -e GITEA_TOKEN="your-token" \
  -e GITEA_SERVER_URL="https://your-gitea.example.com" \
  -e DEEPSEEK_API_KEY="your-key" \
  -e PR_NUMBER=123 \
  -e REPO_OWNER="your-org" \
  -e REPO_NAME="your-repo" \
  ghcr.io/ccsert/opencode-review:latest
```

`REPO_NAME` can be either `repo` or `owner/repo` (entrypoint will normalize it).

The image is published for `linux/amd64` and `linux/arm64`. A mounted project is used only for inferring `GITEA_SERVER_URL`; its `.opencode-review/` is ignored unless `OPENCODE_REVIEW_TRUST_WORKSPACE_CONFIG=true`.

### Draft first, submit manually

Set `REVIEW_MODE=draft` and mount a persistent `REVIEW_OUTPUT_DIR`. The same
external Docker command can review any authorized repository/PR without adding
a workflow or checking out its code. The default remains `REVIEW_MODE=submit`.

For an unreleased change, first [build the checked-out source](docs/draft-review.md#choose-an-image)
and set `REVIEW_IMAGE` to that local image; the published `latest` tag does not
include a PR until it has been merged and its publishing workflow succeeds.
Export `GITEA_TOKEN`, `GITEA_SERVER_URL` and your model provider key in your shell.

```bash
mkdir -p review-output
docker run --rm \
  -v "$(pwd)/review-output:/review-output" \
  -e GITEA_TOKEN -e GITEA_SERVER_URL -e DEEPSEEK_API_KEY \
  -e REPO_OWNER="your-org" -e REPO_NAME="your-repo" -e PR_NUMBER=123 \
  -e REVIEW_MODE=draft -e REVIEW_OUTPUT_DIR=/review-output \
  "${REVIEW_IMAGE:-ghcr.io/ccsert/opencode-review:latest}"
```

Use the actual human reviewer's token. Open the returned **Files** page with that
same account, edit its pending line comments, copy the exported Markdown summary
into the review form, and manually choose Comment, Approve or Request Changes.
The native editor does not prefill summaries. AI summaries stay local: some
server versions expose pending review bodies through their timeline API.

Repeated draft runs reuse the original review. Manual edits and existing pending
reviews are preserved; conflicts stop the run. A manually submitted draft is
acknowledged without becoming an automatic incremental-review baseline.
See [draft lifecycle, server compatibility and recovery](docs/draft-review.md),
including the Forgejo timeline-display limitation.

### Local Testing (Source)

The environment fixes the review target; the prompt cannot redirect it to another PR.

```bash
export GITEA_TOKEN="your-token"
export GITEA_SERVER_URL="https://your-gitea.example.com"
export OPENCODE_CONFIG_DIR="$(pwd)/.opencode-review"
export REPO_OWNER="owner"
export REPO_NAME="repo"
export PR_NUMBER=123

opencode models --refresh
bun .opencode-review/run-review.ts \
  "Please review PR #123 in owner/repo"
```

## 🔧 Customization (Source Installation)

### Verified review execution and local tests

The Docker entrypoint and source workflows use `run-review.ts`. A run succeeds only
after its Gitea review and line comments have been read back. Reviews are bound to
the captured base/head; changed PRs fail with `PR_CHANGED`. Repeated runs reuse a
confirmed review. Ambiguous write outcomes are queried instead of blindly retried.

See [local Gitea/Forgejo setup, tests, and retry/state requirements](docs/local-testing.md).
That guide also explains the shared-state requirement for concurrent independent
runners and the deterministic model fixture used in CI.

### Modify Review Style

For the review focus and summary format, prefer a custom `REVIEW_TEMPLATE` and `REVIEW_RULES` (see [Review Configuration](#4-review-configuration)); they work with the Docker image too. To change the agent itself, edit `.opencode-review/agents/code-review.md`:

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
    │   └── gitea-assistant.md      # General assistant agent
    ├── tools/
    │   ├── gitea-pr-diff.ts        # Get full PR diff
    │   ├── gitea-pr-files.ts       # List changed files
    │   ├── gitea-incremental-diff.ts # Get incremental diff (new changes only)
    │   ├── gitea-review.ts         # Submit review with comments
    │   └── gitea-comment.ts        # Post comments on issues/PRs
    ├── lib/                        # Diff, snapshot, standards and publication logic
    ├── review-templates/           # Built-in review templates (REVIEW_TEMPLATE)
    ├── skills/
    │   └── review-*/SKILL.md       # Language and domain checklists loaded on demand
    └── package.json                # Dependencies
```

> **Note**: After installation, `.gitea/workflows/opencode-review.yaml` will be created in your project.

## 🔗 Related Links

- [OpenCode Documentation](https://opencode.ai/docs)
- [OpenCode Custom Tools](https://opencode.ai/docs/custom-tools/)
- [Gitea API Documentation](https://docs.gitea.io/en-us/api-usage/)
- [Docker Image](https://ghcr.io/ccsert/opencode-review)

## 📄 License

MIT License - See [LICENSE](LICENSE)
