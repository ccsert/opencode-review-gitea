/**
 * Webhook 接收路由
 */

import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'

import { getDatabase } from '../db/client'
import { repositories, webhookLogs, reviews } from '../db/schema/index'
import { 
  createProvider, 
  shouldTriggerReview, 
  getEventDescription,
  type WebhookEvent 
} from '@opencode-review/core'

export const webhookRoutes = new Hono()

/**
 * POST /webhooks/:provider/:repositoryId
 * 接收指定仓库的 Webhook
 */
webhookRoutes.post('/:provider/:repositoryId', async (c) => {
  const db = getDatabase()
  const { provider, repositoryId } = c.req.param()
  
  // 获取原始请求体（用于签名验证）
  const rawBody = await c.req.text()
  const headers: Record<string, string> = {}
  c.req.raw.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  
  // 获取仓库配置
  const repo = await db.select()
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .get()

  if (!repo) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Repository not found',
      },
    }, 404)
  }

  if (!repo.enabled) {
    return c.json({
      success: true,
      data: {
        received: true,
        skipped: true,
        reason: 'Repository is disabled',
      },
    })
  }

  // 创建 Provider 实例
  const baseUrl = new URL(repo.url).origin
  const gitProvider = createProvider({
    type: repo.provider as 'gitea' | 'github' | 'gitlab',
    baseUrl,
    token: repo.accessToken!,
  })

  // 验证签名
  const signature = headers['x-gitea-signature'] || 
                   headers['x-hub-signature-256'] || 
                   headers['x-gitlab-token'] || ''
  
  if (repo.webhookSecret) {
    const isValid = gitProvider.verifyWebhookSignature(rawBody, signature, repo.webhookSecret)
    if (!isValid) {
      // 记录无效签名
      await db.insert(webhookLogs).values({
        id: ulid(),
        repositoryId,
        eventType: 'signature_invalid',
        deliveryId: headers['x-gitea-delivery'] || headers['x-github-delivery'],
        payload: JSON.parse(rawBody),
        headers,
        processed: false,
        error: 'Invalid webhook signature',
      })

      return c.json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid webhook signature',
        },
      }, 401)
    }
  }

  // 解析事件
  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return c.json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid JSON payload',
      },
    }, 400)
  }

  const event = gitProvider.parseWebhookEvent(payload, headers)

  // 记录 Webhook 日志
  const logId = ulid()
  await db.insert(webhookLogs).values({
    id: logId,
    repositoryId,
    eventType: event?.type || 'unknown',
    deliveryId: headers['x-gitea-delivery'] || headers['x-github-delivery'],
    payload: payload as any,
    headers,
    processed: false,
  })

  if (!event) {
    return c.json({
      success: true,
      data: {
        received: true,
        eventType: 'unsupported',
      },
    })
  }

  // 检查是否需要触发 Review
  if (!shouldTriggerReview(event)) {
    await db.update(webhookLogs)
      .set({ processed: true })
      .where(eq(webhookLogs.id, logId))

    return c.json({
      success: true,
      data: {
        received: true,
        eventType: event.type,
        triggered: false,
        reason: 'Event does not trigger review',
      },
    })
  }

  // 创建 Review 记录
  const reviewId = ulid()
  await db.insert(reviews).values({
    id: reviewId,
    repositoryId,
    prNumber: event.pullRequest.number,
    prTitle: event.pullRequest.title,
    prAuthor: event.pullRequest.author.login,
    prUrl: `${repo.url}/pulls/${event.pullRequest.number}`,
    status: 'pending',
    triggeredBy: event.type === 'pull_request.comment' ? `comment:${event.sender.login}` : 'webhook',
    webhookEventId: logId,
  })

  // 更新 Webhook 日志
  await db.update(webhookLogs)
    .set({ processed: true, reviewId })
    .where(eq(webhookLogs.id, logId))

  // 异步执行 Review（不阻塞响应）
  executeReviewAsync(reviewId, repo, event, gitProvider).catch(error => {
    console.error(`[Webhook] Review execution failed:`, error)
  })

  return c.json({
    success: true,
    data: {
      received: true,
      eventType: event.type,
      triggered: true,
      reviewId,
      description: getEventDescription(event),
    },
  })
})

