/**
 * GitLab Provider 实现
 * 支持 GitLab Self-Managed 实例
 */

import { timingSafeEqual } from 'crypto'
import { BaseProvider } from './base'
import type {
  ProviderType,
  ListRepositoriesParams,
  ListRepositoriesResponse,
  Organization,
  CreateWebhookRequest,
  Webhook
} from './types'
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

export class GitLabProvider extends BaseProvider {
  readonly name: ProviderType = 'gitlab'

  /**
   * GitLab 使用 PRIVATE-TOKEN 头进行认证
   */
  protected getAuthHeaders(): Record<string, string> {
    return { 'PRIVATE-TOKEN': this.token }
  }

  /**
   * 获取 URL 编码的项目路径
   * GitLab API 使用 project ID 或 URL-encoded path（如 "owner%2Frepo"）
   */
  private getProjectPath(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`)
  }

  // ============ 仓库列表相关方法 ============

  async listUserRepositories(params: ListRepositoriesParams = {}): Promise<ListRepositoriesResponse> {
    const page = params.page || 1
    const perPage = params.perPage || 50

    // GitLab API: GET /api/v4/projects?membership=true
    const data = await this.fetch<GitLabProject[]>(
      `/api/v4/projects?membership=true&page=${page}&per_page=${perPage}&order_by=updated_at&sort=desc`
    )

    return {
      repositories: data.map(project => this.mapRepository(project)),
      hasMore: data.length === perPage,
    }
  }

  async listUserOrganizations(): Promise<Organization[]> {
    // GitLab API: GET /api/v4/groups
    const data = await this.fetch<GitLabGroup[]>('/api/v4/groups?per_page=100')

    return data.map(group => ({
      id: group.id,
      name: group.name,
      fullName: group.full_name || group.name,
      description: group.description || undefined,
      avatarUrl: group.avatar_url || undefined,
      url: group.web_url,
    }))
  }

  async listOrganizationRepositories(org: string, params: ListRepositoriesParams = {}): Promise<ListRepositoriesResponse> {
    const page = params.page || 1
    const perPage = params.perPage || 50

    // GitLab API: GET /api/v4/groups/{id}/projects
    // org 可能是 group ID 或 URL-encoded path
    const groupPath = encodeURIComponent(org)
    const data = await this.fetch<GitLabProject[]>(
      `/api/v4/groups/${groupPath}/projects?page=${page}&per_page=${perPage}&order_by=updated_at&sort=desc`
    )

    return {
      repositories: data.map(project => this.mapRepository(project)),
      hasMore: data.length === perPage,
    }
  }

  // ============ 仓库信息 ============

  async getRepository(owner: string, repo: string): Promise<Repository> {
    const projectPath = this.getProjectPath(owner, repo)
    const data = await this.fetch<GitLabProject>(
      `/api/v4/projects/${projectPath}`
    )
    return this.mapRepository(data)
  }

  // ============ Merge Request 操作 ============

  async getPullRequest(owner: string, repo: string, number: number): Promise<PullRequest> {
    const projectPath = this.getProjectPath(owner, repo)
    const data = await this.fetch<GitLabMergeRequest>(
      `/api/v4/projects/${projectPath}/merge_requests/${number}`
    )
    return this.mapPullRequest(data)
  }

  async getPullRequestDiff(owner: string, repo: string, number: number): Promise<string> {
    const projectPath = this.getProjectPath(owner, repo)
    const url = `${this.baseUrl}/api/v4/projects/${projectPath}/merge_requests/${number}/diffs`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          ...this.getAuthHeaders(),
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to get MR diff: ${response.status}`)
      }

      // GitLab returns JSON array of diffs, need to assemble into unified diff
      const diffs = await response.json() as GitLabDiff[]
      return this.assembleDiff(diffs)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`gitlab API request timed out after 60000ms: GET merge_requests/${number}/diffs`)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  async getPullRequestFiles(owner: string, repo: string, number: number): Promise<ChangedFile[]> {
    const projectPath = this.getProjectPath(owner, repo)
    const data = await this.fetch<GitLabMergeRequestChanges>(
      `/api/v4/projects/${projectPath}/merge_requests/${number}/changes`
    )
    return (data.changes || []).map(change => this.mapChangedFile(change))
  }

  // ============ Review 操作 ============

  async createReview(
    owner: string,
    repo: string,
    number: number,
    review: CreateReviewRequest
  ): Promise<Review> {
    const projectPath = this.getProjectPath(owner, repo)

    // GitLab 没有原生 Review 对象
    // 策略：先用 Note 发布审查摘要，再根据 decision 调用 approve/unapprove

    // 1. 创建 MR Note 作为审查评论
    const note = await this.fetch<GitLabNote>(
      `/api/v4/projects/${projectPath}/merge_requests/${number}/notes`,
      {
        method: 'POST',
        body: JSON.stringify({ body: review.body }),
      }
    )

    // 2. 提交行级评论（使用 Discussions API）
    if (review.comments && review.comments.length > 0) {
      // 获取 MR 的 diff refs 用于行级评论
      const mr = await this.fetch<GitLabMergeRequest>(
        `/api/v4/projects/${projectPath}/merge_requests/${number}`
      )

      for (const comment of review.comments) {
        try {
          await this.createLineComment(owner, repo, number, comment)
        } catch (error) {
          console.warn(`[GitLab] Failed to create line comment on ${comment.path}:${comment.line}:`, error)
        }
      }
    }

    // 3. 根据 decision 执行 approve/unapprove
    try {
      if (review.decision === 'APPROVED') {
        await this.fetch(
          `/api/v4/projects/${projectPath}/merge_requests/${number}/approve`,
          { method: 'POST' }
        )
      } else if (review.decision === 'REQUEST_CHANGES') {
        // GitLab 没有 "request changes" 概念，可以用 unapprove 撤回批准
        await this.fetch(
          `/api/v4/projects/${projectPath}/merge_requests/${number}/unapprove`,
          { method: 'POST' }
        ).catch(() => {
          // unapprove 可能失败（如从未 approve），忽略
        })
      }
    } catch (error) {
      // approve/unapprove 失败不影响主流程
      console.warn(`[GitLab] Failed to ${review.decision} MR:`, error)
    }

    return {
      id: note.id,
      body: note.body,
      state: review.decision,
      user: this.mapUser(note.author),
      submittedAt: new Date(note.created_at),
    }
  }

  async createComment(
    owner: string,
    repo: string,
    number: number,
    body: string
  ): Promise<Comment> {
    const projectPath = this.getProjectPath(owner, repo)
    const data = await this.fetch<GitLabNote>(
      `/api/v4/projects/${projectPath}/merge_requests/${number}/notes`,
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
    const projectPath = this.getProjectPath(owner, repo)

    // 获取 MR 的 diff refs（base_sha, head_sha, start_sha）
    const mr = await this.fetch<GitLabMergeRequest>(
      `/api/v4/projects/${projectPath}/merge_requests/${number}`
    )

    const diffRefs = mr.diff_refs
    if (!diffRefs) {
      // 如果没有 diff_refs，退回到普通评论
      return this.createComment(owner, repo, number, `**${comment.path}:${comment.line}**\n\n${comment.body}`)
    }

    // 使用 Discussions API 创建行级评论
    const data = await this.fetch<GitLabDiscussion>(
      `/api/v4/projects/${projectPath}/merge_requests/${number}/discussions`,
      {
        method: 'POST',
        body: JSON.stringify({
          body: comment.body,
          position: {
            position_type: 'text',
            base_sha: diffRefs.base_sha,
            head_sha: diffRefs.head_sha,
            start_sha: diffRefs.start_sha,
            new_path: comment.path,
            old_path: comment.path,
            new_line: comment.side !== 'LEFT' ? comment.line : null,
            old_line: comment.side === 'LEFT' ? comment.line : null,
          },
        }),
      }
    )

    // Discussion 返回的第一个 note 即为创建的评论
    const firstNote = data.notes?.[0]
    if (!firstNote) {
      throw new Error('Discussion created but no note returned')
    }

    return this.mapComment(firstNote)
  }

  // ============ Webhook 签名验证 ============

  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    // GitLab 使用 X-Gitlab-Token，直接与 secret 字符串比较（非 HMAC）
    if (!signature || !secret) {
      return false
    }

    try {
      const sigBuffer = Buffer.from(signature, 'utf8')
      const secretBuffer = Buffer.from(secret, 'utf8')

      if (sigBuffer.length !== secretBuffer.length) {
        return false
      }

      return timingSafeEqual(sigBuffer, secretBuffer)
    } catch {
      return false
    }
  }

  // ============ Webhook 管理 ============

  async createWebhook(
    owner: string,
    repo: string,
    webhook: CreateWebhookRequest
  ): Promise<Webhook> {
    const projectPath = this.getProjectPath(owner, repo)

    // GitLab API: POST /api/v4/projects/{id}/hooks
    const data = await this.fetch<GitLabHook>(
      `/api/v4/projects/${projectPath}/hooks`,
      {
        method: 'POST',
        body: JSON.stringify({
          url: webhook.url,
          token: webhook.secret || undefined,
          merge_requests_events: true,
          note_events: true,
          push_events: false,
          enable_ssl_verification: true,
        }),
      }
    )
    return this.mapWebhook(data)
  }

  async deleteWebhook(owner: string, repo: string, hookId: number): Promise<void> {
    const projectPath = this.getProjectPath(owner, repo)
    await this.fetch(
      `/api/v4/projects/${projectPath}/hooks/${hookId}`,
      { method: 'DELETE' }
    )
  }

  async listWebhooks(owner: string, repo: string): Promise<Webhook[]> {
    const projectPath = this.getProjectPath(owner, repo)
    const data = await this.fetch<GitLabHook[]>(
      `/api/v4/projects/${projectPath}/hooks`
    )
    return data.map(hook => this.mapWebhook(hook))
  }

  // ============ Webhook 事件解析 ============

  parseWebhookEvent(
    payload: unknown,
    headers: Record<string, string>
  ): WebhookEvent | null {
    const eventType = headers['x-gitlab-event'] || headers['X-Gitlab-Event']

    if (!eventType) {
      return null
    }

    const data = payload as GitLabWebhookPayload

    // GitLab webhook payload 的 repository 可能在 project 字段中
    const project = data.project || data.repository
    if (!project) {
      return null
    }

    const baseEvent: BaseWebhookEvent = {
      id: headers['x-gitlab-event-uuid'] || headers['X-Gitlab-Event-UUID'] || crypto.randomUUID(),
      timestamp: new Date(),
      provider: 'gitlab',
      repository: {
        fullName: project.path_with_namespace,
        url: project.web_url,
      },
      sender: data.user ? {
        id: data.user.id,
        login: data.user.username,
        avatarUrl: data.user.avatar_url,
      } : { id: 0, login: 'unknown' },
    }

    switch (eventType) {
      case 'Merge Request Hook':
        return this.parseMergeRequestEvent(data, baseEvent)
      case 'Note Hook':
        return this.parseNoteEvent(data, baseEvent)
      default:
        return null
    }
  }

  // ============ 私有辅助方法 ============

  private mapRepository(data: GitLabProject): Repository {
    return {
      id: data.id,
      name: data.path,
      fullName: data.path_with_namespace,
      description: data.description || undefined,
      defaultBranch: data.default_branch || 'main',
      private: data.visibility === 'private',
      url: data.web_url,
    }
  }

  private mapPullRequest(data: GitLabMergeRequest): PullRequest {
    return {
      id: data.id,
      number: data.iid,
      title: data.title,
      body: data.description || undefined,
      state: this.mapMRState(data.state),
      author: this.mapUser(data.author),
      base: {
        ref: data.target_branch,
        sha: data.diff_refs?.base_sha || '',
      },
      head: {
        ref: data.source_branch,
        sha: data.diff_refs?.head_sha || data.sha || '',
      },
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    }
  }

  private mapMRState(state: string): 'open' | 'closed' | 'merged' {
    switch (state) {
      case 'opened': return 'open'
      case 'merged': return 'merged'
      case 'closed': return 'closed'
      case 'locked': return 'closed'
      default: return 'open'
    }
  }

  private mapChangedFile(data: GitLabDiffChange): ChangedFile {
    let status: ChangedFile['status'] = 'modified'
    if (data.new_file) status = 'added'
    else if (data.deleted_file) status = 'deleted'
    else if (data.renamed_file) status = 'renamed'

    // 通过 diff 内容估算 additions/deletions
    const { additions, deletions } = this.countDiffChanges(data.diff || '')

    return {
      filename: data.new_path || data.old_path,
      status,
      additions,
      deletions,
      patch: data.diff,
    }
  }

  private countDiffChanges(diff: string): { additions: number; deletions: number } {
    let additions = 0
    let deletions = 0
    for (const line of diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++
    }
    return { additions, deletions }
  }

  private mapUser(data: GitLabUser | undefined): User {
    if (!data) {
      return { id: 0, login: 'unknown' }
    }
    return {
      id: data.id,
      login: data.username,
      avatarUrl: data.avatar_url,
    }
  }

  private mapComment(data: GitLabNote): Comment {
    return {
      id: data.id,
      body: data.body,
      user: this.mapUser(data.author),
      createdAt: new Date(data.created_at),
    }
  }

  private mapWebhook(data: GitLabHook): Webhook {
    const events: string[] = []
    if (data.merge_requests_events) events.push('merge_requests')
    if (data.note_events) events.push('note')
    if (data.push_events) events.push('push')

    return {
      id: data.id,
      type: 'gitlab',
      active: data.merge_requests_events || data.note_events,
      url: data.url,
      events,
      createdAt: new Date(data.created_at),
    }
  }

  /**
   * 将 GitLab diff 数组拼装为 unified diff 文本
   */
  private assembleDiff(diffs: GitLabDiff[]): string {
    return diffs.map(diff => {
      const header = `diff --git a/${diff.old_path} b/${diff.new_path}\n`
      const fromFile = `--- a/${diff.old_path}\n`
      const toFile = `+++ b/${diff.new_path}\n`
      return header + fromFile + toFile + (diff.diff || '')
    }).join('\n')
  }

  private parseMergeRequestEvent(
    data: GitLabWebhookPayload,
    baseEvent: BaseWebhookEvent
  ): WebhookEvent | null {
    const attrs = data.object_attributes
    if (!attrs) return null

    const pr = this.mapWebhookMergeRequest(attrs, data)

    switch (attrs.action) {
      case 'open':
        return { ...baseEvent, type: 'pull_request.opened', pullRequest: pr }
      case 'update':
        // 判断是否有新 commit（通过 oldrev 字段）
        if (data.object_attributes?.oldrev) {
          return {
            ...baseEvent,
            type: 'pull_request.updated',
            pullRequest: pr,
            before: data.object_attributes.oldrev,
          }
        }
        // 非 commit 更新（如标题修改），不触发审查
        return null
      case 'close':
        return {
          ...baseEvent,
          type: 'pull_request.closed',
          pullRequest: pr,
          merged: false,
        }
      case 'merge':
        return {
          ...baseEvent,
          type: 'pull_request.closed',
          pullRequest: pr,
          merged: true,
        }
      default:
        return null
    }
  }

  private parseNoteEvent(
    data: GitLabWebhookPayload,
    baseEvent: BaseWebhookEvent
  ): WebhookEvent | null {
    const attrs = data.object_attributes
    if (!attrs) return null

    // 只处理 MR 上的 note
    if (attrs.noteable_type !== 'MergeRequest' || !data.merge_request) {
      return null
    }

    const body = attrs.note || ''
    const triggers = this.extractTriggers(body)

    const pr = this.mapWebhookMergeRequest(data.merge_request, data)

    return {
      ...baseEvent,
      type: 'pull_request.comment',
      pullRequest: pr,
      comment: {
        id: attrs.id || 0,
        body,
        user: data.user ? {
          id: data.user.id,
          login: data.user.username,
          avatarUrl: data.user.avatar_url,
        } : { id: 0, login: 'unknown' },
        createdAt: new Date(attrs.created_at || Date.now()),
      },
      triggers,
    }
  }

  /**
   * 从 webhook payload 中的 MR 数据映射为标准 PullRequest
   */
  private mapWebhookMergeRequest(
    attrs: GitLabWebhookMRAttributes,
    data: GitLabWebhookPayload
  ): PullRequest {
    return {
      id: attrs.id || 0,
      number: attrs.iid || 0,
      title: attrs.title || '',
      body: attrs.description || undefined,
      state: this.mapMRState(attrs.state || 'opened'),
      author: data.user ? {
        id: data.user.id,
        login: data.user.username,
        avatarUrl: data.user.avatar_url,
      } : { id: 0, login: 'unknown' },
      base: {
        ref: attrs.target_branch || 'main',
        sha: attrs.last_commit?.id || '',
      },
      head: {
        ref: attrs.source_branch || '',
        sha: attrs.last_commit?.id || '',
      },
      createdAt: new Date(attrs.created_at || Date.now()),
      updatedAt: new Date(attrs.updated_at || Date.now()),
    }
  }

  private extractTriggers(body: string): string[] {
    const triggers: string[] = []
    if (/\/oc\b/i.test(body)) triggers.push('/oc')
    if (/\/opencode\b/i.test(body)) triggers.push('/opencode')
    return triggers
  }
}

