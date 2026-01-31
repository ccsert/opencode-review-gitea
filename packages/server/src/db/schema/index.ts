/**
 * 数据库 Schema 定义
 * 使用 Drizzle ORM，同时支持 SQLite 和 PostgreSQL
 */

import { sql } from 'drizzle-orm'
import { 
  sqliteTable, 
  text, 
  integer,
  index,
} from 'drizzle-orm/sqlite-core'

// ============ Users 表 ============

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('user'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

// ============ API Keys 表 ============

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  scopes: text('scopes', { mode: 'json' }).$type<string[]>().default([]),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type ApiKey = typeof apiKeys.$inferSelect
export type NewApiKey = typeof apiKeys.$inferInsert

// ============ Review Templates 表 ============

export const reviewTemplates = sqliteTable('review_templates', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  systemPrompt: text('system_prompt').notNull(),
  categories: text('categories', { mode: 'json' })
    .$type<string[]>()
    .default(['BUG', 'SECURITY', 'PERFORMANCE', 'STYLE']),
  severities: text('severities', { mode: 'json' })
    .$type<string[]>()
    .default(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
})

export type ReviewTemplate = typeof reviewTemplates.$inferSelect
export type NewReviewTemplate = typeof reviewTemplates.$inferInsert

// ============ Repositories 表 ============

export interface RepositoryConfig {
  filePatterns?: string[]
  ignorePatterns?: string[]
  language?: string
  style?: 'concise' | 'detailed' | 'strict'
  autoReview?: boolean
  triggerKeywords?: string[]
}

export const repositories = sqliteTable('repositories', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  providerRepoId: text('provider_repo_id'),
  url: text('url').notNull(),
  name: text('name').notNull(),
  webhookSecret: text('webhook_secret'),
  accessToken: text('access_token'),
  templateId: text('template_id')
    .references(() => reviewTemplates.id, { onDelete: 'set null' }),
  config: text('config', { mode: 'json' }).$type<RepositoryConfig>().default({}),
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

export type Repository = typeof repositories.$inferSelect
export type NewRepository = typeof repositories.$inferInsert

// ============ Reviews 表 ============

export type ReviewStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type ReviewDecision = 'APPROVED' | 'REQUEST_CHANGES' | 'COMMENT'

export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  prNumber: integer('pr_number').notNull(),
  prTitle: text('pr_title'),
  prAuthor: text('pr_author'),
  prUrl: text('pr_url'),
  status: text('status').$type<ReviewStatus>().notNull().default('pending'),
  summary: text('summary'),
  decision: text('decision').$type<ReviewDecision>(),
  commentsCount: integer('comments_count').notNull().default(0),
  model: text('model'),
  tokensUsed: integer('tokens_used'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  triggeredBy: text('triggered_by'),
  webhookEventId: text('webhook_event_id'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
}, (table) => ({
  repoIdx: index('idx_reviews_repo').on(table.repositoryId, table.createdAt),
  statusIdx: index('idx_reviews_status').on(table.status),
}))

export type Review = typeof reviews.$inferSelect
export type NewReview = typeof reviews.$inferInsert

// ============ Webhook Logs 表 ============

export const webhookLogs = sqliteTable('webhook_logs', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id')
    .references(() => repositories.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  deliveryId: text('delivery_id'),
  payload: text('payload', { mode: 'json' }),
  headers: text('headers', { mode: 'json' }),
  processed: integer('processed', { mode: 'boolean' }).notNull().default(false),
  reviewId: text('review_id'),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => ({
  repoIdx: index('idx_webhook_logs_repo').on(table.repositoryId),
  deliveryIdx: index('idx_webhook_logs_delivery').on(table.deliveryId),
}))

export type WebhookLog = typeof webhookLogs.$inferSelect
export type NewWebhookLog = typeof webhookLogs.$inferInsert
