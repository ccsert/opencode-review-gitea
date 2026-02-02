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
