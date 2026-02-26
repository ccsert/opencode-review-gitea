# Platform Agent + AG-UI + A2A + MCP + SDK 设计文档

**日期**: 2026-02-26
**状态**: Approved
**方案**: Mastra-Native 全栈集成（方案 A）

## 概述

在现有 Mastra 技术栈基础上构建完整的平台 Agent 系统：

1. **Agent 驱动的模板管理** — AI Agent 通过工具创建、修改、测试、优化审查模板
2. **AG-UI 协议集成** — CopilotKit + Mastra 官方集成，前端实时流式交互
3. **A2A 协议** — Agent-to-Agent 互操作，外部 Agent 可与 Platform Agent 通信
4. **全能平台 Agent** — 管理所有平台能力：仓库、模板、审查、AI 配置、Webhook、系统健康
5. **全工具抽离** — Mastra Tools 为核心，同时暴露为 MCP Server 和 TypeScript SDK

## 架构

### 整体拓扑

```
Web (React + CopilotKit) ←AG-UI/SSE→ Server (Hono + Mastra Runtime) → Core (Mastra Tools + Agent)
                                              ↕ A2A
                                        External Agents
                                              ↕ MCP
                                        External Consumers

SDK → (REST/SSE) → Server
```

### 依赖关系

```
web → (AG-UI/SSE) → server → core (Mastra Tools + Agent)
sdk → (REST/SSE)  → server
mcp → core (Tools)
```

- 工具只写一次：`core/ai/tools/platform/` 中实现，MCP 和 SDK 二次封装
- Agent Runtime 在 server 层：需要 DB 上下文（用户配置、API keys）
- AG-UI endpoint 独立于现有 REST API：`/api/agui` 是 SSE 长连接
- SDK 是独立包：通过 HTTP 与 server 通信，不依赖 core 内部

### 新增包/模块结构

```
packages/
  core/src/
    ai/tools/
      platform/
        template-tools.ts      # 模板 CRUD + 测试 + 优化
        repo-tools.ts          # 仓库管理
        review-tools.ts        # 审查操作
        ai-config-tools.ts     # AI 提供商配置
        webhook-tools.ts       # Webhook 管理
        system-tools.ts        # 系统健康检查
      index.ts                 # 统一导出
    agent.ts                   # Platform Agent（装载所有工具）
    mcp/
      server.ts                # MCP Server entry
  server/src/
    routes/
      agui.ts                  # AG-UI SSE endpoint
      a2a.ts                   # A2A JSON-RPC endpoint
      mcp.ts                   # MCP SSE 代理路由
    agent-runtime.ts           # Mastra Agent 运行时（DB 上下文注入）
  web/src/
    components/
      agent/
        AgentProvider.tsx      # CopilotKit Provider
        AgentPanel.tsx         # 聊天面板
        ToolCallVisualization.tsx  # 工具调用实时展示
        AgentStateIndicator.tsx    # Agent 状态指示
    lib/
      agent-hooks.ts           # Agent React hooks
  sdk/
    src/
      client.ts                # SDK 客户端
      tools.ts                 # 工具类型导出
      index.ts                 # 入口
```

## Mastra Tools 体系

### 工具上下文注入

```typescript
interface PlatformToolContext {
  db: DrizzleDB;
  userId: string;
  userRole: 'admin' | 'member' | 'viewer';  // 多用户预留
  orgId?: string;                             // 多用户预留
  gitProvider: GitProvider;
}

// 工厂模式
function createTemplateTools(ctx: PlatformToolContext) {
  return {
    listTemplates: createTool({ ... }),
    // ...
  };
}

// Agent 组装（server 层）
function createPlatformAgent(ctx: PlatformToolContext) {
  const tools = {
    ...createTemplateTools(ctx),
    ...createRepoTools(ctx),
    ...createReviewTools(ctx),
    ...createAIConfigTools(ctx),
    ...createWebhookTools(ctx),
    ...createSystemTools(ctx),
  };
  return new Agent({
    name: 'platform-agent',
    instructions: PLATFORM_AGENT_SYSTEM_PROMPT,
    model: resolveModel(ctx),
    tools,
  });
}
```

