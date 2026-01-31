# 数据库设计

> 使用 Drizzle ORM 实现，支持 SQLite 和 PostgreSQL 双数据库。

## 设计原则

1. **数据库无关** - 使用 Drizzle ORM 抽象，同一 Schema 支持多数据库
2. **简洁高效** - 表结构精简，避免过度设计
3. **类型安全** - 完整的 TypeScript 类型推导
4. **可扩展** - 预留未来功能扩展字段

## ER 图

```
┌─────────────────┐       ┌─────────────────┐
│     users       │       │    api_keys     │
├─────────────────┤       ├─────────────────┤
│ id (PK)         │───┐   │ id (PK)         │
│ email           │   │   │ user_id (FK)    │──┐
│ password_hash   │   │   │ name            │  │
│ created_at      │   │   │ key_hash        │  │
└─────────────────┘   │   │ scopes          │  │
                      │   │ last_used_at    │  │
                      │   │ created_at      │  │
                      │   └─────────────────┘  │
                      │                        │
                      ▼                        │
┌─────────────────┐                           │
│  repositories   │◄──────────────────────────┘
├─────────────────┤
│ id (PK)         │
│ user_id (FK)    │
│ provider        │───────────────┐
│ provider_repo_id│               │
│ url             │               │
│ name            │               ▼
│ webhook_secret  │       ┌─────────────────┐
│ access_token    │       │ review_templates│
│ template_id (FK)│──────►├─────────────────┤
│ config          │       │ id (PK)         │
│ enabled         │       │ user_id (FK)    │
│ created_at      │       │ name            │
└─────────────────┘       │ description     │
        │                 │ system_prompt   │
        │                 │ categories      │
        ▼                 │ severities      │
┌─────────────────┐       │ is_default      │
│    reviews      │       │ created_at      │
├─────────────────┤       │ updated_at      │
│ id (PK)         │       └─────────────────┘
│ repository_id   │
│ pr_number       │
│ pr_title        │
│ status          │
│ summary         │
│ decision        │
│ comments_count  │
│ model           │
│ tokens_used     │
│ duration_ms     │
│ error           │
│ created_at      │
└─────────────────┘
        │
        ▼
┌─────────────────┐
│  webhook_logs   │
├─────────────────┤
│ id (PK)         │
│ repository_id   │
│ event_type      │
│ payload         │
│ processed       │
│ error           │
│ created_at      │
└─────────────────┘
```

## Schema 定义

### 通用工具

```typescript
// packages/server/src/db/utils.ts

import { sql } from 'drizzle-orm'

/**
 * 生成 ULID 作为主键
 * 使用 ULID 而非 UUID：
 * - 有序性：按时间排序
 * - URL 安全：无特殊字符
 * - 紧凑：26 字符
 */
export function generateId(): string {
  // 简单实现，实际使用 ulid 库
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 12)
  return `${timestamp}${random}`.substring(0, 26)
}

/**
 * 当前时间戳（秒）
 */
export const currentTimestamp = sql`(unixepoch())`
```

### Users 表

```typescript
// packages/server/src/db/schema/users.ts

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { pgTable, varchar, timestamp } from 'drizzle-orm/pg-core'

// ============ SQLite Schema ============
export const usersSqlite = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// ============ PostgreSQL Schema ============
export const usersPostgres = pgTable('users', {
  id: varchar('id', { length: 26 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ============ 类型导出 ============
export type User = typeof usersSqlite.$inferSelect
export type NewUser = typeof usersSqlite.$inferInsert
```

### API Keys 表

```typescript
// packages/server/src/db/schema/api-keys.ts

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { pgTable, varchar, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { usersSqlite, usersPostgres } from './users'

// ============ SQLite Schema ============
export const apiKeysSqlite = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => usersSqlite.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),  // SHA256 hash
  keyPrefix: text('key_prefix').notNull(),  // 前 8 位，用于识别
  scopes: text('scopes', { mode: 'json' }).$type<string[]>().default([]),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// ============ PostgreSQL Schema ============
export const apiKeysPostgres = pgTable('api_keys', {
  id: varchar('id', { length: 26 }).primaryKey(),
  userId: varchar('user_id', { length: 26 })
    .notNull()
    .references(() => usersPostgres.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  keyHash: varchar('key_hash', { length: 64 }).notNull(),
  keyPrefix: varchar('key_prefix', { length: 8 }).notNull(),
  scopes: jsonb('scopes').$type<string[]>().default([]),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export type ApiKey = typeof apiKeysSqlite.$inferSelect
export type NewApiKey = typeof apiKeysSqlite.$inferInsert
```

### Repositories 表

