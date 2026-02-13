/**
 * Webhook 接收路由
 */

import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'

import { getDatabase } from '../db/client'
import { repositories, webhookLogs, reviews, platformCredentials, aiProviders, reviewTemplates } from '../db/schema/index'
import { 
  createProvider, 
  shouldTriggerReview, 
  getEventDescription,
  ReviewEngine,
  getDefaultTemplate,
  type WebhookEvent,
  type ReviewTemplate,
  type ReviewCategory,
  type ReviewSeverity
} from '@opencode-review/core'

// ReviewEngine 实例缓存（按配置缓存）
const reviewEngineCache = new Map<string, ReviewEngine>()

/**
 * 获取或创建 ReviewEngine 实例
 * 支持从数据库读取用户的 AI 供应商配置
 */
async function getReviewEngineForUser(userId: string): Promise<ReviewEngine> {
  const db = getDatabase()

  // 查找用户的默认 AI 供应商
  let [aiProvider] = await db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.userId, userId))
    .orderBy(aiProviders.isDefault)
    .limit(1)
  
  // 如果用户没有配置 AI 供应商，使用环境变量配置
  if (!aiProvider) {
    console.log('[ReviewEngine] No AI provider configured for user, using environment config')
    return getDefaultReviewEngine()
  }

  // 创建缓存键
  const cacheKey = `${aiProvider.id}:${aiProvider.updatedAt?.toISOString() || aiProvider.createdAt.toISOString()}`
  
  // 检查缓存
  if (reviewEngineCache.has(cacheKey)) {
    return reviewEngineCache.get(cacheKey)!
  }

  console.log(`[ReviewEngine] Creating engine for AI provider: ${aiProvider.name} (${aiProvider.provider})`)

  // 构建模型 ID - 直接模式不需要 provider 前缀
  const modelID = aiProvider.defaultModel || 'deepseek-chat'

  const engine = new ReviewEngine({
    opencode: {
      port: process.env.OPENCODE_PORT ? parseInt(process.env.OPENCODE_PORT, 10) : 4096,
      hostname: process.env.OPENCODE_HOSTNAME || '127.0.0.1',
      serverUrl: process.env.OPENCODE_SERVER_URL,
    },
    model: {
      providerID: aiProvider.provider,
      modelID,
    },
    apiKey: aiProvider.apiKey || undefined,
    baseUrl: aiProvider.baseUrl || undefined,
    useDirectMode: true, // 使用直接 AI 调用模式，更可靠
    debug: process.env.NODE_ENV !== 'production',
  })

  // 更新最后使用时间
  await db.update(aiProviders)
    .set({ lastUsedAt: new Date() })
    .where(eq(aiProviders.id, aiProvider.id))

  // 缓存引擎（限制缓存大小）
  if (reviewEngineCache.size > 100) {
    const firstKey = reviewEngineCache.keys().next().value
    if (firstKey) {
      reviewEngineCache.delete(firstKey)
    }
  }
  reviewEngineCache.set(cacheKey, engine)

  return engine
}

/**
 * 获取默认的 ReviewEngine（使用环境变量配置）
 */
function getDefaultReviewEngine(): ReviewEngine {
  const cacheKey = 'default'
  
  if (reviewEngineCache.has(cacheKey)) {
    return reviewEngineCache.get(cacheKey)!
  }

  const portEnv = process.env.OPENCODE_PORT
  const port = portEnv ? parseInt(portEnv, 10) : 4096
  
  const engine = new ReviewEngine({
    opencode: {
      port: isNaN(port) ? 4096 : port,
      hostname: process.env.OPENCODE_HOSTNAME || '127.0.0.1',
      serverUrl: process.env.OPENCODE_SERVER_URL,
    },
    model: {
      providerID: process.env.OPENCODE_PROVIDER_ID || 'deepseek',
      modelID: process.env.OPENCODE_MODEL_ID || 'deepseek/deepseek-chat',
    },
    debug: process.env.NODE_ENV !== 'production',
  })

  reviewEngineCache.set(cacheKey, engine)
  return engine
}

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
  let accessToken = repo.accessToken
  if (repo.platformCredentialId) {
    const [platform] = await db.select()
      .from(platformCredentials)
      .where(eq(platformCredentials.id, repo.platformCredentialId))
    if (platform) {
      accessToken = platform.accessToken
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

    console.log(`[Review] Starting AI review for PR #${prNumber} in ${repo.name}`)

    // 获取审查模板：优先使用仓库关联的模板，否则使用默认模板
    let template: ReviewTemplate = getDefaultTemplate()
    
    if (repo.templateId) {
      const [customTemplate] = await db.select()
        .from(reviewTemplates)
        .where(eq(reviewTemplates.id, repo.templateId))
      
      if (customTemplate) {
        console.log(`[Review] Using custom template: ${customTemplate.name}`)
        template = {
          id: customTemplate.id,
          name: customTemplate.name,
          description: customTemplate.description || '',
          systemPrompt: customTemplate.systemPrompt,
          categories: (customTemplate.categories || ['BUG', 'SECURITY', 'PERFORMANCE', 'STYLE']) as ReviewCategory[],
          severities: (customTemplate.severities || ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) as ReviewSeverity[],
          isSystem: customTemplate.isSystem,
          isDefault: customTemplate.isDefault,
        }
      }
    }

    // 获取 ReviewEngine 实例（使用用户配置的 AI 供应商）
    const engine = await getReviewEngineForUser(repo.userId)

    // 执行 AI 审查
    const result = await engine.executeReview({
      provider,
      repository: {
        owner,
        repo: repoName,
        fullName: repo.name,
      },
      pullRequest: {
        number: prNumber,
        title: event.pullRequest.title,
        author: event.pullRequest.author.login,
        baseBranch: event.pullRequest.base?.ref || 'main',
        headBranch: event.pullRequest.head?.ref || 'unknown',
      },
      template,
      config: {
        language: 'zh-CN',
        style: 'detailed',
      },
    })

    if (!result.success) {
      throw new Error(result.error || 'Review execution failed')
    }

    // 更新 Review 记录
    await db.update(reviews)
      .set({
        status: 'completed',
        decision: result.decision || 'COMMENT',
        summary: result.summary,
        commentsCount: result.commentsCount || 0,
        model: process.env.OPENCODE_MODEL_ID || 'deepseek/deepseek-chat',
        tokensUsed: result.tokensUsed,
        durationMs: result.durationMs || (Date.now() - startTime),
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

    console.log(`[Review] Completed review ${reviewId} in ${result.durationMs || (Date.now() - startTime)}ms`)
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