// ============ GitLab API 类型定义 ============

interface GitLabProject {
  id: number
  name: string
  path: string
  path_with_namespace: string
  description: string | null
  default_branch: string
  visibility: 'public' | 'internal' | 'private'
  web_url: string
  http_url_to_repo: string
  ssh_url_to_repo: string
  created_at: string
  last_activity_at: string
  forks_count: number
  star_count: number
}

interface GitLabGroup {
  id: number
  name: string
  full_name: string
  path: string
  full_path: string
  description: string | null
  avatar_url: string | null
  web_url: string
}

interface GitLabUser {
  id: number
  username: string
  name: string
  state: string
  avatar_url: string
  web_url: string
}

interface GitLabMergeRequest {
  id: number
  iid: number
  project_id: number
  title: string
  description: string | null
  state: string
  author: GitLabUser
  source_branch: string
  target_branch: string
  source_project_id: number
  target_project_id: number
  sha: string
  created_at: string
  updated_at: string
  merged_at: string | null
  closed_at: string | null
  web_url: string
  diff_refs?: {
    base_sha: string
    head_sha: string
    start_sha: string
  }
}

interface GitLabDiff {
  old_path: string
  new_path: string
  a_mode: string
  b_mode: string
  diff: string
  new_file: boolean
  renamed_file: boolean
  deleted_file: boolean
}