```typescript
// packages/server/src/db/schema/repositories.ts

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { pgTable, varchar, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core'
import { usersSqlite, usersPostgres } from './users'
import { reviewTemplatesSqlite, reviewTemplatesPostgres } from './review-templates'

// ============ 仓库配置类型 ============
export interface RepositoryConfig {
  /** 文件过滤模式 */
  filePatterns?: string[]
  /** 忽略的文件 */
  ignorePatterns?: string[]
  /** Review 语言 */
  language?: string
  /** Review 风格 */
  style?: 'concise' | 'detailed' | 'strict'
  /** 自动 Review 开关 */
  autoReview?: boolean
  /** 触发关键词 */
  triggerKeywords?: string[]
}

// ============ SQLite Schema ============
export const repositoriesSqlite = sqliteTable('repositories', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => usersSqlite.id, { onDelete: 'cascade' }),
  
  // 平台信息
  provider: text('provider').notNull(),  // 'gitea' | 'github' | 'gitlab'
  providerRepoId: text('provider_repo_id'),  // 平台侧的仓库 ID
  url: text('url').notNull(),  // 仓库 URL
  name: text('name').notNull(),  // owner/repo
  
  // 认证信息（加密存储）
  webhookSecret: text('webhook_secret'),
  accessToken: text('access_token'),  // 加密的 Token
  
  // 配置
  templateId: text('template_id')
    .references(() => reviewTemplatesSqlite.id, { onDelete: 'set null' }),
  config: text('config', { mode: 'json' }).$type<RepositoryConfig>().default({}),
  
  // 状态
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastReviewAt: integer('last_review_at', { mode: 'timestamp' }),
  reviewCount: integer('review_count').notNull().default(0),
  
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
}, (table) => ({
  userIdx: index('idx_repos_user').on(table.userId),
  providerIdx: index('idx_repos_provider').on(table.provider, table.providerRepoId),
  nameIdx: index('idx_repos_name').on(table.name),
}))

// ============ PostgreSQL Schema ============
export const repositoriesPostgres = pgTable('repositories', {
  id: varchar('id', { length: 26 }).primaryKey(),
  userId: varchar('user_id', { length: 26 })
    .notNull()
    .references(() => usersPostgres.id, { onDelete: 'cascade' }),
  
  provider: varchar('provider', { length: 20 }).notNull(),
  providerRepoId: varchar('provider_repo_id', { length: 100 }),
  url: varchar('url', { length: 500 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  
  webhookSecret: varchar('webhook_secret', { length: 255 }),
  accessToken: varchar('access_token', { length: 500 }),
  
  templateId: varchar('template_id', { length: 26 })
    .references(() => reviewTemplatesPostgres.id, { onDelete: 'set null' }),
  config: jsonb('config').$type<RepositoryConfig>().default({}),
  
  enabled: boolean('enabled').notNull().default(true),
  lastReviewAt: timestamp('last_review_at'),
  reviewCount: integer('review_count').notNull().default(0),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at'),
})

export type Repository = typeof repositoriesSqlite.$inferSelect
export type NewRepository = typeof repositoriesSqlite.$inferInsert
```

### Review Templates 表

```typescript
// packages/server/src/db/schema/review-templates.ts

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { pgTable, varchar, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core'
import { usersSqlite, usersPostgres } from './users'

// ============ 模板分类和严重级别 ============
export type ReviewCategory = 
  | 'BUG' 
  | 'SECURITY' 
  | 'PERFORMANCE' 
  | 'STYLE' 
  | 'DOCS' 
  | 'TEST'
  | 'LOGIC'
  | 'REFACTOR'

export type ReviewSeverity = 
  | 'CRITICAL' 
  | 'HIGH' 
  | 'MEDIUM' 
  | 'LOW'

// ============ SQLite Schema ============
export const reviewTemplatesSqlite = sqliteTable('review_templates', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .references(() => usersSqlite.id, { onDelete: 'cascade' }),  // null = 系统模板
  
  name: text('name').notNull(),
  description: text('description'),
  
  // 模板内容
  systemPrompt: text('system_prompt').notNull(),
  categories: text('categories', { mode: 'json' })
    .$type<ReviewCategory[]>()
    .default(['BUG', 'SECURITY', 'PERFORMANCE', 'STYLE']),
  severities: text('severities', { mode: 'json' })
    .$type<ReviewSeverity[]>()
    .default(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  
  // 元数据
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
})

// ============ PostgreSQL Schema ============
export const reviewTemplatesPostgres = pgTable('review_templates', {
  id: varchar('id', { length: 26 }).primaryKey(),
  userId: varchar('user_id', { length: 26 })
    .references(() => usersPostgres.id, { onDelete: 'cascade' }),
  
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  
  systemPrompt: text('system_prompt').notNull(),
  categories: jsonb('categories')
    .$type<ReviewCategory[]>()
    .default(['BUG', 'SECURITY', 'PERFORMANCE', 'STYLE']),
  severities: jsonb('severities')
    .$type<ReviewSeverity[]>()
    .default(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  
  isDefault: boolean('is_default').notNull().default(false),
  isSystem: boolean('is_system').notNull().default(false),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at'),
})

export type ReviewTemplate = typeof reviewTemplatesSqlite.$inferSelect
export type NewReviewTemplate = typeof reviewTemplatesSqlite.$inferInsert
```