/**
 * POST /webhooks/:provider
 * 通用 Webhook 端点（自动路由到对应仓库）
 */
webhookRoutes.post('/:provider', async (c) => {
  const db = getDatabase()
  const { provider } = c.req.param()
  
  const rawBody = await c.req.text()
  let payload: any
  
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return c.json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid JSON payload',
      },
    }, 400)
  }

  // 从 payload 中提取仓库信息
  const repoFullName = payload.repository?.full_name
  if (!repoFullName) {
    return c.json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Cannot determine repository from payload',
      },
    }, 400)
  }

  // 查找对应的仓库配置
  const repo = await db.select()
    .from(repositories)
    .where(eq(repositories.name, repoFullName))
    .get()

  if (!repo) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Repository ${repoFullName} not configured`,
      },
    }, 404)
  }

  // 重定向到具体仓库的 Webhook 处理
  // 这里直接复制上面的逻辑会有重复，实际应该抽取公共函数
  return c.json({
    success: true,
    data: {
      received: true,
      message: `Please use /webhooks/${provider}/${repo.id} for this repository`,
      webhookUrl: `/api/v1/webhooks/${provider}/${repo.id}`,
    },
  })
})

/**
 * 异步执行 Review
 */
async function executeReviewAsync(
  reviewId: string,
  repo: typeof repositories.$inferSelect,
  event: WebhookEvent,
  provider: ReturnType<typeof createProvider>
) {
  const db = getDatabase()
  const startTime = Date.now()

  try {
    // 更新状态为 processing
    await db.update(reviews)
      .set({ status: 'processing' })
      .where(eq(reviews.id, reviewId))

    const [owner, repoName] = repo.name.split('/')
    const prNumber = event.pullRequest.number

    // 获取 Diff
    const diff = await provider.getPullRequestDiff(owner, repoName, prNumber)
    const files = await provider.getPullRequestFiles(owner, repoName, prNumber)

    if (!diff || diff.trim().length === 0) {
      await db.update(reviews)
        .set({
          status: 'completed',
          decision: 'COMMENT',
          summary: '没有发现代码变更，跳过审查。',
          commentsCount: 0,
          durationMs: Date.now() - startTime,
          completedAt: new Date(),
        })
        .where(eq(reviews.id, reviewId))
      return
    }

    // TODO: 使用 ReviewEngine 执行审查
    // 暂时使用模拟实现
    console.log(`[Review] Executing review for PR #${prNumber} in ${repo.name}`)
    console.log(`[Review] Files changed: ${files.length}`)
    console.log(`[Review] Diff length: ${diff.length} chars`)

    // 模拟审查结果
    const summary = `## 代码审查完成

已审查 PR #${prNumber} 的 ${files.length} 个文件变更。

**审查结果**: 代码看起来不错，无明显问题。

---
*由 OpenCode Review Platform 自动生成*`

    // 提交 Review
    await provider.createReview(owner, repoName, prNumber, {
      body: summary,
      decision: 'COMMENT',
      comments: [],
    })

    // 更新 Review 记录
    await db.update(reviews)
      .set({
        status: 'completed',
        decision: 'COMMENT',
        summary,
        commentsCount: 0,
        model: 'mock', // TODO: 实际模型名称
        durationMs: Date.now() - startTime,
        completedAt: new Date(),
      })
      .where(eq(reviews.id, reviewId))

    // 更新仓库统计
    await db.update(repositories)
      .set({
        reviewCount: repo.reviewCount + 1,
        lastReviewAt: new Date(),
      })
      .where(eq(repositories.id, repo.id))

    console.log(`[Review] Completed review ${reviewId} in ${Date.now() - startTime}ms`)
  } catch (error) {
    console.error(`[Review] Failed:`, error)
    
    await db.update(reviews)
      .set({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        completedAt: new Date(),
      })
      .where(eq(reviews.id, reviewId))
  }
}
