# OpenCode Gitea Review

[![OpenCode](https://img.shields.io/badge/OpenCode-AI%20Code%20Review-blue)](https://opencode.ai)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

中文 | [English](README.md)

一个基于 [OpenCode](https://opencode.ai) 的 **Gitea/Forgejo PR 自动代码审查工具**。通过 Gitea Actions 监听 PR 和评论事件，AI Agent 自动获取代码差异并提交结构化审查。

## ✨ 功能特性

- 🤖 **AI 驱动的代码审查** - 使用 Claude/GPT 等模型分析代码变更
- 📝 **行级评论** - 在具体代码行上提供精确反馈
- ✅ **审查决策** - 支持 approve、request_changes、comment 三种审查状态
- 🔄 **自动触发** - 通过 `/oc` 或 `/opencode` 评论触发审查
- 🛡️ **隔离配置** - 使用独立的 `.opencode-review/` 目录，不会与你现有的 `.opencode/` 配置冲突

## 📦 快速安装

### 方式一：一键安装脚本（推荐）

在你的项目根目录执行：

```bash
curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash
```

### 方式二：手动安装

```bash
# 1. 克隆仓库
git clone https://github.com/ccsert/opencode-review-gitea.git /tmp/opencode-review-gitea

# 2. 复制文件到你的项目
cp -r /tmp/opencode-review-gitea/.opencode-review .
mkdir -p .gitea/workflows
cp /tmp/opencode-review-gitea/.gitea/workflows/opencode-review.yaml .gitea/workflows/

# 3. 安装依赖
cd .opencode-review && bun install && cd ..

# 4. 清理
rm -rf /tmp/opencode-review-gitea
```

## ⚙️ 配置

### 1. 设置 Secrets

在你的 Gitea 仓库中配置以下 Secrets：

| Secret 名称 | 说明 |
|------------|------|
| `OPENCODE_GIT_TOKEN` | Gitea API Token（需要 repo 权限） |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（或其他 LLM Provider） |

### 2. 配置模型（可选）

编辑 `.gitea/workflows/opencode-review.yaml` 修改默认模型：

```yaml
env:
  MODEL: opencode/claude-sonnet-4-5  # 或 opencode/gpt-4o 等
```

### 3. 与现有开发环境隔离

本工具使用 **`OPENCODE_CONFIG_DIR`** 环境变量（[官方文档](https://opencode.ai/docs/config/#custom-directory)）从 `.opencode-review/` 加载配置：

```
.opencode-review/           # ← 隔离！不会影响你的 .opencode/
├── agents/                 # AI Agent 定义
├── tools/                  # 自定义 Gitea API 工具
├── skills/                 # 可复用技能
└── package.json            # 依赖
```

**为什么这很重要：**
- 你现有的 `.opencode/` 配置完全不受影响
- CI 工作流通过设置 `OPENCODE_CONFIG_DIR` 指向 `.opencode-review/`
- 本地不设置此环境变量时，`opencode` 只会读取你的 `.opencode/`
- 不会产生工具命名冲突

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

### 本地测试

```bash
# 设置环境变量
export GITEA_TOKEN="your-token"
export GITEA_SERVER_URL="https://your-gitea.example.com"
export PR_NUMBER=123
export REPO_OWNER="your-org"
export REPO_NAME="your-repo"

# 重要：设置自定义配置目录
export OPENCODE_CONFIG_DIR="$(pwd)/.opencode-review"

# 运行审查
opencode run --agent code-review \
  "Please review PR #${PR_NUMBER} in ${REPO_OWNER}/${REPO_NAME}"
```

## 🔧 自定义

### 修改审查风格

编辑 `.opencode-review/agents/code-review.md`：

```markdown
---
description: AI code reviewer for Gitea/Forgejo PRs
model: opencode/claude-sonnet-4-5
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
    // 工具逻辑
    return "结果"
  },
})
```

## 📁 项目结构

```
.
├── .gitea/
│   └── workflows/
│       └── opencode-review.yaml    # Gitea Actions 工作流
└── .opencode-review/               # 隔离的配置目录
    ├── agents/
    │   ├── code-review.md          # 代码审查 Agent
    │   └── gitea-assistant.md      # 通用助手 Agent
    ├── tools/
    │   ├── gitea-comment.ts        # 发表评论
    │   ├── gitea-pr-diff.ts        # 获取 PR Diff
    │   └── gitea-review.ts         # 提交审查
    ├── skills/
    │   └── pr-review/
    │       └── SKILL.md            # PR 审查技能
    ├── opencode.json               # OpenCode 配置
    └── package.json                # 依赖
```

## 🔗 相关链接

- [OpenCode 官方文档](https://opencode.ai/docs)
- [OpenCode 自定义工具](https://opencode.ai/docs/custom-tools/)
- [OpenCode Agent 配置](https://opencode.ai/docs/agents/)
- [Gitea API 文档](https://docs.gitea.io/en-us/api-usage/)

## 📄 License

MIT License - 详见 [LICENSE](LICENSE)
