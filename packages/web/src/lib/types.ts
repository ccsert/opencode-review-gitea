/**
 * API 响应类型定义
 */

// 通用分页响应
export interface PaginationMeta {
  page: number
  pageSize?: number
  limit?: number
  total: number
  totalPages: number
}

export interface ApiResponse<T> {
  success: boolean
  data: T
  error?: {
    code: string
    message: string
  }
}

export interface PaginatedResponse<T> {
  success: boolean
  data: {
    items: T[]
    pagination: PaginationMeta
  }
}

// Repository 类型
export type ProviderType = 'gitea' | 'github' | 'gitlab'

export interface Repository {
  id: string
  provider: ProviderType
  name: string
  url: string
  enabled: boolean
  templateId: string | null
  config?: RepositoryConfig
  reviewCount: number
  lastReviewAt: string | null
  createdAt: string
  webhookUrl?: string
  webhookSecret?: string
}

export interface RepositoryConfig {
  language?: string
  style?: 'concise' | 'detailed' | 'strict'
  autoReview?: boolean
  filePatterns?: string[]
  ignorePatterns?: string[]
}

export interface CreateRepositoryInput {
  provider: ProviderType
  url: string
  accessToken: string
  webhookSecret?: string
  templateId?: string
  skipValidation?: boolean
  config?: RepositoryConfig
}

export interface UpdateRepositoryInput {
  enabled?: boolean
  templateId?: string | null
  webhookSecret?: string
  config?: RepositoryConfig
}

export interface RepositoryWithWebhook extends Repository {
  webhookUrl: string
  webhookSecret: string
}

// Review 类型
export type ReviewStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type ReviewDecision = 'APPROVED' | 'REQUEST_CHANGES' | 'COMMENT'

export interface Review {
  id: string
  repositoryId: string
  prNumber: number
  prTitle: string
  prAuthor: string
  prUrl: string
  status: ReviewStatus
  decision: ReviewDecision | null
  commentsCount: number
  model: string | null
  durationMs: number | null
  triggeredBy: string
  createdAt: string
  completedAt: string | null
}

export interface ReviewDetail extends Review {
  summary: string | null
  comments: ReviewComment[]
  error: string | null
  tokensUsed: number | null
}

export interface ReviewComment {
  id: string
  path: string
  line: number
  body: string
  category: string
  severity: string
}

export interface ReviewStats {
  total: number
  completed: number
  failed: number
  pending: number
  avgDuration: number
  byDecision: {
    APPROVE: number
    REQUEST_CHANGES: number
    COMMENT: number
  }
  last7Days: Array<{
    date: string
    count: number
  }>
}

export interface ReviewFilters {
  repositoryId?: string
  status?: ReviewStatus
  decision?: ReviewDecision
  prAuthor?: string
  startDate?: string
  endDate?: string
  page?: number
  limit?: number
}

// Template 类型
export interface Template {
  id: string
  name: string
  description: string | null
  systemPrompt?: string
  isSystem: boolean
  isDefault: boolean
  categories: string[]
  severities: string[]
  createdAt: string | null
  updatedAt?: string | null
}

export interface CreateTemplateInput {
  name: string
  description?: string
  systemPrompt: string
  categories?: string[]
  severities?: string[]
}

export interface UpdateTemplateInput {
  name?: string
  description?: string
  systemPrompt?: string
  categories?: string[]
  severities?: string[]
  isDefault?: boolean
}

// API Key 类型
export type ApiKeyScope = 'webhook' | 'read' | 'write' | 'admin'

export interface ApiKey {
  id: string
  name: string
  prefix: string
  scopes: ApiKeyScope[]
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
}

export interface CreateApiKeyInput {
  name: string
  scopes?: ApiKeyScope[]
  expiresInDays?: number
}

export interface CreatedApiKey extends ApiKey {
  key: string
  warning: string
}

// ============ Platform 类型 ============

export interface Platform {
  id: string
  provider: ProviderType
  baseUrl: string
  name: string
  lastUsedAt: string | null
  createdAt: string
}

export interface CreatePlatformInput {
  provider: ProviderType
  baseUrl: string
  name: string
  accessToken: string
}

export interface UpdatePlatformInput {
  name?: string
  accessToken?: string
}

export interface Organization {
  id: number
  name: string
  fullName: string
  description?: string
  avatarUrl?: string
  url: string
}

export interface RemoteRepository {
  id: number
  name: string
  fullName: string
  description?: string
  defaultBranch: string
  private: boolean
  url: string
}

export interface ImportRepositoriesInput {
  platformCredentialId: string
  repositories: Array<{
    fullName: string
    url: string
  }>
  templateId?: string
  config?: RepositoryConfig
}

export interface ImportResult {
  imported: number
  failed: number
  results: Array<{
    fullName: string
    success: boolean
    id?: string
    error?: string
    webhookUrl?: string
    webhookSecret?: string
  }>
}

// AI Provider 类型
export type AiProviderType = 'openai' | 'anthropic' | 'deepseek' | 'openrouter' | 'ollama' | 'custom'

export interface AiProvider {
  id: string
  name: string
  provider: AiProviderType
  baseUrl: string | null
  models: string[]
  defaultModel: string | null
  isDefault: boolean
  isEnabled: boolean
  config?: {
    maxTokens?: number
    temperature?: number
    timeout?: number
    [key: string]: unknown
  }
  lastUsedAt: string | null
  createdAt: string
}

export interface AiProviderPreset {
  id: AiProviderType
  name: string
  baseUrl: string
  models: string[]
}

export interface CreateAiProviderInput {
  name: string
  provider: AiProviderType
  baseUrl?: string
  apiKey?: string
  models?: string[]
  defaultModel?: string
  isDefault?: boolean
  config?: {
    maxTokens?: number
    temperature?: number
    timeout?: number
  }
}

export interface UpdateAiProviderInput {
  name?: string
  baseUrl?: string
  apiKey?: string
  models?: string[]
  defaultModel?: string
  isDefault?: boolean
  isEnabled?: boolean
  config?: {
    maxTokens?: number
    temperature?: number
    timeout?: number
  }
}

export interface TestAiConnectionInput {
  provider: AiProviderType
  baseUrl?: string
  apiKey?: string
  model?: string
}

export interface TestAiConnectionResult {
  connected: boolean
  models: string[]
  message: string
}