### 工具清单

#### 模板管理（template-tools.ts）

| 工具             | 输入                                       | 输出                               | 说明             |
| ---------------- | ------------------------------------------ | ---------------------------------- | ---------------- |
| listTemplates    | `{ userId }`                               | `Template[]`                       | 列出用户所有模板 |
| getTemplate      | `{ templateId }`                           | `Template`                         | 获取模板详情     |
| createTemplate   | `{ name, content, variables, categories }` | `Template`                         | 创建模板         |
| updateTemplate   | `{ templateId, updates }`                  | `Template`                         | 修改模板         |
| deleteTemplate   | `{ templateId }`                           | `{ success }`                      | 删除模板         |
| testTemplate     | `{ templateId, sampleData }`               | `{ rendered, validationErrors }`   | 渲染测试         |
| optimizeTemplate | `{ templateId, goal }`                     | `{ suggestions, improvedContent }` | AI 优化建议      |

#### 仓库管理（repo-tools.ts）

| 工具          | 输入                   | 输出     | 说明     |
| ------------- | ---------------------- | -------- | -------- |
| listRepos     | `{ userId }`           | `Repo[]` | 列出仓库 |
| getRepo       | `{ repoId }`           | `Repo`   | 仓库详情 |
| configureRepo | `{ repoId, settings }` | `Repo`   | 修改设置 |
| getRepoStats  | `{ repoId, period }`   | `Stats`  | 审查统计 |

#### 审查操作（review-tools.ts）

| 工具             | 输入                   | 输出       | 说明     |
| ---------------- | ---------------------- | ---------- | -------- |
| triggerReview    | `{ repoId, prNumber }` | `Review`   | 触发审查 |
| getReview        | `{ reviewId }`         | `Review`   | 审查详情 |
| listReviews      | `{ repoId, filters }`  | `Review[]` | 查询审查 |
| getReviewSummary | `{ repoId, period }`   | `Summary`  | 趋势摘要 |

#### AI 配置（ai-config-tools.ts）

| 工具                | 输入                          | 输出                   | 说明       |
| ------------------- | ----------------------------- | ---------------------- | ---------- |
| listAIProviders     | `{ userId }`                  | `Provider[]`           | 列出提供商 |
| configureAIProvider | `{ provider, apiKey, model }` | `Provider`             | 配置提供商 |
| testAIProvider      | `{ providerId }`              | `{ success, latency }` | 测试连通性 |

#### Webhook 管理（webhook-tools.ts）

| 工具              | 输入                    | 输出          | 说明         |
| ----------------- | ----------------------- | ------------- | ------------ |
| listWebhooks      | `{ repoId }`            | `Webhook[]`   | 列出 Webhook |
| registerWebhook   | `{ repoId, events }`    | `Webhook`     | 注册 Webhook |
| deleteWebhook     | `{ repoId, webhookId }` | `{ success }` | 删除 Webhook |
| getWebhookHistory | `{ webhookId }`         | `Delivery[]`  | 投递历史     |

#### 系统工具（system-tools.ts）

| 工具             | 输入         | 输出                    | 说明       |
| ---------------- | ------------ | ----------------------- | ---------- |
| getSystemHealth  | `{}`         | `{ db, ai, providers }` | 系统健康   |
| getSystemConfig  | `{}`         | `Config`                | 系统配置   |
| getDashboardData | `{ userId }` | `Dashboard`             | 仪表盘数据 |

### 与现有工具的关系

- `git-diff.ts`、`git-review.ts` 保持不变，面向审查引擎
- `platform/` 工具面向平台管理，两组共存
- Platform Agent 装载所有工具（platform + git）

## AG-UI 协议集成

### Server 端

使用 `@ag-ui/mastra` 中间件桥接 Mastra Agent → AG-UI 事件流。

```
POST /api/agui → auth → 构建 PlatformToolContext → 创建 Agent → @ag-ui/mastra 执行 → SSE 响应
```