### Reviews 表

```typescript
// packages/server/src/db/schema/reviews.ts

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { pgTable, varchar, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { repositoriesSqlite, repositoriesPostgres } from './repositories'

export type ReviewStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type ReviewDecision = 'APPROVED' | 'REQUEST_CHANGES' | 'COMMENT'

// ============ SQLite Schema ============
export const reviewsSqlite = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id')
    .notNull()
    .references(() => repositoriesSqlite.id, { onDelete: 'cascade' }),
  
  // PR 信息
  prNumber: integer('pr_number').notNull(),
  prTitle: text('pr_title'),
  prAuthor: text('pr_author'),
  prUrl: text('pr_url'),
  
  // 审查结果
  status: text('status').$type<ReviewStatus>().notNull().default('pending'),
  summary: text('summary'),
  decision: text('decision').$type<ReviewDecision>(),
  commentsCount: integer('comments_count').notNull().default(0),
  
  // 执行信息
  model: text('model'),  // 'deepseek/deepseek-chat'
  tokensUsed: integer('tokens_used'),
  durationMs: integer('duration_ms'),
  
  // 错误信息
  error: text('error'),
  
  // 触发信息
  triggeredBy: text('triggered_by'),  // 'webhook' | 'manual' | 'comment:user'
  webhookEventId: text('webhook_event_id'),
  
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
}, (table) => ({
  repoIdx: index('idx_reviews_repo').on(table.repositoryId, table.createdAt),
  statusIdx: index('idx_reviews_status').on(table.status),
}))

// ============ PostgreSQL Schema ============
export const reviewsPostgres = pgTable('reviews', {
  id: varchar('id', { length: 26 }).primaryKey(),
  repositoryId: varchar('repository_id', { length: 26 })
    .notNull()
    .references(() => repositoriesPostgres.id, { onDelete: 'cascade' }),
  
  prNumber: integer('pr_number').notNull(),
  prTitle: varchar('pr_title', { length: 500 }),
  prAuthor: varchar('pr_author', { length: 100 }),
  prUrl: varchar('pr_url', { length: 500 }),
  
  status: varchar('status', { length: 20 }).$type<ReviewStatus>().notNull().default('pending'),
  summary: text('summary'),
  decision: varchar('decision', { length: 20 }).$type<ReviewDecision>(),
  commentsCount: integer('comments_count').notNull().default(0),
  
  model: varchar('model', { length: 100 }),
  tokensUsed: integer('tokens_used'),
  durationMs: integer('duration_ms'),
  
  error: text('error'),
  
  triggeredBy: varchar('triggered_by', { length: 50 }),
  webhookEventId: varchar('webhook_event_id', { length: 50 }),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
})

export type Review = typeof reviewsSqlite.$inferSelect
export type NewReview = typeof reviewsSqlite.$inferInsert
```

### Webhook Logs 表

```typescript
// packages/server/src/db/schema/webhook-logs.ts

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { pgTable, varchar, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core'
import { repositoriesSqlite, repositoriesPostgres } from './repositories'

// ============ SQLite Schema ============
export const webhookLogsSqlite = sqliteTable('webhook_logs', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id')
    .references(() => repositoriesSqlite.id, { onDelete: 'cascade' }),
  
  // 事件信息
  eventType: text('event_type').notNull(),  // 'pull_request.opened' etc
  deliveryId: text('delivery_id'),  // 来自平台的 delivery ID
  
  // 请求数据（调试用）
  payload: text('payload', { mode: 'json' }),
  headers: text('headers', { mode: 'json' }),
  
  // 处理状态
  processed: integer('processed', { mode: 'boolean' }).notNull().default(false),
  reviewId: text('review_id'),  // 关联的 review
  error: text('error'),
  
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => ({
  repoIdx: index('idx_webhook_logs_repo').on(table.repositoryId),
  deliveryIdx: index('idx_webhook_logs_delivery').on(table.deliveryId),
}))

// ============ PostgreSQL Schema ============
export const webhookLogsPostgres = pgTable('webhook_logs', {
  id: varchar('id', { length: 26 }).primaryKey(),
  repositoryId: varchar('repository_id', { length: 26 })
    .references(() => repositoriesPostgres.id, { onDelete: 'cascade' }),
  
  eventType: varchar('event_type', { length: 50 }).notNull(),
  deliveryId: varchar('delivery_id', { length: 50 }),
  
  payload: jsonb('payload'),
  headers: jsonb('headers'),
  
  processed: boolean('processed').notNull().default(false),
  reviewId: varchar('review_id', { length: 26 }),
  error: text('error'),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export type WebhookLog = typeof webhookLogsSqlite.$inferSelect
export type NewWebhookLog = typeof webhookLogsSqlite.$inferInsert
```

