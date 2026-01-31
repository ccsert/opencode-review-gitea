/**
 * Gitea Provider 实现
 */

import { BaseProvider } from './base'
import type { ProviderType } from './types'
import type { 
  Repository, 
  PullRequest, 
  ChangedFile, 
  CreateReviewRequest, 
  Review, 
  Comment,
  LineCommentRequest,
  User
} from '../types'
import type { WebhookEvent, BaseWebhookEvent } from '../events/types'

export class GiteaProvider extends BaseProvider {
  readonly name: ProviderType = 'gitea'

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
        'Authorization': this.getAuthHeader(),
      },
    })
    
    if (!response.ok) {
      throw new Error(`Failed to get PR diff: ${response.status}`)
    }
    
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
    if (!signature.startsWith('sha256=')) {
      return false
    }
    const hash = signature.slice(7)
    return this.verifyHmacSha256(payload, hash, secret)
  }

  parseWebhookEvent(
    payload: unknown,
    headers: Record<string, string>
  ): WebhookEvent | null {
    const eventType = headers['x-gitea-event'] || headers['X-Gitea-Event']
    const deliveryId = headers['x-gitea-delivery'] || headers['X-Gitea-Delivery']
    
    if (!eventType) {
      return null
    }

    const data = payload as GiteaWebhookPayload

    const baseEvent: BaseWebhookEvent = {
      id: deliveryId || crypto.randomUUID(),
      timestamp: new Date(),
      provider: 'gitea',
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
    baseEvent: BaseWebhookEvent
  ): WebhookEvent | null {
    if (!data.pull_request) {
      return null
    }

    const pr = this.mapPullRequest(data.pull_request)
    
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
          merged: data.pull_request.merged || false,
        }
      default:
        return null
    }
  }

  private parseCommentEvent(
    data: GiteaWebhookPayload,
    baseEvent: BaseWebhookEvent
  ): WebhookEvent | null {
    if (data.action !== 'created' || !data.comment || !data.issue) {
      return null
    }

    const body = data.comment.body || ''
    const triggers = this.extractTriggers(body)

    // 构造一个简化的 PullRequest 对象
    const pr: PullRequest = {
      id: data.issue.id,
      number: data.issue.number,
      title: data.issue.title || '',
      body: data.issue.body,
      state: 'open',
      author: {
        id: data.issue.user?.id || 0,
        login: data.issue.user?.login || '',
        avatarUrl: data.issue.user?.avatar_url,
      },
      base: { ref: '', sha: '' },
      head: { ref: '', sha: '' },
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    return {
      ...baseEvent,
      type: 'pull_request.comment',
      pullRequest: pr,
      comment: {
        id: data.comment.id,
        body: data.comment.body,
        user: {
          id: data.comment.user.id,
          login: data.comment.user.login,
          avatarUrl: data.comment.user.avatar_url,
        },
        createdAt: new Date(data.comment.created_at),
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

// ============ Gitea API 类型定义 ============

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
  issue?: {
    id: number
    number: number
    title?: string
    body?: string
    user?: GiteaUser
    pull_request?: object
  }
  comment?: GiteaComment
  before?: string
}
