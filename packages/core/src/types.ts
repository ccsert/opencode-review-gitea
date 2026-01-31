/**
 * 共享类型定义
 */

// ============ 用户相关 ============

export interface User {
  id: number
  login: string
  avatarUrl?: string
}

// ============ 仓库相关 ============

export interface Repository {
  id: number
  name: string
  fullName: string  // owner/repo
  description?: string
  defaultBranch: string
  private: boolean
  url: string
}

// ============ Pull Request 相关 ============

export interface PullRequest {
  id: number
  number: number
  title: string
  body?: string
  state: 'open' | 'closed' | 'merged'
  author: User
  base: {
    ref: string
    sha: string
  }
  head: {
    ref: string
    sha: string
  }
  createdAt: Date
  updatedAt: Date
}

export interface ChangedFile {
  filename: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  patch?: string
}

// ============ Review 相关 ============

export type ReviewDecision = 'APPROVED' | 'REQUEST_CHANGES' | 'COMMENT'

export interface CreateReviewRequest {
  body: string
  decision: ReviewDecision
  comments?: LineCommentRequest[]
}

export interface LineCommentRequest {
  path: string
  line: number
  body: string
  side?: 'LEFT' | 'RIGHT'
}

export interface Review {
  id: number
  body: string
  state: ReviewDecision
  user: User
  submittedAt: Date
}

export interface Comment {
  id: number
  body: string
  user: User
  createdAt: Date
}

// ============ 模板相关 ============

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

export interface ReviewTemplate {
  id: string
  name: string
  description?: string
  systemPrompt: string
  categories: ReviewCategory[]
  severities: ReviewSeverity[]
  isSystem: boolean
  isDefault: boolean
}

// ============ 配置相关 ============

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
