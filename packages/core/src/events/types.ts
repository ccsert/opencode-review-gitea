/**
 * Webhook 事件类型定义
 */

import type { PullRequest, Comment, User } from '../types'
import type { ProviderType } from '../providers/types'

/**
 * 标准化 Webhook 事件
 * 不同平台的事件格式统一为此格式
 */
export type WebhookEvent =
  | PullRequestOpenedEvent
  | PullRequestUpdatedEvent
  | PullRequestClosedEvent
  | PullRequestCommentEvent

export type WebhookEventType = WebhookEvent['type']

/**
 * 基础事件属性
 */
export interface BaseWebhookEvent {
  /** 事件 ID（用于幂等性检查） */
  id: string
  /** 事件时间 */
  timestamp: Date
  /** 来源平台 */
  provider: ProviderType
  /** 仓库信息 */
  repository: {
    fullName: string  // owner/repo
    url: string
  }
  /** 发送者 */
  sender: User
}

/**
 * PR 创建事件
 */
export interface PullRequestOpenedEvent extends BaseWebhookEvent {
  type: 'pull_request.opened'
  pullRequest: PullRequest
}

/**
 * PR 更新事件（新的 commit 推送）
 */
export interface PullRequestUpdatedEvent extends BaseWebhookEvent {
  type: 'pull_request.updated'
  pullRequest: PullRequest
  /** 更新前的 commit SHA */
  before?: string
}

/**
 * PR 关闭事件
 */
export interface PullRequestClosedEvent extends BaseWebhookEvent {
  type: 'pull_request.closed'
  pullRequest: PullRequest
  /** 是否已合并 */
  merged: boolean
}

/**
 * PR 评论事件
 */
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
    case 'pull_request.closed':
      return false
    default:
      return false
  }
}

/**
 * 获取事件的 PR 编号
 */
export function getPullRequestNumber(event: WebhookEvent): number {
  return event.pullRequest.number
}

/**
 * 获取事件描述
 */
export function getEventDescription(event: WebhookEvent): string {
  const repo = event.repository.fullName
  const pr = event.pullRequest.number

  switch (event.type) {
    case 'pull_request.opened':
      return `PR #${pr} opened in ${repo}`
    case 'pull_request.updated':
      return `PR #${pr} updated in ${repo}`
    case 'pull_request.closed':
      return `PR #${pr} ${event.merged ? 'merged' : 'closed'} in ${repo}`
    case 'pull_request.comment':
      return `Comment on PR #${pr} in ${repo} (triggers: ${event.triggers.join(', ')})`
    default:
      return `Unknown event in ${repo}`
  }
}
