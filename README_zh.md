# OpenCode Gitea Review

[![OpenCode](https://img.shields.io/badge/OpenCode-AI%20Code%20Review-blue)](https://opencode.ai)
[![Docker Image](https://img.shields.io/badge/Docker-ghcr.io-blue)](https://ghcr.io/ccsert/opencode-review)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

中文 | [English](README.md)

一个基于 [OpenCode](https://opencode.ai) 的 **Gitea/Forgejo PR 自动代码审查工具**。通过 Gitea Actions 监听 PR 和评论事件，AI Agent 自动获取代码差异并提交结构化审查。

## ✨ 功能特性

- 🤖 **AI 驱动的代码审查** - 使用 Claude/GPT/DeepSeek 等模型分析代码变更
- 📝 **行级评论** - 在具体代码行上提供精确反馈
- ✅ **审查决策** - 支持 approve、request_changes、comment 三种审查状态
- 🔄 **自动触发** - 通过 `/oc` 或 `/opencode` 评论触发审查
- 🔁 **增量审查** - 仅审查上次审查后的新变更（适用于 PR 更新）
- 🏷️ **结构化标签** - 按类型（BUG、SECURITY、PERFORMANCE）和严重程度分类问题
- 📏 **团队规范** - 按 base 分支、共享仓库或 URL 中的编码规范检查 PR
- 🧩 **审查模板与技能** - 6 个内置模板或自定义模板，按需加载语言检查清单
- 🐳 **Docker 支持** - 预构建镜像，零配置安装
- 🛡️ **隔离配置** - 使用独立的 `.opencode-review/` 目录，不会与你现有的 `.opencode/` 配置冲突

## 📦 安装

### 无需安装脚本的 Docker 接入（推荐）

Docker 接入只需要 **一个 workflow 文件**，无需执行 `install.sh`，也无需向仓库添加 `.opencode-review/`。

1. 打开并检查 [Docker workflow 模板](templates/workflow-docker.yaml)，将其保存为项目中的 `.gitea/workflows/opencode-review.yaml`。也可以仅下载文件，不执行下载的内容：

   ```bash
   mkdir -p .gitea/workflows
   curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/templates/workflow-docker.yaml \
     -o .gitea/workflows/opencode-review.yaml
   ```

   如果已有该 workflow，请先对比模板与现有文件，再决定是否替换。需要固定到已审核版本时，可将 URL 中的 `main` 换成对应 tag 或完整提交 SHA。

2. 检查 workflow，根据 Gitea/Forgejo runner 调整 `runs-on`，选择 `MODEL` 和 API key。在[仓库 Secrets](#1-设置-secrets) 中配置 `OPENCODE_GIT_TOKEN` 和对应模型服务的密钥，并按需启用仓库 Actions。
3. 将 workflow 提交到默认分支。创建 PR，或在 PR 中评论 `/oc`，即可触发审查。

workflow 使用的 `ghcr.io/ccsert/opencode-review:latest` 已包含 agents、工具和运行依赖。刷新镜像和固定版本的方法见 [Docker 镜像更新](#docker-镜像更新)。

### 可选：交互式安装脚本

在你的项目根目录执行：

```bash
curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash
```

你将看到一个交互式菜单来选择安装方式。

### 可选：安装脚本参数

```bash
# Docker 方式 - 添加一个 workflow 文件
curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash -s -- --docker

# 源码方式 - 完全可定制
curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash -s -- --source

# 两种方式都安装
curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash -s -- --both
```

## 🔄 安装方式对比

| 维度 | Docker 🐳 | 源码 📦 |
|-----|----------|--------|
| **添加的文件** | 1 个 workflow 文件 | .opencode-review/ + workflow |
| **CI 速度** | 快（使用缓存镜像） | 较慢（每次安装依赖） |
| **自定义能力** | 通过环境变量配置 | 完全控制 agents/tools |
| **更新方式** | 每周重建，拉取 `:latest` | 手动更新复制的文件；每次 CI 安装 CLI |
| **适合场景** | 快速上手、标准使用 | 自定义提示词、高级用户 |

### Docker 镜像更新

[Docker 发布流程](.github/workflows/docker-publish.yaml) 会在 `main` 相关代码或版本 tag 变更时构建，并在每周一 UTC 04:23（北京时间 12:23）重建。定时和手动构建会跳过构建缓存并拉取基础镜像，确保本仓库没有代码变更时，也能安装新的 OpenCode 版本。

维护者也可在 GitHub Actions 中手动运行 **Docker Build & Publish**。可选参数 `opencode_version` 默认为 `latest`，也可指定准确的 npm 版本。本地构建可运行 `docker build --pull --no-cache --build-arg OPENCODE_VERSION=latest -t opencode-review:local .`。

本地更新请运行 `docker pull ghcr.io/ccsert/opencode-review:latest`。Gitea/Forgejo runner 也需要拉取更新后的镜像，避免复用已缓存的 tag。如需可重复的审查环境，可将 workflow 的 `container.image` 固定为已发布摘要（`ghcr.io/ccsert/opencode-review@sha256:<digest>`），并在准备更新时显式修改摘要。

## ⚙️ 配置

### 1. 设置 Secrets

在你的 Gitea 仓库中配置以下 Secrets：

| Secret 名称 | 说明 |
|------------|------|
| `OPENCODE_GIT_TOKEN` | Gitea API Token（需要 repo 权限） |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（默认模型） |
| `ANTHROPIC_API_KEY` | Anthropic API Key（可选） |
| `OPENAI_API_KEY` | OpenAI API Key（可选） |

### 2. 配置模型（可选）

编辑 `.gitea/workflows/opencode-review.yaml`：

```yaml
env:
  # 格式：provider/model-id
  MODEL: deepseek/deepseek-chat        # 默认（需要 DEEPSEEK_API_KEY）
  # MODEL: anthropic/claude-sonnet-4-5  # 需要 ANTHROPIC_API_KEY
  # MODEL: openai/gpt-4o                # 需要 OPENAI_API_KEY
```



### 3. 自定义 / 自托管网关 (Custom / Self-Hosted Gateways)

你可以通过在 `.opencode-review/opencode.json` 中定义自定义 provider 来使用自建或替代的 LLM 网关（9router、LiteLLM、Together AI 等）。与仅适用于预设 provider 的简单 `OPENAI_BASE_URL` 方法不同，自定义 provider 需要显式注册。

**何时需要？** 仅当同时满足以下两个条件：
- 使用 OpenAI 兼容网关（9router、LiteLLM、Together AI 等），且
- 请求的模型 ID 不在 opencode 任何内置 provider 的目录中。

LiteLLM、9router 等网关常以自定义名称暴露模型（聚合前缀、不带 provider 前缀、或自定义
`model_name`），这些 ID opencode 目录并不认识。需要自定义 provider 的网关专属 ID 示例：
`9router/deepseek-v4-pro`、`9router/qwen3`、`litellm/my-custom-alias`。如果网关提供的是
目录中已有的模型 ID（如 `openai/gpt-4o`、`deepseek/deepseek-v4-pro`、`anthropic/claude-...`），
则无需自定义 provider —— 直接设置 `OPENAI_BASE_URL` 并使用该 ID 即可。

**为什么单独使用 `OPENAI_BASE_URL` 会失败**：OpenCode 的目录中仅包含预定义的 provider（OpenAI、DeepSeek、Anthropic 等）。没有 custom provider 名称的 `OPENAI_BASE_URL` 不会工作，因为 opencode 会按内置目录校验模型 ID 并通过已识别的 provider 路由请求，结果就是 `ProviderModelNotFoundError`。自定义 provider 需要通过 `@ai-sdk/openai-compatible` 显式注册。

**何时需要自定义 provider？** 同时满足以下两个条件时需要：
- 使用 OpenAI 兼容网关（9router、LiteLLM、Together AI 等），且
- 请求的模型 ID 不在 opencode 任何内置 provider 的目录中。

LiteLLM、9router 等网关常以自定义名称暴露模型（聚合前缀、不带 provider 前缀、或自定义
`model_name`），这些 ID opencode 目录并不认识。需要自定义 provider 的网关专属 ID 示例：
`9router/deepseek-v4-pro`、`9router/qwen3`、`litellm/my-custom-alias`。如果网关提供的是
目录中已有的模型 ID（如 `openai/gpt-4o`、`deepseek/deepseek-v4-pro`、`anthropic/claude-...`），
则无需自定义 provider —— 直接设置 `OPENAI_BASE_URL` 并使用该 ID 即可。

**自定义 provider JSON**（添加到 `.opencode-review/opencode.json`）：

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

> **调整个别模型参数：** `models` 中的每一项还可携带网关相关的属性。实用示例：重映射发送给网关
> 的 ID（`modelID`）、设置推理级别（`settings.reasoningEffort`）、控制采样（`body`）。

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

> 注意：数值型采样参数（如 `temperature`）应放在 `body` 中（模型顶层不接受数值型
> `temperature`）。自定义 provider 暂不支持 `limit` / 令牌上限。

### 每个模型的选项

`models` 对象中的每一项都可以携带网关相关的属性：

- `modelID`：重映射发送给网关的 ID（在模型名称与部署 ID 不同时很有用）
- `settings.reasoningEffort`：设置推理努力级别（`low`、`medium`、`high`）
- `body.temperature`：控制采样温度（0.0 到 1.0）

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

**配置**（`.gitea/workflows/opencode-review.yaml`）：

```yaml
env:
  # 使用自定义 provider - model 格式：provider/model-name
  MODEL: opencode-review-provider/my-model
  # opencode.json 中 {env:...} 引用的 OpenAI 兼容网关地址和 API key
  OPENAI_BASE_URL: "https://your-gateway.example.com/v1"
  OPENAI_API_KEY: "your-gateway-api-key"
```

**示例**：`MODEL=opencode-review-provider/my-model`

> **注意**：对于 catalog provider（OpenAI、DeepSeek、Anthropic），继续使用 `MODEL: openai/<model-name>` 配合 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL`，如 [模型配置](#2-configure-model) 章节所述。

### 4. 审查配置

以下选项适用于 Docker 和源码两种安装方式：

```yaml
env:
  # 响应语言
  REVIEW_LANGUAGE: auto      # auto | en | zh-CN
  
  # 审查深度和关注点
  REVIEW_STYLE: balanced     # concise | balanced | thorough | security
  
  # 文件筛选（glob 模式，逗号分隔）
  FILE_PATTERNS: ""          # 例如：「*.ts,*.go,src/**」（空 = 全部文件）

  # 审查模板：内置名称，或路径/URL（默认由 REVIEW_STYLE 推导）
  REVIEW_TEMPLATE: ""        # standard | concise | thorough | security | performance | compliance

  # 团队审查规范（默认读取 .gitea/review-rules[.md] 和 .forgejo/review-rules[.md]）
  REVIEW_RULES: ""           # 例如："docs/standards/, org/standards:backend@v2, https://example.com/api.md"

  # 审查前刷新模型目录（设为 "false" 可跳过）
  OPENCODE_REFRESH_MODELS: "true"
```

Docker 和源码 workflow 在每次审查前都会执行 [`opencode models --refresh`](https://opencode.ai/docs/cli/#models)。刷新失败时会输出警告，并使用已有模型缓存继续审查。离线环境或完全自定义 provider 可设置 `OPENCODE_REFRESH_MODELS: "false"`。本地源码运行时，请按下方示例在 `opencode run` 前执行 `opencode models --refresh`。

#### 语言选项

| 值 | 说明 |
|----|------|
| `auto` | 根据代码注释自动检测（默认） |
| `en` | 使用英文审查 |
| `zh-CN` | 使用简体中文审查 |

#### 文件筛选示例

```yaml
# 只审查 TypeScript 文件
FILE_PATTERNS: "*.ts,*.tsx"

# 只审查源码文件（排除测试）
FILE_PATTERNS: "src/**/*.go"

# 多种模式
FILE_PATTERNS: "*.py,*.js"

# 说明：目前仅支持正向匹配（不支持以 '!' 开头的排除模式）
```

与 `.gitignore` 一致，不含 `/` 的模式匹配任意层级的文件名（`*.ts` 匹配 `src/a.ts`）；`**/` 也匹配零层目录（`src/**/*.ts` 匹配 `src/a.ts`）。

#### 审查模板

`REVIEW_TEMPLATE` 决定审查重点、总结格式和审批规则：

| 模板 | 适用场景 |
|------|----------|
| `standard` | 缺陷、安全、性能、可维护性，按严重程度分组（默认） |
| `concise` | 只报阻塞问题，总结简短 |
| `thorough` | 额外检查错误路径、并发、兼容性、测试覆盖和上线风险 |
| `security` | 按「输入 → 汇点 → 影响」分析；涉及认证、加密、CI 密钥的改动不会自动 approve |
| `performance` | 热路径、N+1 查询、无界内存、阻塞 I/O，并说明问题在什么数据规模下显现 |
| `compliance` | 逐条核对适用的团队规范：符合 / 违反 / 不涉及 |

未设置时，`REVIEW_STYLE` 映射为 `concise`、`thorough`、`security` 或 `standard`。自定义模板是一个 Markdown 文件，可写为仓库路径（从 PR 的 base commit 读取）、`owner/repo:path[@ref]` 或 URL。建议从[内置模板](.opencode-review/review-templates/)复制修改，并保留 `**Decision**` 一节，让模型知道何时 approve。

#### 团队审查规范

将 `REVIEW_RULES` 指向你们的编码规范，审查会对照规范检查 diff，并在每条违规评论中注明 `Standard: <来源>`。多个来源用逗号或换行分隔：

| 来源 | 示例 | 读取位置 |
|------|------|----------|
| 仓库路径（文件，或含 `.md`/`.txt` 的目录） | `docs/standards/` | PR 的 **base commit**，PR 无法放宽用于审查它自己的规范 |
| 共享仓库 | `org/standards:backend/go.md@v2` | 同一 Gitea 服务器上的该仓库（token 需有读权限），`@ref` 可选 |
| URL | `https://wiki.example.com/api-rules.md` | HTTP(S)；Gitea token 只会发送给 Gitea 服务器自身的源 |

未设置 `REVIEW_RULES` 时，若存在则自动加载 `.gitea/review-rules.md`、`.gitea/review-rules/`、`.forgejo/review-rules.md`、`.forgejo/review-rules/`。显式配置的来源读取失败时，运行会在发布任何审查前失败。`REVIEW_RULES: none` 关闭规范加载。

规范文件可用 frontmatter 限定适用文件，规则集较大时只在相关时消耗 token：

```markdown
---
title: Go 错误处理
paths: ["*.go"]
---
- 错误必须用 `%w` 包装并带上下文：`fmt.Errorf("load user %d: %w", id, err)`。
- 不得忽略写入对象 `Close` 返回的错误。
```

适用规范的总大小受 `REVIEW_RULES_MAX_BYTES` 限制（默认 30000），超出时请用 `paths:` 拆分。与 `REVIEW_TEMPLATE: compliance` 配合可得到逐条核对清单。

#### 审查技能（Skills）

审查会按 diff 涉及的语言和领域按需加载内置检查清单：`review-security`、`review-typescript`、`review-python`、`review-go`、`review-java`（Java/Kotlin）、`review-sql`（查询与迁移）、`review-frontend`、`review-infra`（Docker、Kubernetes、Terraform、CI）和 `review-tests`，位于 [`.opencode-review/skills/`](.opencode-review/skills/)。团队自有的检查项请放入 `REVIEW_RULES`，它固定从 base commit 读取。

#### 配置信任与 Fork PR

审查通过 Gitea API 读取 PR，从不需要 PR 的代码，因此 workflow 不会把 PR 代码放进持有 token 和模型 key 的任务：

- Docker workflow 不 checkout 仓库。镜像默认忽略工作区（`/workspace` 或 `$GITHUB_WORKSPACE`）中的 `.opencode-review/`，除非设置 `OPENCODE_REVIEW_TRUST_WORKSPACE_CONFIG=true`；仅在工作区是可信 checkout 时开启。自定义 Docker 配置请挂载到 `/app/.opencode-review`，或将 `OPENCODE_CONFIG_DIR` 指向工作区之外的路径。
- 源码 workflow 只从 PR 的 base commit（`/oc` 评论时为默认分支）checkout `.opencode-review/`。PR 对 `.opencode-review/` 的修改在合并后才生效，因此首次添加 `.opencode-review/` 的 PR 无法审查自身：先合并它，再在下一个 PR 上触发。
- Gitea 和 Forgejo 不会把仓库 secrets 传给 fork 发起的 `pull_request` workflow，因此这些模板不会审查 fork PR。`pull_request_target` 以 base 分支的 workflow 运行并可读取 secrets；这些模板在其中不会运行 fork 代码，但 fork 的 diff 仍会交给一个有权 approve 的模型。只有在你接受这种审批策略时才使用它。

#### 大型 PR

OpenCode 会截断超过 2000 行或 50 KiB 的工具输出。因此 diff 工具会分页返回大 diff（`REVIEW_DIFF_PAGE_BYTES`，默认 40000），本次运行未读完所有页之前，提交审查会被拒绝。

## 🚀 使用方法

### 触发代码审查

在 PR 中发表评论：

```
/oc
```

或

```
/opencode 请审查这个 PR
```

### 本地测试（Docker）

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

`REPO_NAME` 既可以传 `repo`，也可以传 `owner/repo`（entrypoint 会自动规范化）。

镜像发布了 `linux/amd64` 和 `linux/arm64` 两种架构。挂载的项目目录仅用于推断 `GITEA_SERVER_URL`；除非设置 `OPENCODE_REVIEW_TRUST_WORKSPACE_CONFIG=true`，其中的 `.opencode-review/` 会被忽略。

### 本地测试（源码）

审查目标由环境变量固定，提示词不能将任务转向另一条 PR。

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

## 🔧 自定义（源码安装）

### 审查结果确认与本地测试

Docker 入口及源码 workflow 使用 `run-review.ts`，只有读回确认 review 和行评论后才成功。
审查绑定本次获取的 base/head，PR 变化时报 `PR_CHANGED`；重复运行复用已确认结果，
写入结果不明确时先查询，不盲目重发。

参见[本地 Gitea/Forgejo 环境、测试与状态恢复说明](docs/local-testing.md)，其中也说明了
多个独立 runner 的共享状态要求，以及 CI 使用的确定性模型桩。

### 修改审查风格

审查重点和总结格式优先通过自定义 `REVIEW_TEMPLATE` 和 `REVIEW_RULES` 调整（见[审查配置](#4-审查配置)），Docker 镜像同样适用。如需修改 agent 本身，编辑 `.opencode-review/agents/code-review.md`：

```markdown
---
description: AI code reviewer for Gitea/Forgejo PRs
tools:
  "*": false
  "gitea-review": true
  "gitea-pr-diff": true
---

你是一个专注于 [你的领域] 的代码审查专家...
```

### 添加新工具

在 `.opencode-review/tools/` 目录创建新的 TypeScript 文件：

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "工具描述",
  args: {
    param: tool.schema.string().describe("参数说明"),
  },
  async execute(args, context) {
    return "结果"
  },
})
```

## 📁 项目结构

```
.
├── Dockerfile                      # Docker 镜像定义
├── docker-compose.yaml             # 本地测试
├── entrypoint.sh                   # 容器入口
├── install.sh                      # 安装脚本
├── templates/
│   ├── workflow-docker.yaml        # Docker workflow 模板
│   └── workflow-source.yaml        # 源码 workflow 模板
├── .github/workflows/
│   └── docker-publish.yaml         # 自动构建 Docker 镜像
└── .opencode-review/               # 隔离的配置目录
    ├── agents/
    │   ├── code-review.md          # 代码审查 Agent（主）
    │   └── gitea-assistant.md      # 通用助手 Agent
    ├── tools/
    │   ├── gitea-pr-diff.ts        # 获取完整 PR Diff
    │   ├── gitea-pr-files.ts       # 列出变更的文件
    │   ├── gitea-incremental-diff.ts # 获取增量 Diff（仅新变更）
    │   ├── gitea-review.ts         # 提交审查和评论
    │   └── gitea-comment.ts        # 在 issue/PR 上发表评论
    ├── lib/                        # diff、快照、规范加载与发布逻辑
    ├── review-templates/           # 内置审查模板（REVIEW_TEMPLATE）
    ├── skills/
    │   └── review-*/SKILL.md       # 按需加载的语言与领域检查清单
    └── package.json                # 依赖
```

> **注意**: 安装后，会在你的项目中创建 `.gitea/workflows/opencode-review.yaml`。

## 🔗 相关链接

- [OpenCode 官方文档](https://opencode.ai/docs)
- [OpenCode 自定义工具](https://opencode.ai/docs/custom-tools/)
- [Gitea API 文档](https://docs.gitea.io/en-us/api-usage/)
- [Docker 镜像](https://ghcr.io/ccsert/opencode-review)

## 📄 License

MIT License - 详见 [LICENSE](LICENSE)
