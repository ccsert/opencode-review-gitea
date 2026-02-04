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

// ============ Platform Credentials 表 ============
// 存储用户的 Git 平台凭证，支持多实例配置
// 注意：此表必须在 repositories 表之前定义，因为 repositories 表引用它

export const platformCredentials = pgTable('platform_credentials', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // gitea, github, gitlab
  baseUrl: text('base_url').notNull(),  // 平台 API 地址，如 https://gitea.example.com
  name: text('name').notNull(),         // 用户自定义名称，如 "公司 Gitea"
  // TODO: 实现 Token 加密存储 (AES-256-GCM)，当前明文存储仅用于开发
  accessToken: text('access_token').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
}, (table) => ({
  userIdx: index('idx_platform_creds_user').on(table.userId),
  providerIdx: index('idx_platform_creds_provider').on(table.provider),
}))

export type PlatformCredential = typeof platformCredentials.$inferSelect
export type NewPlatformCredential = typeof platformCredentials.$inferInsert

// ============ Repositories 表 ============

export interface RepositoryConfig {
  filePatterns?: string[]
  ignorePatterns?: string[]
  language?: string
  style?: 'concise' | 'detailed' | 'strict'
  autoReview?: boolean
  triggerKeywords?: string[]
}

/** Webhook 注册状态 */
export type WebhookStatus = 'pending' | 'active' | 'error' | 'manual'

export const repositories = pgTable('repositories', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // 关联平台凭证（推荐方式，Token 集中管理）
  platformCredentialId: text('platform_credential_id')
    .references(() => platformCredentials.id, { onDelete: 'set null' }),
  provider: text('provider').notNull(),
  providerRepoId: text('provider_repo_id'),
  url: text('url').notNull(),
  name: text('name').notNull(),
  webhookSecret: text('webhook_secret'),
  // Webhook 自动注册相关字段
  webhookId: integer('webhook_id'),               // 平台返回的 webhook ID，用于删除/更新
  webhookStatus: text('webhook_status')           // pending: 待注册 | active: 已激活 | error: 注册失败 | manual: 手动配置
    .$type<WebhookStatus>()
    .default('pending'),
  webhookError: text('webhook_error'),            // 注册失败时的错误信息
  // 向后兼容：直接存储的 Token（如果没有关联 platformCredential 则使用此字段）
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

// ============ AI Providers 表 ============
// 存储用户配置的 AI 供应商和 API Key

export const aiProviders = pgTable('ai_providers', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),           // 用户自定义名称，如 "我的 DeepSeek"
  provider: text('provider').notNull(),   // openai, anthropic, deepseek, openrouter, ollama, custom
  baseUrl: text('base_url'),              // API 基础 URL，如 https://api.deepseek.com
  // TODO: 实现 API Key 加密存储 (AES-256-GCM)，当前明文存储仅用于开发
  apiKey: text('api_key'),                // API 密钥（可选，ollama 可能不需要）
  models: jsonb('models').$type<string[]>().default([]),  // 可用模型列表
  defaultModel: text('default_model'),    // 默认使用的模型
  isDefault: boolean('is_default').notNull().default(false),  // 是否为默认供应商
  isEnabled: boolean('is_enabled').notNull().default(true),   // 是否启用
  config: jsonb('config').$type<{
    maxTokens?: number
    temperature?: number
    timeout?: number
    [key: string]: unknown
  }>().default({}),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
}, (table) => ({
  userIdx: index('idx_ai_providers_user').on(table.userId),
  providerIdx: index('idx_ai_providers_provider').on(table.provider),
  defaultIdx: index('idx_ai_providers_default').on(table.userId, table.isDefault),
}))

export type AiProvider = typeof aiProviders.$inferSelect
export type NewAiProvider = typeof aiProviders.$inferInsert

// 预定义的 AI 供应商信息
export const PREDEFINED_PROVIDERS = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-4', 'openai/gpt-4o', 'google/gemini-2.0-flash-001', 'deepseek/deepseek-chat'],
  },
  ollama: {
    name: 'Ollama (本地)',
    baseUrl: 'http://localhost:11434',
    models: ['llama3.3', 'qwen2.5-coder', 'deepseek-coder-v2', 'codellama'],
  },
  custom: {
    name: '自定义',
    baseUrl: '',
    models: [],
  },
} as const

export type PredefinedProviderKey = keyof typeof PREDEFINED_PROVIDERS
