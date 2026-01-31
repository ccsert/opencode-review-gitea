# Provider 抽象层设计

> 多平台支持的核心抽象，定义统一接口适配 Gitea/GitHub/GitLab。

## 设计目标

1. **统一接口** - 不同平台使用相同的 API 调用方式
2. **可扩展** - 新平台只需实现接口即可接入
3. **类型安全** - 完整的 TypeScript 类型支持
4. **事件标准化** - 不同平台的 Webhook 事件统一为标准格式

## 核心接口

### GitProvider

```typescript
// packages/core/src/providers/types.ts

/**
 * Git 平台 Provider 接口
 * 所有平台实现都需要遵循此接口
 */
export interface GitProvider {
  /** 平台标识 */
  readonly name: 'gitea' | 'github' | 'gitlab'
  
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
```

### 数据类型定义

```typescript
// packages/core/src/providers/types.ts

export interface Repository {
  id: number
  name: string
  fullName: string  // owner/repo
  description?: string
  defaultBranch: string
  private: boolean
  url: string
}

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

export interface User {
  id: number
  login: string
  avatarUrl?: string
}

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
```

### Webhook 事件类型

```typescript
// packages/core/src/events/types.ts

/**
 * 标准化 Webhook 事件
 * 不同平台的事件格式统一为此格式
 */
export type WebhookEvent =
  | PullRequestOpenedEvent
  | PullRequestUpdatedEvent
  | PullRequestClosedEvent
  | PullRequestCommentEvent

export interface BaseWebhookEvent {
  /** 事件 ID（幂等性检查） */
  id: string
  /** 事件时间 */
  timestamp: Date
  /** 来源平台 */
  provider: 'gitea' | 'github' | 'gitlab'
  /** 仓库信息 */
  repository: {
    fullName: string  // owner/repo
    url: string
  }
  /** 发送者 */
  sender: User
}

export interface PullRequestOpenedEvent extends BaseWebhookEvent {
  type: 'pull_request.opened'
  pullRequest: PullRequest
}

export interface PullRequestUpdatedEvent extends BaseWebhookEvent {
  type: 'pull_request.updated'
  pullRequest: PullRequest
  /** 更新前的 commit SHA */
  before?: string
}

export interface PullRequestClosedEvent extends BaseWebhookEvent {
  type: 'pull_request.closed'
  pullRequest: PullRequest
  merged: boolean
}

export interface PullRequestCommentEvent extends BaseWebhookEvent {
  type: 'pull_request.comment'
  pullRequest: PullRequest
  comment: Comment
  /** 检测到的触发命令 */
  triggers: string[]  // ['/oc', '/opencode']
}

/**
 * 判断事件是否应该触发 Review
 */
export function shouldTriggerReview(event: WebhookEvent): boolean {
  switch (event.type) {
    case 'pull_request.opened':
      return true
    case 'pull_request.updated':
      return true
    case 'pull_request.comment':
      return event.triggers.length > 0
    default:
      return false
  }
}
```

## Provider 实现

### 抽象基类

```typescript
// packages/core/src/providers/base.ts

export abstract class BaseProvider implements GitProvider {
  abstract readonly name: 'gitea' | 'github' | 'gitlab'
  
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
        'Authorization': `token ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      throw new ProviderError(
        `${this.name} API error: ${response.status} ${response.statusText}`,
        response.status
      )
    }

    return response.json()
  }

  /**
   * HMAC-SHA256 签名验证（通用）
   */
  protected verifyHmacSha256(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    const hmac = crypto.createHmac('sha256', secret)
    const digest = hmac.update(payload).digest('hex')
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(digest)
    )
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

export class ProviderError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message)
    this.name = 'ProviderError'
  }
}
```

### Gitea Provider 实现

```typescript
// packages/core/src/providers/gitea.ts

import { BaseProvider } from './base'
import type { 
  Repository, PullRequest, ChangedFile, 
  CreateReviewRequest, Review, Comment, LineCommentRequest,
  WebhookEvent 
} from './types'

