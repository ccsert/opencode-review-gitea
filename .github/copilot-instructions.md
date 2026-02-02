# Copilot Instructions - OpenCode Review Platform

## Project Overview

**AI-powered code review platform** for Gitea/Forgejo, GitHub, and GitLab. Two deployment modes:
1. **Gitea Actions Mode** - CI/CD triggered via `/oc` or `/opencode` comments
2. **Platform Mode** - Standalone web service with UI, multi-repo support, and webhook integration

## Architecture (Monorepo with Turborepo + Bun)

```
opencode-review-gitea/
├── packages/
│   ├── core/                    # 核心库 (@opencode-review/core)
│   │   └── src/
│   │       ├── providers/       # Git 平台抽象层 (Gitea/GitHub/GitLab)
│   │       │   ├── base.ts      # BaseProvider 抽象类
│   │       │   ├── gitea.ts     # Gitea 实现
│   │       │   └── types.ts     # GitProvider 接口定义
│   │       ├── events/          # Webhook 事件标准化
│   │       ├── review/          # ReviewEngine (AI 集成)
│   │       ├── ai/              # AI 客户端 (OpenCode SDK + Direct API)
│   │       └── templates/       # 审查模板系统
│   ├── server/                  # Hono + Bun API 服务 (@opencode-review/server)
│   │   └── src/
│   │       ├── routes/          # REST API 端点
│   │       ├── middleware/      # 认证 (JWT + API Key)
│   │       └── db/              # Drizzle ORM + PGlite (PostgreSQL 兼容)
│   └── web/                     # React 前端 (@opencode-review/web)
│       └── src/
│           ├── pages/           # 页面组件
│           └── components/      # Shadcn/UI 组件
├── .opencode-review/            # Gitea Actions 模式配置 (隔离目录)
│   ├── agents/                  # AI Agent 定义
│   └── tools/                   # 自定义工具
└── docker/                      # Docker 部署配置
```

## Key Patterns & Conventions

### 1. Provider Pattern (添加新 Git 平台)
继承 `BaseProvider` 并实现 `GitProvider` 接口：
```typescript
// packages/core/src/providers/gitea.ts
export class GiteaProvider extends BaseProvider {
  readonly name: ProviderType = 'gitea'
  
  async getPullRequest(owner: string, repo: string, number: number): Promise<PullRequest> {
    return this.fetch<PullRequest>(`/repos/${owner}/${repo}/pulls/${number}`)
  }
}
```

### 2. API Route Pattern (Hono + Zod 验证)
```typescript
// packages/server/src/routes/*.ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'

const createSchema = z.object({ name: z.string().min(1) })

export const routes = new Hono()
routes.use('/*', authMiddleware)  // 认证保护
routes.post('/', zValidator('json', createSchema), async (c) => {
  const db = getDatabase()  // 全局数据库实例
  // ...
})
```

### 3. Database Schema Pattern (Drizzle ORM + PGlite)
```typescript
// packages/server/src/db/schema/index.ts
export const repositories = pgTable('repositories', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  config: jsonb('config').$type<RepositoryConfig>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
```

### 4. ReviewEngine 双模式
- **Direct Mode** (默认): 直接调用 AI API，更可靠
- **OpenCode SDK Mode**: 通过 OpenCode 服务器，支持更多功能
```typescript
const engine = new ReviewEngine({
  apiKey: 'sk-xxx',
  model: { providerID: 'deepseek', modelID: 'deepseek-chat' },
  useDirectMode: true,  // 默认 true
})
```

## Development Commands

```bash
# 安装依赖 (根目录使用 bun workspaces)
bun install

# 开发模式 (Turborepo 并行启动所有包)
bun run dev

# 单独启动
cd packages/server && bun run dev  # API 服务器 (localhost:3000)
cd packages/web && bun run dev     # 前端 (localhost:5173)

# 数据库操作
bun run db:generate   # 生成迁移文件
bun run db:migrate    # 运行迁移

# 构建
bun run build         # 构建所有包
```

## Cross-Package Dependencies

```
@opencode-review/web
    └── (fetch API) → @opencode-review/server
                           └── @opencode-review/core
                                  ├── providers/ → Gitea/GitHub/GitLab API
                                  ├── review/    → AI 调用
                                  └── events/    → Webhook 处理
```

## Important Conventions

1. **ID 生成**: 使用 `ulid()` 生成所有数据库 ID
2. **认证**: `authMiddleware` 支持 JWT Token 和 API Key 双模式
3. **数据库**: PGlite 本地存储，语法兼容 PostgreSQL，便于后续迁移
4. **环境变量**: 优先级 `GITEA_*` > `GITHUB_*` (向后兼容)
5. **前端状态**: 使用 Zustand + React Query
6. **UI 组件**: 基于 Shadcn/UI，位于 `packages/web/src/components/ui/`

## Webhook Event Flow (Platform Mode)

```
Gitea/GitHub → POST /api/v1/webhooks/:repoId/receiver
    → parseWebhookEvent()        # 解析并标准化事件
    → shouldTriggerReview()      # 判断是否需要审查
    → getReviewEngineForUser()   # 获取用户 AI 配置
    → engine.executeReview()     # 执行 AI 审查
    → provider.createReview()    # 提交审查结果
```

## Gitea Actions Mode (Legacy)

用于 CI/CD 集成，使用 `.opencode-review/` 隔离目录：
- 工具命名: `gitea-*` (避免冲突)
- 触发关键词: `/oc` 或 `/opencode`
- 环境变量: `OPENCODE_CONFIG_DIR` 指向配置目录