interface GitLabDiffChange extends GitLabDiff {
  // MR changes endpoint returns the same structure
}

interface GitLabMergeRequestChanges extends GitLabMergeRequest {
  changes: GitLabDiffChange[]
}

interface GitLabNote {
  id: number
  body: string
  author: GitLabUser
  created_at: string
  updated_at: string
  system: boolean
  noteable_type: string
  noteable_id: number
  resolvable: boolean
}

interface GitLabDiscussion {
  id: string
  individual_note: boolean
  notes: GitLabNote[]
}

interface GitLabHook {
  id: number
  url: string
  created_at: string
  push_events: boolean
  merge_requests_events: boolean
  note_events: boolean
  enable_ssl_verification: boolean
}

// ============ GitLab Webhook Payload 类型 ============

interface GitLabWebhookMRAttributes {
  id?: number
  iid?: number
  title?: string
  description?: string
  state?: string
  action?: string
  source_branch?: string
  target_branch?: string
  created_at?: string
  updated_at?: string
  oldrev?: string
  last_commit?: {
    id: string
    message: string
    title: string
    timestamp: string
    url: string
    author: { name: string; email: string }
  }
  // Note-specific fields
  note?: string
  noteable_type?: string
}

interface GitLabWebhookPayload {
  object_kind?: string
  event_type?: string
  user?: GitLabUser
  project?: {
    id: number
    name: string
    path_with_namespace: string
    web_url: string
  }
  repository?: {
    id: number
    name: string
    path_with_namespace: string
    web_url: string
  }
  object_attributes?: GitLabWebhookMRAttributes
  merge_request?: GitLabWebhookMRAttributes
}
