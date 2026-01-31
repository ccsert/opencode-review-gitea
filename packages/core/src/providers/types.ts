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
 * Git Provider 接口
 * 所有平台实现都需要遵循此接口
 */
export interface GitProvider {
  /** 平台标识 */
  readonly name: ProviderType
  
  /** 平台 API 基础 URL */
  readonly baseUrl: string

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