AG-UI 事件流顺序：

```
RUN_STARTED → STEP_STARTED → TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT(n) → TEXT_MESSAGE_END
                            → TOOL_CALL_START → TOOL_CALL_ARGS(n) → TOOL_CALL_END
                            → STATE_SNAPSHOT / STATE_DELTA
           → STEP_FINISHED → RUN_FINISHED
```

- 复用现有 `authMiddleware`（JWT / API Key）
- 每个 SSE 连接绑定一个 Agent run
- `threadId` 维护多轮对话上下文，存储在 DB

### 前端

CopilotKit 集成：

| 组件                    | 职责                                      | 来源       |
| ----------------------- | ----------------------------------------- | ---------- |
| `AgentProvider`         | CopilotKit runtime 配置 + auth token 注入 | 自研       |
| `AgentPanel`            | 聊天面板（侧边栏/浮动窗口）               | CopilotKit |
| `ToolCallVisualization` | 工具调用实时展示                          | 自研       |
| `AgentStateIndicator`   | Agent 状态条                              | 自研       |

### Human-in-the-Loop

危险操作（删除模板、修改配置）通过 `useCopilotAction` 在前端弹出确认 UI，用户确认后才执行。

## A2A 协议

### Endpoint

`POST /api/a2a` — JSON-RPC 请求，经 API Key auth。

### Agent Card

`GET /.well-known/agent.json`：

```json
{
  "name": "OpenCode Review Platform Agent",
  "description": "Manages code review templates, repositories, and AI-powered reviews",
  "url": "https://your-domain/api/a2a",
  "skills": [
    {
      "id": "template-management",
      "description": "Create, update, test, and optimize review templates"
    },
    {
      "id": "review-operations",
      "description": "Trigger and query code reviews"
    },
    {
      "id": "repo-management",
      "description": "Configure repository settings and webhooks"
    }
  ]
}
```

复用与 AG-UI 相同的 Agent 实例和工具链，仅 transport 不同。

## MCP Server

```
MCP 客户端 ←stdio|SSE→ packages/core/src/mcp/server.ts → Mastra Tools
```

- 使用 `@modelcontextprotocol/sdk`
- 每个 Mastra Tool 映射为 MCP Tool（name、description、inputSchema 对应）
- 支持 stdio（本地）和 SSE（远程，通过 `/api/mcp` 代理）transport

## TypeScript SDK

```typescript
class OpenCodeReviewClient {
  constructor(config: { baseUrl: string; apiKey: string });

  templates: {
    list(): Promise<Template[]>;
    create(input): Promise<Template>;
    update(id, input): Promise<Template>;
    delete(id): Promise<void>;
    test(id, sampleData): Promise<TestResult>;
    optimize(id, goal): Promise<OptimizeSuggestion>;
  };
  repos: { list; get; configure; getStats };
  reviews: { trigger; get; list; getSummary };
  aiProviders: { list; configure; test };
  webhooks: { list; register; delete; getHistory };
  system: { getHealth; getConfig; getDashboard };

  agent: {
    chat(input): AsyncIterable<AgUIEvent>;
    getThreads(): Promise<Thread[]>;
    getThread(threadId): Promise<Thread>;
  };
}
```

零外部依赖，仅用 fetch + EventSource。

## 数据模型

### 新增表

```sql
-- Agent 对话线程
CREATE TABLE agent_threads (
  id         TEXT PRIMARY KEY,       -- ULID
  user_id    TEXT NOT NULL,
  org_id     TEXT,                    -- 多用户预留
  title      TEXT,
  metadata   JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Agent 对话消息
CREATE TABLE agent_messages (
  id         TEXT PRIMARY KEY,       -- ULID
  thread_id  TEXT NOT NULL REFERENCES agent_threads(id),
  role       TEXT NOT NULL,           -- 'user' | 'assistant' | 'tool'
  content    TEXT,
  tool_calls JSONB,                   -- [{id, name, args, result}]
  metadata   JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- API Keys
CREATE TABLE api_keys (
  id          TEXT PRIMARY KEY,      -- ULID
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  key_hash    TEXT NOT NULL,          -- SHA-256, 不存明文
  scopes      JSONB,                  -- ['templates:read', ...]
  last_used_at TIMESTAMP,
  expires_at  TIMESTAMP,
  created_at  TIMESTAMP DEFAULT NOW()
);
```

