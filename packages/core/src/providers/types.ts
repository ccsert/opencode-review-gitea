/**
 * Git Provider 抽象层
 * 统一不同平台（Gitea/GitHub/GitLab）的 API 接口
 */

import type { 
  Repository, 
  PullRequest, 
  ChangedFile, 
  CreateReviewRequest, 
  Review, 
  Comment,
  LineCommentRequest 
} from '../types'
import type { WebhookEvent } from '../events/types'

export type ProviderType = 'gitea' | 'github' | 'gitlab'

/**
 * 组织信息
 */
export interface Organization {
  id: number
  name: string
  fullName: string
  description?: string
  avatarUrl?: string
  url: string
}

/**
 * 仓库列表查询参数
 */
export interface ListRepositoriesParams {
  page?: number
  perPage?: number
  sort?: 'created' | 'updated' | 'pushed' | 'full_name'
  direction?: 'asc' | 'desc'
}

/**
 * 仓库列表响应
 */
export interface ListRepositoriesResponse {
  repositories: Repository[]
  total?: number
  hasMore: boolean
}

/**
 * Git Provider 接口
 * 所有平台实现都需要遵循此接口
 */
export interface GitProvider {
  /** 平台标识 */
  readonly name: ProviderType
  
  /** 平台 API 基础 URL */
  readonly baseUrl: string

  // ============ 仓库列表（新增）============
  
  /**
   * 获取当前用户可访问的所有仓库列表
   * 包括用户拥有的、组织的、有权限访问的仓库
   */
  listUserRepositories(params?: ListRepositoriesParams): Promise<ListRepositoriesResponse>
  
  /**
   * 获取当前用户所属的组织列表
   */
  listUserOrganizations(): Promise<Organization[]>
  
  /**
   * 获取指定组织的仓库列表
   */
  listOrganizationRepositories(org: string, params?: ListRepositoriesParams): Promise<ListRepositoriesResponse>

  // ============ 仓库信息 ============
  
  /**
   * 获取仓库信息
   */
  getRepository(owner: string, repo: string): Promise<Repository>

  // ============ PR/MR 操作 ============
  
  /**
   * 获取 Pull Request 详情
   */
  getPullRequest(owner: string, repo: string, number: number): Promise<PullRequest>
  
  /**
   * 获取 PR 的代码 Diff
   * @returns 带行号标记的 diff 内容
   */
  getPullRequestDiff(owner: string, repo: string, number: number): Promise<string>
  
  /**
   * 获取 PR 变更的文件列表
   */
  getPullRequestFiles(owner: string, repo: string, number: number): Promise<ChangedFile[]>

  // ============ Review 操作 ============
  
  /**
   * 创建 Review（带审批状态）
   */
  createReview(
    owner: string, 
    repo: string, 
    number: number, 
    review: CreateReviewRequest
  ): Promise<Review>
  
  /**
   * 创建普通评论
   */
  createComment(
    owner: string,
    repo: string,
    number: number,
    body: string
  ): Promise<Comment>
  
  /**
   * 创建行级评论
   */
  createLineComment(
    owner: string,
    repo: string,
    number: number,
    comment: LineCommentRequest
  ): Promise<Comment>

  // ============ Webhook 处理 ============
  
  /**
   * 验证 Webhook 签名
   */
  verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean
  
  /**
   * 解析 Webhook 事件
   */
  parseWebhookEvent(
    payload: unknown,
    headers: Record<string, string>
  ): WebhookEvent | null

  // ============ Webhook 管理（自动注册）============
  
  /**
   * 创建仓库 Webhook
   * @param owner 仓库所有者
   * @param repo 仓库名称
   * @param webhook Webhook 配置
   * @returns 创建的 Webhook 信息
   * @throws ProviderError 如果权限不足或请求失败
   */
  createWebhook(
    owner: string,
    repo: string,
    webhook: CreateWebhookRequest
  ): Promise<Webhook>

  /**
   * 删除仓库 Webhook
   * @param owner 仓库所有者
   * @param repo 仓库名称
   * @param hookId Webhook ID
   */
  deleteWebhook(
    owner: string,
    repo: string,
    hookId: number
  ): Promise<void>

  /**
   * 列出仓库的所有 Webhooks（可选实现）
   */
  listWebhooks?(
    owner: string,
    repo: string
  ): Promise<Webhook[]>
}

// ============ Webhook 管理 ============

/**
 * 创建 Webhook 请求
 */
export interface CreateWebhookRequest {
  /** Webhook 回调 URL */
  url: string
  /** Webhook Secret（用于签名验证） */
  secret?: string
  /** 订阅的事件类型，默认 ['pull_request', 'issue_comment'] */
  events?: string[]
  /** 是否激活，默认 true */
  active?: boolean
  /** 分支过滤（Gitea 特性），默认 '*' */
  branchFilter?: string
}

/**
 * Webhook 信息
 */
export interface Webhook {
  /** Webhook ID（平台分配的） */
  id: number
  /** Webhook 类型 */
  type: string
  /** 是否激活 */
  active: boolean
  /** 回调 URL */
  url: string
  /** 订阅的事件 */
  events: string[]
  /** 创建时间 */
  createdAt: Date
}

/**
 * Provider 配置
 */
export interface ProviderConfig {
  type: ProviderType
  baseUrl: string
  token: string
}

/**
 * Provider 错误
 */
export class ProviderError extends Error {
  constructor(
    message: string, 
    public readonly statusCode?: number,
    public readonly provider?: ProviderType
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
