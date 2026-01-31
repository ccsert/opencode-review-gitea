# API 设计

> RESTful API 设计，使用 Hono 框架实现。

## 设计原则

1. **RESTful** - 遵循 REST 规范，资源导向
2. **一致性** - 统一的响应格式和错误处理
3. **安全性** - JWT 认证 + API Key 双模式
4. **OpenAPI** - 自动生成 API 文档

## 基础 URL

```
生产环境: https://your-domain.com/api/v1
开发环境: http://localhost:3000/api/v1
```

## 认证方式

### 1. JWT Token（Web 界面）

```http
Authorization: Bearer <jwt_token>
```

### 2. API Key（Webhook / 程序调用）

```http
Authorization: ApiKey <api_key>
# 或
X-API-Key: <api_key>
```

## 响应格式

### 成功响应

```json
{
  "success": true,
  "data": { ... }
}
```

### 列表响应（带分页）

```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

### 错误响应

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "details": [
      { "field": "url", "message": "Invalid URL format" }
    ]
  }
}
```

## API 端点

### 认证 `/auth`

#### POST /auth/login

用户登录（密钥认证）。

**请求**
```json
{
  "secret": "your-admin-secret"
}
```

**响应**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 900
  }
}
```

#### POST /auth/refresh

刷新访问令牌。

**请求**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### POST /auth/logout

登出并废弃令牌。

---

### 仓库管理 `/repositories`

#### GET /repositories

获取仓库列表。

**查询参数**
| 参数 | 类型 | 说明 |
|------|------|------|
| `page` | number | 页码，默认 1 |
| `pageSize` | number | 每页数量，默认 20 |
| `provider` | string | 按平台过滤：gitea/github/gitlab |
| `enabled` | boolean | 按启用状态过滤 |
| `search` | string | 搜索仓库名 |

**响应**
```json
{
  "success": true,
  "data": [
    {
      "id": "01HQ3XYZABC123456789",
      "provider": "gitea",
      "name": "owner/repo-name",
      "url": "https://gitea.example.com/owner/repo-name",
      "enabled": true,
      "template": {
        "id": "01HQ3XYZDEF123456789",
        "name": "Default Template"
      },
      "reviewCount": 42,
      "lastReviewAt": "2024-01-15T10:30:00Z",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 5,
    "totalPages": 1
  }
}
```

#### POST /repositories

添加新仓库。

**请求**
```json
{
  "provider": "gitea",
  "url": "https://gitea.example.com/owner/repo-name",
  "accessToken": "your-gitea-token",
  "webhookSecret": "optional-webhook-secret",
  "templateId": "01HQ3XYZDEF123456789",
  "config": {
    "language": "zh-CN",
    "style": "detailed",
    "autoReview": true,
    "filePatterns": ["*.ts", "*.tsx"],
    "ignorePatterns": ["*.test.ts", "dist/**"]
  }
}
```

**响应**
```json
{
  "success": true,
  "data": {
    "id": "01HQ3XYZABC123456789",
    "provider": "gitea",
    "name": "owner/repo-name",
    "webhookUrl": "https://your-domain.com/api/v1/webhooks/gitea/01HQ3XYZABC123456789"
  }
}
```

#### GET /repositories/:id

获取仓库详情。

#### PUT /repositories/:id

更新仓库配置。

**请求**
```json
{
  "enabled": true,
  "templateId": "01HQ3XYZDEF123456789",
  "config": {
    "language": "en",
    "style": "concise"
  }
}
```

#### DELETE /repositories/:id

删除仓库。

#### POST /repositories/:id/test

测试仓库连接。

**响应**
```json
{
  "success": true,
  "data": {
    "connected": true,
    "repository": {
      "name": "owner/repo-name",
      "defaultBranch": "main",
      "private": false
    }
  }
}
```

#### GET /repositories/:id/webhook-url

获取 Webhook URL 配置信息。

**响应**
```json
{
  "success": true,
  "data": {
    "url": "https://your-domain.com/api/v1/webhooks/gitea/01HQ3XYZABC123456789",
    "secret": "wh_abc123...",
    "events": ["pull_request", "issue_comment"],
    "instructions": "在 Gitea 仓库设置 > Webhooks 中添加此 URL"
  }
}
```

---

### Review 模板 `/templates`

#### GET /templates

获取模板列表。

**查询参数**
| 参数 | 类型 | 说明 |
|------|------|------|
| `includeSystem` | boolean | 是否包含系统模板 |

**响应**
```json
{
  "success": true,
  "data": [
    {
      "id": "system-default",
      "name": "默认模板",
      "description": "通用代码审查模板",
      "isSystem": true,
      "isDefault": true,
      "categories": ["BUG", "SECURITY", "PERFORMANCE", "STYLE"],
      "severities": ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    },
    {
      "id": "01HQ3XYZDEF123456789",
      "name": "严格模式",
      "description": "更严格的代码规范检查",
      "isSystem": false,
      "isDefault": false,
      "categories": ["BUG", "SECURITY", "PERFORMANCE", "STYLE", "LOGIC"],
      "severities": ["CRITICAL", "HIGH", "MEDIUM"]
    }
  ]
}
```

#### POST /templates

创建新模板。

**请求**
```json
{
  "name": "前端项目模板",
  "description": "针对 React/Vue 项目的审查模板",
  "systemPrompt": "你是一个专业的前端代码审查专家...",
  "categories": ["BUG", "PERFORMANCE", "STYLE", "ACCESSIBILITY"],
  "severities": ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
}
```

#### GET /templates/:id

获取模板详情。

#### PUT /templates/:id

更新模板。

#### DELETE /templates/:id

删除模板（系统模板不可删除）。

#### POST /templates/:id/duplicate

复制模板。

---

### Review 历史 `/reviews`

#### GET /reviews

获取 Review 历史列表。

**查询参数**
| 参数 | 类型 | 说明 |
|------|------|------|
| `repositoryId` | string | 按仓库过滤 |
| `status` | string | 按状态过滤：pending/processing/completed/failed |
| `decision` | string | 按决策过滤：APPROVED/REQUEST_CHANGES/COMMENT |
| `startDate` | string | 开始日期 |
| `endDate` | string | 结束日期 |
| `page` | number | 页码 |
| `pageSize` | number | 每页数量 |

**响应**
```json
{
  "success": true,
  "data": [
    {
      "id": "01HQ3XYZGHI123456789",
      "repository": {
        "id": "01HQ3XYZABC123456789",
        "name": "owner/repo-name"
      },
      "prNumber": 42,
      "prTitle": "feat: Add new feature",
      "prAuthor": "developer",
      "prUrl": "https://gitea.example.com/owner/repo/pulls/42",
      "status": "completed",
      "decision": "REQUEST_CHANGES",
      "summary": "发现 3 个问题需要修复...",
      "commentsCount": 5,
      "model": "deepseek/deepseek-chat",
      "tokensUsed": 2500,
      "durationMs": 8500,
      "triggeredBy": "webhook",
      "createdAt": "2024-01-15T10:30:00Z",
      "completedAt": "2024-01-15T10:30:08Z"
    }
  ],
  "pagination": { ... }
}
```

#### GET /reviews/:id

获取 Review 详情。

**响应**
```json
{
  "success": true,
  "data": {
    "id": "01HQ3XYZGHI123456789",
    "repository": { ... },
    "prNumber": 42,
    "prTitle": "feat: Add new feature",
    "status": "completed",
    "decision": "REQUEST_CHANGES",
    "summary": "## 审查总结\n\n发现以下问题...",
    "comments": [
      {
        "path": "src/index.ts",
        "line": 42,
        "body": "**[BUG:HIGH]** 这里可能存在空指针异常...",
        "category": "BUG",
        "severity": "HIGH"
      }
    ],
    "model": "deepseek/deepseek-chat",
    "tokensUsed": 2500,
    "durationMs": 8500,
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

#### POST /reviews/:id/retry

重试失败的 Review。

---

### Webhook 接收 `/webhooks`

#### POST /webhooks/:provider/:repositoryId

接收 Webhook 事件。

**Headers**
```http
X-Gitea-Event: pull_request
X-Gitea-Delivery: abc123
X-Gitea-Signature: sha256=...
Content-Type: application/json
```

**响应**
```json
{
  "success": true,
  "data": {
    "received": true,
    "eventType": "pull_request.opened",
    "reviewId": "01HQ3XYZGHI123456789"
  }
}
```

#### POST /webhooks/:provider

通用 Webhook 端点（自动路由到对应仓库）。

---

### 统计信息 `/stats`

#### GET /stats/overview

获取总览统计。

**响应**
```json
{
  "success": true,
  "data": {
    "repositories": {
      "total": 10,
      "enabled": 8
    },
    "reviews": {
      "total": 500,
      "thisWeek": 25,
      "thisMonth": 100
    },
    "decisions": {
      "APPROVED": 300,
      "REQUEST_CHANGES": 150,
      "COMMENT": 50
    },
    "avgDuration": 8500,
    "avgTokens": 2500
  }
}
```

#### GET /stats/usage

获取使用量统计（用于成本估算）。

**查询参数**
| 参数 | 类型 | 说明 |
|------|------|------|
| `period` | string | 统计周期：day/week/month |
| `repositoryId` | string | 按仓库过滤 |

---

### 系统 `/system`

#### GET /system/health

健康检查。

**响应**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "version": "1.0.0",
    "database": "connected",
    "opencode": "available"
  }
}
```

#### GET /system/config

获取公开配置。

**响应**
```json
{
  "success": true,
  "data": {
    "providers": ["gitea"],
    "models": ["deepseek/deepseek-chat", "anthropic/claude-3-5-sonnet"],
    "features": {
      "templates": true,
      "webhooks": true,
      "oauth": false
    }
  }
}
```

---

### API Keys `/api-keys`

#### GET /api-keys

获取 API Key 列表。

**响应**
```json
{
  "success": true,
  "data": [
    {
      "id": "01HQ3XYZJKL123456789",
      "name": "CI/CD Key",
      "keyPrefix": "ocr_abc1",
      "scopes": ["webhook"],
      "lastUsedAt": "2024-01-15T10:30:00Z",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### POST /api-keys

创建新的 API Key。

**请求**
```json
{
  "name": "CI/CD Key",
  "scopes": ["webhook", "read"],
  "expiresIn": 2592000
}
```

**响应**
```json
{
  "success": true,
  "data": {
    "id": "01HQ3XYZJKL123456789",
    "name": "CI/CD Key",
    "key": "ocr_abc123def456...",
    "keyPrefix": "ocr_abc1",
    "scopes": ["webhook", "read"],
    "expiresAt": "2024-02-01T00:00:00Z"
  }
}
```

> ⚠️ `key` 只在创建时返回一次，请妥善保存。

#### DELETE /api-keys/:id

删除 API Key。

---

## 错误码

| 错误码 | HTTP 状态 | 说明 |
|--------|-----------|------|
| `UNAUTHORIZED` | 401 | 未认证或认证失效 |
| `FORBIDDEN` | 403 | 权限不足 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `VALIDATION_ERROR` | 400 | 请求参数验证失败 |
| `CONFLICT` | 409 | 资源冲突（如重复添加） |
| `RATE_LIMITED` | 429 | 请求过于频繁 |
| `PROVIDER_ERROR` | 502 | Git 平台 API 错误 |
| `REVIEW_FAILED` | 500 | Review 执行失败 |
| `INTERNAL_ERROR` | 500 | 内部服务器错误 |

---

## 速率限制

| 端点类型 | 限制 |
|----------|------|
| 认证端点 | 10 次/分钟 |
| Webhook | 100 次/分钟 |
| API 读取 | 60 次/分钟 |
| API 写入 | 30 次/分钟 |

超出限制返回：
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "retryAfter": 30
  }
}
```

---

## OpenAPI 文档

访问 `/api/v1/doc` 获取 OpenAPI 3.1 规范文档。