### 现有表变更

- `templates`：新增 `org_id` 列（nullable）
- `repositories`：新增 `org_id` 列（nullable）

## 错误处理

### 工具层

```typescript
type ToolResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code: ToolErrorCode };

enum ToolErrorCode {
  NOT_FOUND = "NOT_FOUND",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  PROVIDER_ERROR = "PROVIDER_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}
```

Agent 收到错误后用自然语言向用户解释，不抛异常。

### AG-UI 层

| 场景           | 处理                               |
| -------------- | ---------------------------------- |
| Agent 执行报错 | `RUN_ERROR` event                  |
| SSE 断开       | 前端自动重连，基于 `threadId` 恢复 |
| Auth 失败      | 401，前端引导登录                  |
| 工具超时       | Agent 说明并建议重试               |

### A2A / MCP 层

遵循各协议标准错误格式。

## 多用户预留

| 层级                  | 预留方式                                        |
| --------------------- | ----------------------------------------------- | ------ | ------------------------- |
| `PlatformToolContext` | `userId`、`userRole`、`orgId?`                  |
| DB 表                 | 所有资源表有 `userId`，预留 `orgId`（nullable） |
| 工具查询              | 带 `userId` 过滤，不跨用户泄露                  |
| Agent 实例            | 每用户独立 context                              |
| API Key               | 关联用户，所有协议通过 API Key 确定身份         |
| 权限模型              | 预留 `admin                                     | member | viewer`，当前只实现 admin |

## 测试策略

| 层级            | 类型                              | 工具                     |
| --------------- | --------------------------------- | ------------------------ |
| Mastra Tools    | 单元测试（mock DB + GitProvider） | bun test                 |
| AG-UI endpoint  | 集成测试（SSE 事件流）            | bun test                 |
| Platform Agent  | E2E 对话测试                      | bun test                 |
| CopilotKit 前端 | 组件测试                          | vitest + testing-library |
| SDK             | 集成测试                          | bun test                 |
| MCP Server      | 协议一致性测试                    | MCP inspector            |

## 实施阶段

### Phase 1：Mastra Tools + Platform Agent

- 实现 ~20 个 Mastra Tools
- Platform Agent 装载所有工具
- Agent Runtime（DB 上下文注入）
- 新增 DB 表 + 迁移
- 工具单元测试

### Phase 2：AG-UI 集成

- AG-UI SSE endpoint
- CopilotKit 前端集成
- Human-in-the-loop
- 对话持久化
- 集成测试

### Phase 3：MCP Server + SDK

- MCP Server（stdio + SSE）
- MCP 代理路由
- TypeScript SDK
- 协议测试

### Phase 4：A2A 协议

- A2A JSON-RPC endpoint
- Agent Card
- A2A 测试

## 新增依赖

| 包                          | 安装位置 | 用途                |
| --------------------------- | -------- | ------------------- |
| `@ag-ui/core`               | core     | AG-UI 事件类型      |
| `@ag-ui/mastra`             | server   | Mastra → AG-UI 桥接 |
| `@copilotkit/react-core`    | web      | CopilotKit Provider |
| `@copilotkit/react-ui`      | web      | 聊天 UI 组件        |
| `@modelcontextprotocol/sdk` | core     | MCP Server          |

## 不变的部分

| 模块                         | 状态     |
| ---------------------------- | -------- |
| `.opencode-review/`          | 不动     |
| `core/templates/renderer.ts` | 不动     |
| `core/templates/defaults.ts` | 不动     |
| `core/providers/`            | 接口不变 |
| `core/review/engine.ts`      | 不动     |
| 现有 REST API routes         | 不动     |
