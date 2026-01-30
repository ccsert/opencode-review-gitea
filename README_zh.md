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
- 🐳 **Docker 支持** - 预构建镜像，零配置安装
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

### 2. 配置模型（可选）

编辑 `.gitea/workflows/opencode-review.yaml`：

```yaml
env:
  # 格式：provider/model-id
  MODEL: deepseek/deepseek-chat        # 默认（需要 DEEPSEEK_API_KEY）
  # MODEL: anthropic/claude-sonnet-4-5  # 需要 ANTHROPIC_API_KEY
  # MODEL: openai/gpt-4o                # 需要 OPENAI_API_KEY
```

### 3. Docker 专属选项

```yaml
env:
  REVIEW_LANGUAGE: auto      # auto | en | zh-CN
  REVIEW_STYLE: balanced     # concise | balanced | thorough | security
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
  -e DEEPSEEK_API_KEY="your-key" \
  -e PR_NUMBER=123 \
  -e REPO_OWNER="your-org" \
  -e REPO_NAME="your-repo" \
  ghcr.io/ccsert/opencode-review:latest
```

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
├── .gitea/workflows/
│   └── opencode-review.yaml        # Gitea Actions 工作流
└── .opencode-review/               # 隔离的配置目录
    ├── agents/
    │   └── code-review.md          # 代码审查 Agent
    ├── tools/
    │   ├── gitea-pr-diff.ts        # 获取 PR Diff
    │   └── gitea-review.ts         # 提交审查
    └── package.json                # 依赖
```

## 🔗 相关链接

- [OpenCode 官方文档](https://opencode.ai/docs)
- [OpenCode 自定义工具](https://opencode.ai/docs/custom-tools/)
- [Gitea API 文档](https://docs.gitea.io/en-us/api-usage/)
- [Docker 镜像](https://ghcr.io/ccsert/opencode-review)

## 📄 License

MIT License - 详见 [LICENSE](LICENSE)