export class GiteaProvider extends BaseProvider {
  readonly name = 'gitea' as const

  async getRepository(owner: string, repo: string): Promise<Repository> {
    const data = await this.fetch<GiteaRepository>(
      `/api/v1/repos/${owner}/${repo}`
    )
    return this.mapRepository(data)
  }

  async getPullRequest(owner: string, repo: string, number: number): Promise<PullRequest> {
    const data = await this.fetch<GiteaPullRequest>(
      `/api/v1/repos/${owner}/${repo}/pulls/${number}`
    )
    return this.mapPullRequest(data)
  }

  async getPullRequestDiff(owner: string, repo: string, number: number): Promise<string> {
    const url = `${this.baseUrl}/api/v1/repos/${owner}/${repo}/pulls/${number}.diff`
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${this.token}`,
      },
    })
    return response.text()
  }

  async getPullRequestFiles(owner: string, repo: string, number: number): Promise<ChangedFile[]> {
    const data = await this.fetch<GiteaChangedFile[]>(
      `/api/v1/repos/${owner}/${repo}/pulls/${number}/files`
    )
    return data.map(this.mapChangedFile)
  }

  async createReview(
    owner: string, 
    repo: string, 
    number: number, 
    review: CreateReviewRequest
  ): Promise<Review> {
    // Gitea 的 Review 需要分步：先提交 review comments，再提交 review
    if (review.comments?.length) {
      for (const comment of review.comments) {
        await this.createLineComment(owner, repo, number, comment)
      }
    }

    const data = await this.fetch<GiteaReview>(
      `/api/v1/repos/${owner}/${repo}/pulls/${number}/reviews`,
      {
        method: 'POST',
        body: JSON.stringify({
          body: review.body,
          event: this.mapDecisionToEvent(review.decision),
        }),
      }
    )
    return this.mapReview(data)
  }

  async createComment(
    owner: string,
    repo: string,
    number: number,
    body: string
  ): Promise<Comment> {
    const data = await this.fetch<GiteaComment>(
      `/api/v1/repos/${owner}/${repo}/issues/${number}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({ body }),
      }
    )
    return this.mapComment(data)
  }

  async createLineComment(
    owner: string,
    repo: string,
    number: number,
    comment: LineCommentRequest
  ): Promise<Comment> {
    const data = await this.fetch<GiteaComment>(
      `/api/v1/repos/${owner}/${repo}/pulls/${number}/reviews`,
      {
        method: 'POST',
        body: JSON.stringify({
          body: comment.body,
          path: comment.path,
          new_position: comment.line,
        }),
      }
    )
    return this.mapComment(data)
  }

  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    // Gitea 签名格式: sha256=xxx
    const [algo, hash] = signature.split('=')
    if (algo !== 'sha256') return false
    return this.verifyHmacSha256(payload, hash, secret)
  }

  parseWebhookEvent(
    payload: unknown,
    headers: Record<string, string>
  ): WebhookEvent | null {
    const eventType = headers['x-gitea-event']
    const deliveryId = headers['x-gitea-delivery']
    
    const data = payload as GiteaWebhookPayload

    const baseEvent = {
      id: deliveryId,
      timestamp: new Date(),
      provider: 'gitea' as const,
      repository: {
        fullName: data.repository.full_name,
        url: data.repository.html_url,
      },
      sender: {
        id: data.sender.id,
        login: data.sender.login,
        avatarUrl: data.sender.avatar_url,
      },
    }

    switch (eventType) {
      case 'pull_request':
        return this.parsePullRequestEvent(data, baseEvent)
      case 'issue_comment':
        if (data.issue?.pull_request) {
          return this.parseCommentEvent(data, baseEvent)
        }
        return null
      default:
        return null
    }
  }

  // ============ 私有辅助方法 ============

  private mapDecisionToEvent(decision: string): string {
    switch (decision) {
      case 'APPROVED': return 'APPROVE'
      case 'REQUEST_CHANGES': return 'REQUEST_CHANGES'
      default: return 'COMMENT'
    }
  }

  private mapRepository(data: GiteaRepository): Repository {
    return {
      id: data.id,
      name: data.name,
      fullName: data.full_name,
      description: data.description,
      defaultBranch: data.default_branch,
      private: data.private,
      url: data.html_url,
    }
  }

  private mapPullRequest(data: GiteaPullRequest): PullRequest {
    return {
      id: data.id,
      number: data.number,
      title: data.title,
      body: data.body,
      state: data.state as 'open' | 'closed' | 'merged',
      author: {
        id: data.user.id,
        login: data.user.login,
        avatarUrl: data.user.avatar_url,
      },
      base: {
        ref: data.base.ref,
        sha: data.base.sha,
      },
      head: {
        ref: data.head.ref,
        sha: data.head.sha,
      },
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    }
  }

  private mapChangedFile(data: GiteaChangedFile): ChangedFile {
    return {
      filename: data.filename,
      status: data.status as 'added' | 'modified' | 'deleted' | 'renamed',
      additions: data.additions,
      deletions: data.deletions,
      patch: data.patch,
    }
  }

  private mapReview(data: GiteaReview): Review {
    return {
      id: data.id,
      body: data.body,
      state: data.state as 'APPROVED' | 'REQUEST_CHANGES' | 'COMMENT',
      user: {
        id: data.user.id,
        login: data.user.login,
        avatarUrl: data.user.avatar_url,
      },
      submittedAt: new Date(data.submitted_at),
    }
  }

  private mapComment(data: GiteaComment): Comment {
    return {
      id: data.id,
      body: data.body,
      user: {
        id: data.user.id,
        login: data.user.login,
        avatarUrl: data.user.avatar_url,
      },
      createdAt: new Date(data.created_at),
    }
  }

  private parsePullRequestEvent(
    data: GiteaWebhookPayload,
    baseEvent: any
  ): WebhookEvent | null {
    const pr = this.mapPullRequest(data.pull_request!)
    
    switch (data.action) {
      case 'opened':
        return { ...baseEvent, type: 'pull_request.opened', pullRequest: pr }
      case 'synchronized':
        return { 
          ...baseEvent, 
          type: 'pull_request.updated', 
          pullRequest: pr,
          before: data.before,
        }
      case 'closed':
        return { 
          ...baseEvent, 
          type: 'pull_request.closed', 
          pullRequest: pr,
          merged: data.pull_request!.merged || false,
        }
      default:
        return null
    }
  }

  private parseCommentEvent(
    data: GiteaWebhookPayload,
    baseEvent: any
  ): WebhookEvent | null {
    if (data.action !== 'created') return null

    const body = data.comment?.body || ''
    const triggers = this.extractTriggers(body)

    return {
      ...baseEvent,
      type: 'pull_request.comment',
      pullRequest: {
        ...this.mapPullRequest({
          ...data.issue!,
          base: { ref: '', sha: '' },
          head: { ref: '', sha: '' },
        } as any),
        number: data.issue!.number,
      },
      comment: {
        id: data.comment!.id,
        body: data.comment!.body,
        user: {
          id: data.comment!.user.id,
          login: data.comment!.user.login,
          avatarUrl: data.comment!.user.avatar_url,
        },
        createdAt: new Date(data.comment!.created_at),
      },
      triggers,
    }
  }

  private extractTriggers(body: string): string[] {
    const triggers: string[] = []
    if (/\/oc\b/i.test(body)) triggers.push('/oc')
    if (/\/opencode\b/i.test(body)) triggers.push('/opencode')
    return triggers
  }
}

