/**
 * 数据库 Schema 定义
 * 使用 Drizzle ORM + PGlite (PostgreSQL 兼容)
 * 
 * PGlite 是一个在浏览器和 Node.js 中运行的轻量级 PostgreSQL
 * 完全兼容 PostgreSQL 语法，方便后续迁移到完整 PostgreSQL
 */

import { sql } from 'drizzle-orm'
import { 
  pgTable, 
  text, 
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'

// ============ Users 表 ============

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

// ============ API Keys 表 ============

export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  scopes: jsonb('scopes').$type<string[]>().default([]),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export type ApiKey = typeof apiKeys.$inferSelect
export type NewApiKey = typeof apiKeys.$inferInsert

// ============ Review Templates 表 ============

export const reviewTemplates = pgTable('review_templates', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  systemPrompt: text('system_prompt').notNull(),
  categories: jsonb('categories')
    .$type<string[]>()
    .default(['BUG', 'SECURITY', 'PERFORMANCE', 'STYLE']),
  severities: jsonb('severities')
    .$type<string[]>()
    .default(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  isDefault: boolean('is_default').notNull().default(false),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
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

export const repositories = pgTable('repositories', {
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
  config: jsonb('config').$type<RepositoryConfig>().default({}),
  enabled: boolean('enabled').notNull().default(true),
  lastReviewAt: timestamp('last_review_at', { withTimezone: true }),
  reviewCount: integer('review_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
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

export const reviews = pgTable('reviews', {
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
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  repoIdx: index('idx_reviews_repo').on(table.repositoryId, table.createdAt),
  statusIdx: index('idx_reviews_status').on(table.status),
}))

export type Review = typeof reviews.$inferSelect
export type NewReview = typeof reviews.$inferInsert

// ============ Webhook Logs 表 ============

export const webhookLogs = pgTable('webhook_logs', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id')
    .references(() => repositories.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  deliveryId: text('delivery_id'),
  payload: jsonb('payload'),
  headers: jsonb('headers'),
  processed: boolean('processed').notNull().default(false),
  reviewId: text('review_id'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  repoIdx: index('idx_webhook_logs_repo').on(table.repositoryId),
  deliveryIdx: index('idx_webhook_logs_delivery').on(table.deliveryId),
}))

export type WebhookLog = typeof webhookLogs.$inferSelect
export type NewWebhookLog = typeof webhookLogs.$inferInsert
