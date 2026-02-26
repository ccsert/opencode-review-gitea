/**
 * Webhook 接收路由
 */

import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'

import { getDatabase } from '../db/client'
import { repositories, webhookLogs, reviews, platformCredentials } from '../db/schema/index'
import { 
  createProvider, 
  shouldTriggerReview, 
  getEventDescription,
} from '@opencode-review/core'
import { decrypt, isEncrypted } from '../utils/crypto'
import { executeReviewAsync } from '../services/review-executor'


export const webhookRoutes = new Hono()

/**
 * POST /webhooks/:provider/:repositoryId
 * 接收指定仓库的 Webhook
 */
webhookRoutes.post('/:provider/:repositoryId', async (c) => {
  const db = getDatabase()
  const provider = c.req.param('provider')
  const repositoryId = c.req.param('repositoryId')
  
  // 获取原始请求体（用于签名验证）
  const rawBody = await c.req.text()
  const headers: Record<string, string> = {}
  c.req.raw.headers.forEach((value: string, key: string) => {
    headers[key.toLowerCase()] = value
  })

  // 获取仓库配置
  const [repo] = await db.select()
    .from(repositories)
    .where(eq(repositories.id, repositoryId))

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

  // 获取 Access Token（优先从平台凭证获取，向后兼容直接存储的 Token）
  let accessToken = repo.accessToken && isEncrypted(repo.accessToken) ? decrypt(repo.accessToken) : repo.accessToken
  if (repo.platformCredentialId) {
    const [platform] = await db.select()
      .from(platformCredentials)
      .where(eq(platformCredentials.id, repo.platformCredentialId))
    if (platform) {
      accessToken = platform.accessToken && isEncrypted(platform.accessToken) ? decrypt(platform.accessToken) : platform.accessToken
    }
  }

  if (!accessToken) {
    return c.json({
      success: false,
      error: {
        code: 'NO_ACCESS_TOKEN',
        message: 'Repository has no access token configured',
      },
    }, 400)
  }

  // 创建 Provider 实例
  const baseUrl = new URL(repo.url).origin
  const gitProvider = createProvider({
    type: repo.provider as 'gitea' | 'github' | 'gitlab',
    baseUrl,
    token: accessToken,
  })

  // 验证签名
  // Gitea 使用 x-gitea-signature，GitHub 使用 x-hub-signature-256
  const signature = headers['x-gitea-signature'] || 
                   headers['x-hub-signature-256'] || 
                   headers['x-gitlab-token'] || ''
  
  // 调试日志
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Webhook] Signature verification debug:', {
      hasWebhookSecret: !!repo.webhookSecret,
      secretLength: repo.webhookSecret?.length,
      receivedSignature: signature ? `${signature.substring(0, 20)}...` : 'none',
      signatureHeader: headers['x-gitea-signature'] ? 'x-gitea-signature' : 
                       headers['x-hub-signature-256'] ? 'x-hub-signature-256' : 'none',
    })
  }
  
  // 如果配置了 webhook secret，验证签名
  if (repo.webhookSecret) {
    const isValid = gitProvider.verifyWebhookSignature(rawBody, signature, repo.webhookSecret)
    
    if (!isValid) {
      // 开发环境允许绕过签名验证（通过环境变量）
      const skipVerification = process.env.SKIP_WEBHOOK_VERIFICATION === 'true'
      
      if (!skipVerification) {
        // 额外调试：计算期望的签名
        if (process.env.NODE_ENV !== 'production') {
          const crypto = await import('crypto')
          const expectedHash = crypto.createHmac('sha256', repo.webhookSecret)
            .update(rawBody)
            .digest('hex')
          console.log('[Webhook] Signature mismatch:', {
            received: signature,
            expected: expectedHash,
            match: signature === expectedHash || signature === `sha256=${expectedHash}`,
            secretPreview: `${repo.webhookSecret.substring(0, 4)}...`,
          })
        }
        
        // 记录无效签名
        await db.insert(webhookLogs).values({
          id: ulid(),
          repositoryId,
          eventType: 'signature_invalid',
          deliveryId: headers['x-gitea-delivery'] || headers['x-github-delivery'] || headers['x-gitlab-event-uuid'],
          payload: JSON.parse(rawBody),
          headers,
          processed: false,
          error: `Invalid webhook signature for ${provider} provider. Received: ${signature || 'none'}`,
        })

        return c.json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid webhook signature',
            details: {
              expectedHeader: 'x-gitea-signature',
              expectedFormat: 'sha256=<hmac>',
              receivedSignature: signature ? 'present but invalid' : 'missing',
            },
          },
        }, 401)
      }
      
      console.warn('[Webhook] Signature verification failed but SKIP_WEBHOOK_VERIFICATION is enabled')
    }
  } else {
    console.warn('[Webhook] No webhook secret configured for repository, skipping verification')
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

  // 调试：显示收到的事件类型
  const rawEventType = headers['x-gitea-event'] || headers['x-github-event'] || headers['x-gitlab-event'] || 'unknown'
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Webhook] Received event:', {
      provider,
      rawEventType,
      action: (payload as any)?.action,
      hasPullRequest: !!(payload as any)?.pull_request,
      hasIssue: !!(payload as any)?.issue,
      isPRComment: !!(payload as any)?.issue?.pull_request,
    })
  }

  const event = gitProvider.parseWebhookEvent(payload, headers)

  // 记录 Webhook 日志
  const logId = ulid()
  await db.insert(webhookLogs).values({
    id: logId,
    repositoryId,
    eventType: event?.type || 'unknown',
    deliveryId: headers['x-gitea-delivery'] || headers['x-github-delivery'] || headers['x-gitlab-event-uuid'],
    payload: payload as any,
    headers,
    processed: false,
  })

  if (!event) {
    console.log('[Webhook] Event not supported:', rawEventType)
    return c.json({
      success: true,
      data: {
        received: true,
        eventType: rawEventType,
        supported: false,
        message: `Event type '${rawEventType}' is not supported. Supported: pull_request, issue_comment (on PR)`,
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
  const provider = c.req.param('provider')
  
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
  const [repo] = await db.select()
    .from(repositories)
    .where(eq(repositories.name, repoFullName))

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
 * GET /webhooks/:provider/:repositoryId/test
 * 测试 Webhook 配置（用于调试）
 */
webhookRoutes.get('/:provider/:repositoryId/test', async (c) => {
  const db = getDatabase()
  const repositoryId = c.req.param('repositoryId')
  
  const [repo] = await db.select()
    .from(repositories)
    .where(eq(repositories.id, repositoryId))

  if (!repo) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Repository not found',
      },
    }, 404)
  }

  return c.json({
    success: true,
    data: {
      repository: {
        id: repo.id,
        name: repo.name,
        provider: repo.provider,
      },
      webhook: {
        url: `${process.env.PUBLIC_URL || 'http://localhost:3000'}/api/v1/webhooks/${repo.provider}/${repo.id}`,
        secretConfigured: !!repo.webhookSecret,
        enabled: repo.enabled,
      },
      instructions: {
        headers: {
          'Content-Type': 'application/json',
          'X-Gitea-Event': 'pull_request',
          'X-Gitea-Signature': repo.webhookSecret 
            ? 'sha256=<hmac-sha256-of-payload>' 
            : 'not required (no secret configured)',
        },
        examplePayload: {
          action: 'opened',
          number: 1,
          pull_request: {
            number: 1,
            title: 'Test PR',
            body: 'Test description',
            user: { login: 'testuser' },
            html_url: `${new URL(repo.url).origin}/pulls/1`,
          },
          repository: {
            full_name: repo.name,
            html_url: repo.url,
          },
        },
      },
    },
  })
})
