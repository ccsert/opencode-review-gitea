# OpenCode Review Platform

[![OpenCode](https://img.shields.io/badge/OpenCode-AI%20Code%20Review-blue)](https://opencode.ai)
[![Docker Image](https://img.shields.io/badge/Docker-ghcr.io-blue)](https://ghcr.io/ccsert/opencode-review)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

中文 | [English](README.md)

一个**AI 驱动的代码审查平台**，支持 Gitea/Forgejo、GitHub 和 GitLab。基于 [OpenCode](https://opencode.ai) 插件系统构建，提供两种部署模式：

1. **Gitea Actions 模式** - 在 CI/CD 流水线中运行
2. **平台模式（全新！）** - 独立 Web 服务，带 UI 界面、多仓库支持和 Webhook 集成

## ✨ 功能特性

### 核心功能
- 🤖 **AI 驱动的代码审查** - 使用 Claude/GPT/DeepSeek 等模型分析代码变更
- 📝 **行级评论** - 在具体代码行上提供精确反馈
- ✅ **审查决策** - 支持 APPROVE、REQUEST_CHANGES、COMMENT 三种状态
- 🏷️ **结构化标签** - 按类型（BUG、SECURITY、PERFORMANCE）和严重程度分类问题

### Gitea Actions 模式
- 🔄 **自动触发** - 通过 `/oc` 或 `/opencode` 评论触发
- 📊 **增量审查** - 仅审查上次审查后的新变更
- 🐳 **Docker 支持** - 预构建镜像，零配置安装
- 🛡️ **隔离配置** - 使用独立的 `.opencode-review/` 目录

### 平台模式（全新！）
- 🌐 **Web 界面** - 可视化管理仓库和审查记录
- 🔐 **认证系统** - JWT + API Key 双重认证
- 📂 **多仓库管理** - 一个平台管理所有仓库
- 📋 **自定义模板** - 创建可复用的审查模板
- 📈 **统计分析** - 跟踪审查历史和指标
- 🔗 **Webhook 集成** - 直接接收 Webhook，无需 Gitea Actions Runner
- 💾 **灵活存储** - 支持 SQLite（默认）或 PostgreSQL

---

## 📦 安装

### 选项 1：Gitea Actions 模式（原有）

用于 CI/CD 流水线集成：

```bash
# 交互式安装
curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash

# 或直接使用 Docker 方式
curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash -s -- --docker
```

### 选项 2：平台模式（全新！）

部署独立 Web 服务：

```bash
# 克隆仓库
git clone https://github.com/ccsert/opencode-review-gitea.git
cd opencode-review-gitea

# 使用 Docker Compose（SQLite）
cd docker
cp .env.example .env
# 编辑 .env 配置
docker compose up -d

# 使用 Docker Compose（PostgreSQL）
docker compose -f docker-compose.postgres.yml up -d
```

---

## 🏗️ 架构

```
opencode-review-gitea/
├── .opencode-review/          # Gitea Actions 模式配置
│   ├── agents/                # AI Agent 定义
│   ├── tools/                 # 自定义工具
│   └── skills/                # 可复用技能
├── packages/                  # 平台模式（Monorepo）
│   ├── core/                  # 核心库
│   │   ├── providers/         # Git 平台抽象层
│   │   ├── events/            # Webhook 事件类型
│   │   ├── review/            # 审查引擎
│   │   └── templates/         # 模板系统
│   ├── server/                # Hono + Bun API 服务
│   │   ├── routes/            # API 端点
│   │   ├── middleware/        # 认证、错误处理
│   │   └── db/                # Drizzle ORM 数据库
│   └── web/                   # React 前端（即将推出）
├── docker/                    # Docker 配置
└── docs/                      # 文档
    └── architecture/          # 设计文档
```

---

## 🔧 配置

### Gitea Actions 模式

在 Gitea 仓库中设置以下 Secrets：

| Secret | 必需 | 说明 |
|--------|------|------|
| `OPENAI_API_KEY` | * | OpenAI API Key |
| `ANTHROPIC_API_KEY` | * | Anthropic API Key |
| `MODEL` | 否 | 使用的模型（默认：`claude-sonnet-4-20250514`） |

*至少需要一个 AI 服务商的 Key

### 平台模式

环境变量（参见 `docker/.env.example`）：

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `DATABASE_URL` | 否 | `file:./data/review.db` | SQLite 或 PostgreSQL URL |
| `JWT_SECRET` | 是 | - | JWT 签名密钥 |
| `ADMIN_SECRET` | 否 | `admin` | 管理员登录密钥 |
| `OPENAI_API_KEY` | * | - | OpenAI API Key |
| `DEFAULT_MODEL` | 否 | `gpt-4o-mini` | 默认 AI 模型 |
| `CORS_ORIGINS` | 否 | `localhost` | 允许的 CORS 来源 |

---

## 📖 API 参考

平台模式提供 RESTful API：

### 认证
```
POST   /api/v1/auth/login          # 登录
POST   /api/v1/auth/refresh        # 刷新 JWT Token
GET    /api/v1/auth/me             # 获取当前用户
```

### 仓库
```
GET    /api/v1/repositories        # 仓库列表
POST   /api/v1/repositories        # 添加仓库
GET    /api/v1/repositories/:id    # 仓库详情
PUT    /api/v1/repositories/:id    # 更新仓库
DELETE /api/v1/repositories/:id    # 删除仓库
POST   /api/v1/repositories/:id/test  # 测试连接
```

### 审查记录
```
GET    /api/v1/reviews             # 审查列表
GET    /api/v1/reviews/stats       # 统计数据
GET    /api/v1/reviews/:id         # 审查详情
POST   /api/v1/reviews/:id/retry   # 重试失败的审查
```

### 模板
```
GET    /api/v1/templates           # 模板列表
POST   /api/v1/templates           # 创建模板
GET    /api/v1/templates/:id       # 模板详情
PUT    /api/v1/templates/:id       # 更新模板
DELETE /api/v1/templates/:id       # 删除模板
```

### Webhooks
```
POST   /api/v1/webhooks/:provider/:repoId   # 接收 Webhook
```

### 系统
```
GET    /api/v1/system/health       # 健康检查
GET    /api/v1/system/info         # 系统信息
GET    /api/v1/system/models       # 可用 AI 模型
```

---

## 🔄 Webhook 配置

### Gitea/Forgejo

1. 进入 仓库 → 设置 → Webhooks → 添加 Webhook
2. Payload URL 填写：`https://your-server/api/v1/webhooks/gitea/{repository_id}`
3. Content Type 选择：`application/json`
4. Secret 填写仓库配置中的密钥
5. 勾选事件：Pull Request、Pull Request Comment

### GitHub

1. 进入 Repository → Settings → Webhooks → Add webhook
2. Payload URL：`https://your-server/api/v1/webhooks/github/{repository_id}`
3. Content Type：`application/json`
4. 设置 Secret 并选择 Pull request 事件

---

## 🛠️ 开发

### 环境要求
- [Bun](https://bun.sh) >= 1.0
- Node.js >= 18（可选，用于兼容性）

### 开发设置

```bash
# 安装依赖
bun install

# 启动开发服务器
bun run dev

# 生产构建
bun run build

# 类型检查
bun run typecheck

# 运行测试
bun run test
```

### 项目包

| 包 | 说明 | 状态 |
|---|------|------|
| `@opencode-review/core` | Provider 抽象层、事件、模板 | ✅ 完成 |
| `@opencode-review/server` | Hono API 服务 | ✅ 完成 |
| `@opencode-review/web` | React Web 界面 | 🔜 即将推出 |

---

## 📊 开发路线图

### ✅ 第一阶段：核心基础设施（已完成）
- [x] Gitea Actions 集成（原有 CLI 模式）
- [x] CLI 模式 Docker 支持
- [x] Monorepo 架构（Turborepo）
- [x] Provider 抽象层（`GitProvider` 接口）
- [x] GiteaProvider 实现
- [x] Webhook 事件解析与标准化
- [x] 内置模板系统

### ✅ 第二阶段：后端平台（已完成）
- [x] Hono + Bun HTTP 服务
- [x] SQLite + Drizzle ORM 数据库
- [x] JWT + API Key 认证
- [x] 仓库管理 API
- [x] 模板 CRUD API
- [x] 审查历史 API（含统计）
- [x] Webhook 接收端点
- [x] 系统健康检查 API

### 🔄 第三阶段：进行中
- [x] ReviewEngine 框架（40% - SDK 集成待完成）
- [x] Docker 部署配置（70% - 前端待添加）
- [ ] Web 界面（React + Shadcn/UI + TailwindCSS）
- [ ] OpenCode SDK 集成

### 📋 第四阶段：未来计划
- [ ] GitHub Provider
- [ ] GitLab Provider
- [ ] OAuth 集成（Gitea/GitHub/GitLab）
- [ ] 审查分析仪表板
- [ ] Slack/Discord 通知
- [ ] 自托管 AI 模型支持（Ollama）

---

## 🤝 贡献

欢迎贡献！请先阅读 [贡献指南](CONTRIBUTING.md)。

---

## 📄 许可证

[MIT License](LICENSE)

---

## 🔗 相关链接

- [OpenCode](https://opencode.ai) - AI 编程助手
- [架构文档](docs/architecture/) - 详细设计文档
- [API 设计](docs/architecture/api-design.md) - 完整 API 规范
- [CLI 模式文档](README_CLI.md) - 原有 Gitea Actions 模式文档
