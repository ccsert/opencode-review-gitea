/**
 * 仓库管理路由
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { eq, and } from 'drizzle-orm'
import { ulid } from 'ulid'
import { createHash, randomBytes } from 'crypto'

import { getDatabase } from '../db/client'
import { repositories, platformCredentials } from '../db/schema/index'
import { authMiddleware } from '../middleware/auth'
import { createProvider } from '@opencode-review/core'

// 创建仓库 Schema
const createRepoSchema = z.object({
  provider: z.enum(['gitea', 'github', 'gitlab']),
  url: z.string().url('Invalid repository URL'),
  accessToken: z.string().min(1, 'Access token is required'),
  webhookSecret: z.string().optional(),
  templateId: z.string().optional(),
  skipValidation: z.boolean().optional(), // 用于测试，跳过仓库连接验证
  autoRegisterWebhook: z.boolean().optional().default(true), // 默认自动注册 webhook
  config: z.object({
    language: z.string().optional(),
    style: z.enum(['concise', 'detailed', 'strict']).optional(),
    autoReview: z.boolean().optional(),
    filePatterns: z.array(z.string()).optional(),
    ignorePatterns: z.array(z.string()).optional(),
  }).optional(),
})
type CreateRepoInput = z.infer<typeof createRepoSchema>

// 更新仓库 Schema
const updateRepoSchema = z.object({
  enabled: z.boolean().optional(),
  templateId: z.string().nullable().optional(),
  config: z.object({
    language: z.string().optional(),
    style: z.enum(['concise', 'detailed', 'strict']).optional(),
    autoReview: z.boolean().optional(),
    filePatterns: z.array(z.string()).optional(),
    ignorePatterns: z.array(z.string()).optional(),
  }).optional(),
  webhookSecret: z.string().optional(),
})
type UpdateRepoInput = z.infer<typeof updateRepoSchema>

export const repoRoutes = new Hono()

// 所有路由需要认证
repoRoutes.use('/*', authMiddleware)

/**
 * GET /repositories
 * 获取仓库列表
 */
repoRoutes.get('/', async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id
  
  const page = parseInt(c.req.query('page') || '1', 10)
  const pageSize = parseInt(c.req.query('pageSize') || '20', 10)
  const provider = c.req.query('provider')
  const enabled = c.req.query('enabled')
  const search = c.req.query('search')

  // 构建查询
  let query = db.select().from(repositories).$dynamic()
  
  // TODO: 添加过滤条件和分页
  const repos = await db.select().from(repositories)

  return c.json({
    success: true,
    data: repos.map(repo => {
      const webhookUrl = `${process.env.PUBLIC_URL || 'http://localhost:3000'}/api/v1/webhooks/${repo.provider}/${repo.id}`
      return {
        id: repo.id,
        provider: repo.provider,
        name: repo.name,
        url: repo.url,
        enabled: repo.enabled,
        templateId: repo.templateId,
        reviewCount: repo.reviewCount,
        lastReviewAt: repo.lastReviewAt,
        createdAt: repo.createdAt,
        webhookUrl,
        webhookSecret: repo.webhookSecret,
        webhookId: repo.webhookId,
        webhookStatus: repo.webhookStatus,
        webhookError: repo.webhookError,
      }
    }),
    pagination: {
      page,
      pageSize,
      total: repos.length,
      totalPages: Math.ceil(repos.length / pageSize),
    },
  })
})

/**
 * POST /repositories
 * 添加新仓库
 */