// Gitea API 类型（简化版）
interface GiteaRepository {
  id: number
  name: string
  full_name: string
  description?: string
  default_branch: string
  private: boolean
  html_url: string
}

interface GiteaPullRequest {
  id: number
  number: number
  title: string
  body?: string
  state: string
  user: GiteaUser
  base: { ref: string; sha: string }
  head: { ref: string; sha: string }
  created_at: string
  updated_at: string
  merged?: boolean
}

interface GiteaUser {
  id: number
  login: string
  avatar_url?: string
}

interface GiteaChangedFile {
  filename: string
  status: string
  additions: number
  deletions: number
  patch?: string
}

interface GiteaReview {
  id: number
  body: string
  state: string
  user: GiteaUser
  submitted_at: string
}

interface GiteaComment {
  id: number
  body: string
  user: GiteaUser
  created_at: string
}

interface GiteaWebhookPayload {
  action: string
  repository: GiteaRepository
  sender: GiteaUser
  pull_request?: GiteaPullRequest
  issue?: { number: number; pull_request?: object } & GiteaPullRequest
  comment?: GiteaComment
  before?: string
}
```

### Provider 工厂

```typescript
// packages/core/src/providers/index.ts

import { GiteaProvider } from './gitea'
import type { GitProvider } from './types'