## 数据库客户端

```typescript
// packages/server/src/db/client.ts

import { drizzle as drizzleSqlite } from 'drizzle-orm/bun-sqlite'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { migrate as migrateSqlite } from 'drizzle-orm/bun-sqlite/migrator'
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator'
import { Database } from 'bun:sqlite'
import postgres from 'postgres'

import * as schemaSqlite from './schema/sqlite'
import * as schemaPostgres from './schema/postgres'

export type DatabaseType = 'sqlite' | 'postgres'

export interface DatabaseConfig {
  type: DatabaseType
  url: string  // file:./data/review.db 或 postgres://...
}

/**
 * 创建数据库连接
 */
export function createDatabase(config: DatabaseConfig) {
  if (config.type === 'sqlite') {
    const sqlite = new Database(config.url.replace('file:', ''))
    return {
      db: drizzleSqlite(sqlite, { schema: schemaSqlite }),
      type: 'sqlite' as const,
      close: () => sqlite.close(),
    }
  }

  if (config.type === 'postgres') {
    const client = postgres(config.url)
    return {
      db: drizzlePostgres(client, { schema: schemaPostgres }),
      type: 'postgres' as const,
      close: () => client.end(),
    }
  }

  throw new Error(`Unknown database type: ${config.type}`)
}

/**
 * 从 DATABASE_URL 自动检测数据库类型
 */
export function detectDatabaseType(url: string): DatabaseType {
  if (url.startsWith('file:') || url.endsWith('.db') || url.endsWith('.sqlite')) {
    return 'sqlite'
  }
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    return 'postgres'
  }
  throw new Error(`Cannot detect database type from URL: ${url}`)
}

/**
 * 运行数据库迁移
 */
export async function runMigrations(config: DatabaseConfig) {
  const migrationsFolder = `./drizzle/migrations/${config.type}`
  
  if (config.type === 'sqlite') {
    const sqlite = new Database(config.url.replace('file:', ''))
    const db = drizzleSqlite(sqlite)
    await migrateSqlite(db, { migrationsFolder })
    sqlite.close()
    return
  }

  if (config.type === 'postgres') {
    const client = postgres(config.url, { max: 1 })
    const db = drizzlePostgres(client)
    await migratePostgres(db, { migrationsFolder })
    await client.end()
  }
}
```

## 迁移命令

```json
// package.json scripts
{
  "scripts": {
    "db:generate:sqlite": "drizzle-kit generate:sqlite --schema=./src/db/schema/sqlite.ts",
    "db:generate:postgres": "drizzle-kit generate:pg --schema=./src/db/schema/postgres.ts",
    "db:migrate": "bun run src/db/migrate.ts",
    "db:studio": "drizzle-kit studio"
  }
}
```

## 加密存储

敏感字段（如 `accessToken`）使用 AES-256-GCM 加密：

```typescript
// packages/server/src/db/crypto.ts

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex')

export function encrypt(text: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, KEY, iv)
  
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  
  const authTag = cipher.getAuthTag()
  
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

export function decrypt(encrypted: string): string {
  const [ivHex, authTagHex, encryptedText] = encrypted.split(':')
  
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, KEY, iv)
  
  decipher.setAuthTag(authTag)
  
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  
  return decrypted
}
```

## 索引策略

| 表 | 索引 | 用途 |
|---|---|---|
| `repositories` | `(user_id)` | 用户仓库列表 |
| `repositories` | `(provider, provider_repo_id)` | Webhook 路由 |
| `repositories` | `(name)` | 按名称搜索 |
| `reviews` | `(repository_id, created_at DESC)` | 仓库 Review 历史 |
| `reviews` | `(status)` | 按状态查询 |
| `webhook_logs` | `(repository_id)` | 仓库 Webhook 日志 |
| `webhook_logs` | `(delivery_id)` | 幂等性检查 |