repoRoutes.post('/', zValidator('json', createRepoSchema), async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id
  const body = c.req.valid<CreateRepoInput>('json')

  // 解析仓库名称
  const urlParts = new URL(body.url).pathname.split('/').filter(Boolean)
  const repoName = urlParts.slice(0, 2).join('/')
  const baseUrl = new URL(body.url).origin
  const [owner, repo] = repoName.split('/')

  // 创建 Provider 实例
  const provider = createProvider({
    type: body.provider,
    baseUrl,
    token: body.accessToken,
  })

  // 验证连接（除非跳过验证）
  if (!body.skipValidation) {
    try {
      await provider.getRepository(owner, repo)
    } catch (error) {
      return c.json({
        success: false,
        error: {
          code: 'PROVIDER_ERROR',
          message: `Failed to connect to repository: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      }, 400)
    }
  }

  // 生成 Webhook Secret（如果未提供）
  const webhookSecret = body.webhookSecret || `wh_${randomBytes(16).toString('hex')}`
  
  // 加密存储 Token
  // TODO: 使用加密存储
  const encryptedToken = body.accessToken

  const id = ulid()
  const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000'
  const webhookUrl = `${publicUrl}/api/v1/webhooks/${body.provider}/${id}`

  // 尝试自动注册 Webhook
  let webhookId: number | null = null
  let webhookStatus: 'pending' | 'active' | 'error' | 'manual' = 'pending'
  let webhookError: string | null = null

  // 检查 PUBLIC_URL 是否配置（必须是可公网访问的地址）
  const shouldAutoRegister = body.autoRegisterWebhook !== false && 
    publicUrl !== 'http://localhost:3000' &&
    !publicUrl.includes('localhost') &&
    !publicUrl.includes('127.0.0.1')

  if (shouldAutoRegister) {
    try {
      const webhook = await provider.createWebhook(owner, repo, {
        url: webhookUrl,
        secret: webhookSecret,
        events: ['pull_request', 'issue_comment'],
        active: true,
      })
      webhookId = webhook.id
      webhookStatus = 'active'
    } catch (error) {
      webhookStatus = 'error'
      webhookError = error instanceof Error ? error.message : 'Failed to create webhook'
      // 不阻止仓库添加，用户可以手动配置或稍后重试
      console.error(`[Webhook] Failed to auto-register webhook for ${repoName}:`, webhookError)
    }
  } else if (body.autoRegisterWebhook !== false) {
    // PUBLIC_URL 未配置或是本地地址
    webhookStatus = 'manual'
    webhookError = publicUrl === 'http://localhost:3000' || publicUrl.includes('localhost')
      ? 'PUBLIC_URL not configured or is localhost. Please configure a public URL and retry, or manually add webhook in Gitea.'
      : null
  } else {
    webhookStatus = 'manual'
  }
  
  await db.insert(repositories).values({
    id,
    userId,
    provider: body.provider,
    url: body.url,
    name: repoName,
    accessToken: encryptedToken,
    webhookSecret,
    webhookId,
    webhookStatus,
    webhookError,
    templateId: body.templateId,
    config: body.config || {},
    enabled: true,
    reviewCount: 0,
  })

  return c.json({
    success: true,
    data: {
      id,
      provider: body.provider,
      name: repoName,
      webhookUrl,
      webhookSecret,
      webhookStatus,
      webhookError,
      webhookId,
      // 如果需要手动配置，提供指南
      ...(webhookStatus !== 'active' && {
        manualSetupRequired: true,
        setupInstructions: {
          url: webhookUrl,
          secret: webhookSecret,
          events: ['pull_request', 'issue_comment'],
          contentType: 'application/json',
          hint: `在 ${body.provider === 'gitea' ? 'Gitea' : body.provider} 仓库设置 > Webhooks 中添加此配置`,
        },
      }),
    },
  }, 201)
})

/**
 * GET /repositories/:id
 * 获取仓库详情
 */
repoRoutes.get('/:id', async (c) => {
  const db = getDatabase()
  const id = c.req.param('id')

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id))

  if (!repo) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Repository not found',
      },
    }, 404)
  }

  // 生成 Webhook URL
  const webhookUrl = `${process.env.PUBLIC_URL || 'http://localhost:3000'}/api/v1/webhooks/${repo.provider}/${repo.id}`

  return c.json({
    success: true,
    data: {
      id: repo.id,
      provider: repo.provider,
      name: repo.name,
      url: repo.url,
      enabled: repo.enabled,
      templateId: repo.templateId,
      config: repo.config,
      reviewCount: repo.reviewCount,
      lastReviewAt: repo.lastReviewAt,
      createdAt: repo.createdAt,
      updatedAt: repo.updatedAt,
      webhookUrl,
      webhookSecret: repo.webhookSecret,
      webhookId: repo.webhookId,
      webhookStatus: repo.webhookStatus,
      webhookError: repo.webhookError,
    },
  })
})

/**
 * PUT /repositories/:id
 * 更新仓库配置
 */
repoRoutes.put('/:id', zValidator('json', updateRepoSchema), async (c) => {
  const db = getDatabase()
  const id = c.req.param('id')
  const body = c.req.valid<UpdateRepoInput>('json')

  const [existing] = await db.select().from(repositories).where(eq(repositories.id, id))

  if (!existing) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Repository not found',
      },
    }, 404)
  }

  await db.update(repositories)
    .set({
      enabled: body.enabled ?? existing.enabled,
      templateId: body.templateId !== undefined ? body.templateId : existing.templateId,
      webhookSecret: body.webhookSecret ?? existing.webhookSecret,
      config: body.config ? { ...existing.config, ...body.config } : existing.config,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, id))

  return c.json({
    success: true,
    data: {
      id,
      updated: true,
    },
  })
})

/**
 * DELETE /repositories/:id
 * 删除仓库（同时尝试删除远程 webhook）
 */
repoRoutes.delete('/:id', async (c) => {
  const db = getDatabase()
  const id = c.req.param('id')

  const [existing] = await db.select().from(repositories).where(eq(repositories.id, id))

  if (!existing) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Repository not found',
      },
    }, 404)
  }

  // 尝试删除远程 webhook（如果有）
  let webhookDeleted = false
  let webhookDeleteError: string | null = null
  
  if (existing.webhookId && existing.accessToken) {
    try {
      const baseUrl = new URL(existing.url).origin
      const provider = createProvider({
        type: existing.provider as 'gitea' | 'github' | 'gitlab',
        baseUrl,
        token: existing.accessToken,
      })
      
      const [owner, repoName] = existing.name.split('/')
      await provider.deleteWebhook(owner, repoName, existing.webhookId)
      webhookDeleted = true
    } catch (error) {
      // 删除远程 webhook 失败不阻止删除本地仓库记录
      webhookDeleteError = error instanceof Error ? error.message : 'Unknown error'
      console.warn(`[Webhook] Failed to delete remote webhook for ${existing.name}:`, webhookDeleteError)
    }
  }

  await db.delete(repositories).where(eq(repositories.id, id))

  return c.json({
    success: true,
    data: {
      id,
      deleted: true,
      webhookDeleted,
      webhookDeleteError,
    },
  })
})

/**
 * POST /repositories/:id/test
 * 测试仓库连接
 */
repoRoutes.post('/:id/test', async (c) => {
  const db = getDatabase()
  const id = c.req.param('id')

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id))

  if (!repo) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Repository not found',
      },
    }, 404)
  }

  try {
    const baseUrl = new URL(repo.url).origin
    const provider = createProvider({
      type: repo.provider as 'gitea' | 'github' | 'gitlab',
      baseUrl,
      token: repo.accessToken!,
    })
    
    const [owner, repoName] = repo.name.split('/')
    const repoInfo = await provider.getRepository(owner, repoName)

    return c.json({
      success: true,
      data: {
        connected: true,
        repository: {
          name: repoInfo.fullName,
          defaultBranch: repoInfo.defaultBranch,
          private: repoInfo.private,
        },
      },
    })
  } catch (error) {
    return c.json({
      success: true,
      data: {
        connected: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      },
    })
  }
})

/**
 * POST /repositories/:id/webhook/register
 * 手动注册或重试注册 Webhook
 * 用于初次注册失败后重试，或手动触发注册
 */
repoRoutes.post('/:id/webhook/register', async (c) => {
  const db = getDatabase()
  const id = c.req.param('id')

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id))

  if (!repo) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Repository not found',
      },
    }, 404)
  }

  if (!repo.accessToken) {
    return c.json({
      success: false,
      error: {
        code: 'NO_TOKEN',
        message: 'Repository has no access token configured',
      },
    }, 400)
  }

  const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000'
  
  // 检查 PUBLIC_URL 是否有效
  if (publicUrl === 'http://localhost:3000' || publicUrl.includes('localhost') || publicUrl.includes('127.0.0.1')) {
    return c.json({
      success: false,
      error: {
        code: 'INVALID_PUBLIC_URL',
        message: 'PUBLIC_URL is not configured or is localhost. Webhook registration requires a publicly accessible URL.',
        hint: 'Please set the PUBLIC_URL environment variable to your server\'s public address',
      },
    }, 400)
  }

  const webhookUrl = `${publicUrl}/api/v1/webhooks/${repo.provider}/${repo.id}`
  const baseUrl = new URL(repo.url).origin
  const [owner, repoName] = repo.name.split('/')

  try {
    const provider = createProvider({
      type: repo.provider as 'gitea' | 'github' | 'gitlab',
      baseUrl,
      token: repo.accessToken,
    })

    // 如果已经有 webhook，先尝试删除旧的
    if (repo.webhookId) {
      try {
        await provider.deleteWebhook(owner, repoName, repo.webhookId)
      } catch {
        // 忽略删除失败，可能 webhook 已经不存在
      }
    }

    // 创建新的 webhook
    const webhook = await provider.createWebhook(owner, repoName, {
      url: webhookUrl,
      secret: repo.webhookSecret || '',
      events: ['pull_request', 'issue_comment'],
      active: true,
    })

    // 更新数据库
    await db.update(repositories)
      .set({
        webhookId: webhook.id,
        webhookStatus: 'active',
        webhookError: null,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, id))

    return c.json({
      success: true,
      data: {
        webhookId: webhook.id,
        webhookUrl,
        webhookStatus: 'active',
        message: 'Webhook registered successfully',
      },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to register webhook'
    
    // 更新错误状态
    await db.update(repositories)
      .set({
        webhookStatus: 'error',
        webhookError: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, id))

    return c.json({
      success: false,
      error: {
        code: 'WEBHOOK_REGISTER_FAILED',
        message: errorMessage,
        hint: 'Make sure the access token has admin permissions on the repository',
      },
    }, 400)
  }
})

/**
 * DELETE /repositories/:id/webhook
 * 删除远程 Webhook（不删除仓库）
 */
repoRoutes.delete('/:id/webhook', async (c) => {
  const db = getDatabase()
  const id = c.req.param('id')

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id))

  if (!repo) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Repository not found',
      },
    }, 404)
  }

  if (!repo.webhookId) {
    return c.json({
      success: false,
      error: {
        code: 'NO_WEBHOOK',
        message: 'No webhook registered for this repository',
      },
    }, 400)
  }

  if (!repo.accessToken) {
    return c.json({
      success: false,
      error: {
        code: 'NO_TOKEN',
        message: 'Repository has no access token configured',
      },
    }, 400)
  }

  try {
    const baseUrl = new URL(repo.url).origin
    const [owner, repoName] = repo.name.split('/')
    
    const provider = createProvider({
      type: repo.provider as 'gitea' | 'github' | 'gitlab',
      baseUrl,
      token: repo.accessToken,
    })

    await provider.deleteWebhook(owner, repoName, repo.webhookId)

    // 更新数据库
    await db.update(repositories)
      .set({
        webhookId: null,
        webhookStatus: 'manual',
        webhookError: null,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, id))

    return c.json({
      success: true,
      data: {
        message: 'Webhook deleted successfully',
        webhookStatus: 'manual',
      },
    })
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: 'WEBHOOK_DELETE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to delete webhook',
      },
    }, 400)
  }
})

/**
 * GET /repositories/:id/webhook-url
 * 获取 Webhook URL 配置信息
 */
repoRoutes.get('/:id/webhook-url', async (c) => {
  const db = getDatabase()
  const id = c.req.param('id')

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, id))

  if (!repo) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Repository not found',
      },
    }, 404)
  }

  const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000'

  return c.json({
    success: true,
    data: {
      url: `${publicUrl}/api/v1/webhooks/${repo.provider}/${id}`,
      secret: repo.webhookSecret,
      events: ['pull_request', 'issue_comment'],
      instructions: `在 ${repo.provider === 'gitea' ? 'Gitea' : repo.provider} 仓库设置 > Webhooks 中添加此 URL`,
    },
  })
})

// ============ 从平台凭证批量导入仓库 ============

// 批量导入仓库 Schema
const importReposSchema = z.object({
  platformCredentialId: z.string().min(1, 'Platform credential ID is required'),
  repositories: z.array(z.object({
    fullName: z.string(), // owner/repo 格式
    url: z.string().url(),
  })).min(1, 'At least one repository is required'),
  templateId: z.string().optional(),
  autoRegisterWebhook: z.boolean().optional().default(true), // 默认自动注册 webhook
  config: z.object({
    language: z.string().optional(),
    style: z.enum(['concise', 'detailed', 'strict']).optional(),
    autoReview: z.boolean().optional(),
    filePatterns: z.array(z.string()).optional(),
    ignorePatterns: z.array(z.string()).optional(),
  }).optional(),
})
type ImportReposInput = z.infer<typeof importReposSchema>

/**
 * POST /repositories/import
 * 从平台凭证批量导入仓库
 * 这是核心功能：用户选择平台上的仓库后批量添加
 */
repoRoutes.post('/import', zValidator('json', importReposSchema), async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id
  const body = c.req.valid<ImportReposInput>('json')

  // 验证平台凭证
  const [platform] = await db
    .select()
    .from(platformCredentials)
    .where(and(
      eq(platformCredentials.id, body.platformCredentialId),
      eq(platformCredentials.userId, userId)
    ))

  if (!platform) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Platform credential not found',
      },
    }, 404)
  }

  const results: Array<{
    fullName: string
    success: boolean
    id?: string
    error?: string
    webhookUrl?: string
    webhookSecret?: string
    webhookStatus?: string
    webhookError?: string
  }> = []

  const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000'
  
  // 检查是否应该自动注册 webhook
  const shouldAutoRegister = body.autoRegisterWebhook !== false && 
    publicUrl !== 'http://localhost:3000' &&
    !publicUrl.includes('localhost') &&
    !publicUrl.includes('127.0.0.1')

  // 创建 provider 实例用于 webhook 注册
  let provider: ReturnType<typeof createProvider> | null = null
  if (shouldAutoRegister) {
    try {
      provider = createProvider({
        type: platform.provider as 'gitea' | 'github' | 'gitlab',
        baseUrl: platform.baseUrl,
        token: platform.accessToken,
      })
    } catch {
      // 创建 provider 失败，继续但不注册 webhook
      provider = null
    }
  }

  for (const repo of body.repositories) {
    try {
      // 检查是否已存在
      const [existing] = await db
        .select()
        .from(repositories)
        .where(and(
          eq(repositories.userId, userId),
          eq(repositories.url, repo.url)
        ))

      if (existing) {
        results.push({
          fullName: repo.fullName,
          success: false,
          error: 'Repository already exists',
        })
        continue
      }

      // 生成 Webhook Secret
      const webhookSecret = `wh_${randomBytes(16).toString('hex')}`
      const id = ulid()
      const webhookUrl = `${publicUrl}/api/v1/webhooks/${platform.provider}/${id}`

      // 尝试自动注册 webhook
      let webhookId: number | null = null
      let webhookStatus: 'pending' | 'active' | 'error' | 'manual' = shouldAutoRegister ? 'pending' : 'manual'
      let webhookError: string | null = null

      if (shouldAutoRegister && provider) {
        const [owner, repoName] = repo.fullName.split('/')
        try {
          const webhook = await provider.createWebhook(owner, repoName, {
            url: webhookUrl,
            secret: webhookSecret,
            events: ['pull_request', 'issue_comment'],
            active: true,
          })
          webhookId = webhook.id
          webhookStatus = 'active'
        } catch (error) {
          webhookStatus = 'error'
          webhookError = error instanceof Error ? error.message : 'Failed to create webhook'
        }
      }

      await db.insert(repositories).values({
        id,
        userId,
        platformCredentialId: platform.id,
        provider: platform.provider,
        providerRepoId: repo.fullName,
        url: repo.url,
        name: repo.fullName,
        webhookSecret,
        webhookId,
        webhookStatus,
        webhookError,
        templateId: body.templateId,
        config: body.config || {},
        enabled: true,
        reviewCount: 0,
      })

      results.push({
        fullName: repo.fullName,
        success: true,
        id,
        webhookUrl,
        webhookSecret,
        webhookStatus,
        webhookError: webhookError || undefined,
      })
    } catch (error) {
      results.push({
        fullName: repo.fullName,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length
  const webhookActiveCount = results.filter(r => r.webhookStatus === 'active').length

  return c.json({
    success: true,
    data: {
      imported: successCount,
      failed: failCount,
      webhooksRegistered: webhookActiveCount,
      results,
      // 如果有仓库需要手动配置 webhook，提示用户
      ...(webhookActiveCount < successCount && {
        manualSetupHint: `${successCount - webhookActiveCount} repositories need manual webhook configuration`,
      }),
    },
  }, 201)
})