export type ProviderType = 'gitea' | 'github' | 'gitlab'

export interface ProviderConfig {
  type: ProviderType
  baseUrl: string
  token: string
}

/**
 * 创建 Provider 实例
 */
export function createProvider(config: ProviderConfig): GitProvider {
  switch (config.type) {
    case 'gitea':
      return new GiteaProvider(config.baseUrl, config.token)
    case 'github':
      throw new Error('GitHub provider not implemented yet')
    case 'gitlab':
      throw new Error('GitLab provider not implemented yet')
    default:
      throw new Error(`Unknown provider type: ${config.type}`)
  }
}

/**
 * 从环境变量自动检测 Provider
 */
export function createProviderFromEnv(env: NodeJS.ProcessEnv): GitProvider | null {
  // 尝试 Gitea
  if (env.GITEA_SERVER_URL && env.GITEA_TOKEN) {
    return new GiteaProvider(env.GITEA_SERVER_URL, env.GITEA_TOKEN)
  }

  // 尝试 GitHub（兼容 Gitea Actions 的变量名）
  if (env.GITHUB_SERVER_URL && env.GITHUB_TOKEN && !env.GITEA_SERVER_URL) {
    // 判断是否真的是 GitHub
    if (env.GITHUB_SERVER_URL.includes('github.com')) {
      throw new Error('GitHub provider not implemented yet')
    }
    // 可能是 Gitea 使用 GitHub 变量名
    return new GiteaProvider(env.GITHUB_SERVER_URL, env.GITHUB_TOKEN)
  }

  return null
}

export * from './types'
export { GiteaProvider } from './gitea'
export { BaseProvider, ProviderError } from './base'
```

## 平台差异对照表

| 功能 | Gitea | GitHub | GitLab |
|------|-------|--------|--------|
| **API 版本** | `/api/v1` | REST API v3 / GraphQL v4 | `/api/v4` |
| **认证 Header** | `token {token}` | `token {token}` / `Bearer {token}` | `PRIVATE-TOKEN: {token}` |
| **Diff 获取** | `GET .../pulls/{id}.diff` | `GET .../pulls/{id}` + Accept | `GET .../merge_requests/{id}/diffs` |
| **行级评论定位** | `new_position` (新文件行号) | `position` (diff 位置) | `new_line` + `line_type` |
| **Review 事件** | `APPROVE` / `REQUEST_CHANGES` | 同 Gitea | `approve` / `unapprove` |
| **Webhook 签名** | `X-Gitea-Signature: sha256=` | `X-Hub-Signature-256: sha256=` | `X-Gitlab-Token: secret` |
| **事件类型 Header** | `X-Gitea-Event` | `X-GitHub-Event` | `X-Gitlab-Event` |

## 扩展指南

添加新平台支持只需：

1. 创建新的 Provider 类继承 `BaseProvider`
2. 实现所有抽象方法
3. 在工厂函数中注册

```typescript
// 示例：添加 GitHub 支持
export class GitHubProvider extends BaseProvider {
  readonly name = 'github' as const
  
  // 实现各个方法...
}

// 在 createProvider 中添加
case 'github':
  return new GitHubProvider(config.baseUrl, config.token)
```
