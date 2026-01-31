/**
 * Provider 抽象基类
 */

import { createHmac, timingSafeEqual } from 'crypto'
import type { GitProvider, ProviderType, ProviderError } from './types'
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

export abstract class BaseProvider implements GitProvider {
  abstract readonly name: ProviderType
  
  constructor(
    readonly baseUrl: string,
    protected readonly token: string
  ) {}

  /**
   * 通用 HTTP 请求方法
   */
  protected async fetch<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': this.getAuthHeader(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '')
      throw new Error(
        `${this.name} API error: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`
      )
    }

    return response.json()
  }

  /**
   * 获取认证 Header
   * 子类可覆盖以支持不同的认证方式
   */
  protected getAuthHeader(): string {
    return `token ${this.token}`
  }

  /**
   * HMAC-SHA256 签名验证（通用）
   */
  protected verifyHmacSha256(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    try {
      const hmac = createHmac('sha256', secret)
      const digest = hmac.update(payload).digest('hex')
      
      const sigBuffer = Buffer.from(signature, 'utf8')
      const digestBuffer = Buffer.from(digest, 'utf8')
      
      if (sigBuffer.length !== digestBuffer.length) {
        return false
      }
      
      return timingSafeEqual(sigBuffer, digestBuffer)
    } catch {
      return false
    }
  }

  /**
   * 解析 owner/repo 格式
   */
  protected parseRepoFullName(fullName: string): { owner: string; repo: string } {
    const [owner, repo] = fullName.split('/')
    if (!owner || !repo) {
      throw new Error(`Invalid repository name: ${fullName}`)
    }
    return { owner, repo }
  }

  // 抽象方法由子类实现
  abstract getRepository(owner: string, repo: string): Promise<Repository>
  abstract getPullRequest(owner: string, repo: string, number: number): Promise<PullRequest>
  abstract getPullRequestDiff(owner: string, repo: string, number: number): Promise<string>
  abstract getPullRequestFiles(owner: string, repo: string, number: number): Promise<ChangedFile[]>
  abstract createReview(owner: string, repo: string, number: number, review: CreateReviewRequest): Promise<Review>
  abstract createComment(owner: string, repo: string, number: number, body: string): Promise<Comment>
  abstract createLineComment(owner: string, repo: string, number: number, comment: LineCommentRequest): Promise<Comment>
  abstract verifyWebhookSignature(payload: string, signature: string, secret: string): boolean
  abstract parseWebhookEvent(payload: unknown, headers: Record<string, string>): WebhookEvent | null
}
