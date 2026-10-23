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
- � **增量审查** - 仅审查上次审查后的新变更（适用于 PR 更新）
- 🏷️ **结构化标签** - 按类型（BUG、SECURITY、PERFORMANCE）和严重程度分类问题
- �🐳 **Docker 支持** - 预构建镜像，零配置安装
- 🛡️ **隔离配置** - 使用独立的 `.opencode-review/` 目录，不会与你现有的 `.opencode/` 配置冲突

## 📦 安装

### 交互式安装（推荐）

在你的项目根目录执行：

```bash
curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash
```

你将看到一个交互式菜单来选择安装方式。

### 直接安装选项

```bash
# Docker 方式（推荐）- 零文件添加
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
| **更新方式** | 使用 `:latest` 自动更新 | 需要手动更新 |
| **适合场景** | 快速上手、标准使用 | 自定义提示词、高级用户 |

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
```

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

> **注意**: Docker 镜像目前仅支持 **x86_64/amd64** 架构。ARM 设备（树莓派等）请使用[源码安装](#本地测试源码)方式。

### 本地测试（源码）

```bash
export GITEA_TOKEN="your-token"
export GITEA_SERVER_URL="https://your-gitea.example.com"
export OPENCODE_CONFIG_DIR="$(pwd)/.opencode-review"

opencode run --agent code-review \
  "Please review PR #123 in owner/repo"
```

## 🔧 自定义（源码安装）

### 修改审查风格

编辑 `.opencode-review/agents/code-review.md`：

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
    ├── skills/
    │   └── pr-review/SKILL.md      # 可复用的审查技能
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
