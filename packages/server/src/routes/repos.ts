/**
 * 仓库管理路由
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { createHash, randomBytes } from 'crypto'

import { getDatabase } from '../db/client'
import { repositories } from '../db/schema/index'
import { authMiddleware } from '../middleware/auth'
import { createProvider } from '@opencode-review/core'

// 创建仓库 Schema
const createRepoSchema = z.object({
  provider: z.enum(['gitea', 'github', 'gitlab']),
  url: z.string().url('Invalid repository URL'),
  accessToken: z.string().min(1, 'Access token is required'),
  webhookSecret: z.string().optional(),
  templateId: z.string().optional(),
  config: z.object({
    language: z.string().optional(),
    style: z.enum(['concise', 'detailed', 'strict']).optional(),
    autoReview: z.boolean().optional(),
    filePatterns: z.array(z.string()).optional(),
    ignorePatterns: z.array(z.string()).optional(),
  }).optional(),
})

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
  const repos = await db.select().from(repositories).all()

  return c.json({
    success: true,
    data: repos.map(repo => ({
      id: repo.id,
      provider: repo.provider,
      name: repo.name,
      url: repo.url,
      enabled: repo.enabled,
      templateId: repo.templateId,
      reviewCount: repo.reviewCount,
      lastReviewAt: repo.lastReviewAt,
      createdAt: repo.createdAt,
    })),
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
  const body = c.req.valid('json')

  // 解析仓库名称
  const urlParts = new URL(body.url).pathname.split('/').filter(Boolean)
  const repoName = urlParts.slice(0, 2).join('/')
  const baseUrl = new URL(body.url).origin

  // 验证连接
  try {
    const provider = createProvider({
      type: body.provider,
      baseUrl,
      token: body.accessToken,
    })
    
    const [owner, repo] = repoName.split('/')
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

  // 生成 Webhook Secret（如果未提供）
  const webhookSecret = body.webhookSecret || `wh_${randomBytes(16).toString('hex')}`
  
  // 加密存储 Token
  // TODO: 使用加密存储
  const encryptedToken = body.accessToken

  const id = ulid()
  
  await db.insert(repositories).values({
    id,
    userId,
    provider: body.provider,
    url: body.url,
    name: repoName,
    accessToken: encryptedToken,
    webhookSecret,
    templateId: body.templateId,
    config: body.config || {},
    enabled: true,
    reviewCount: 0,
  })

  const webhookUrl = `${process.env.PUBLIC_URL || 'http://localhost:3000'}/api/v1/webhooks/${body.provider}/${id}`

  return c.json({
    success: true,
    data: {
      id,
      provider: body.provider,
      name: repoName,
      webhookUrl,
      webhookSecret,
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

  const repo = await db.select().from(repositories).where(eq(repositories.id, id)).get()

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
  const body = c.req.valid('json')

  const existing = await db.select().from(repositories).where(eq(repositories.id, id)).get()

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
      ...body,
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
 * 删除仓库
 */
repoRoutes.delete('/:id', async (c) => {
  const db = getDatabase()
  const id = c.req.param('id')

  const existing = await db.select().from(repositories).where(eq(repositories.id, id)).get()

  if (!existing) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Repository not found',
      },
    }, 404)
  }

  await db.delete(repositories).where(eq(repositories.id, id))

  return c.json({
    success: true,
    data: {
      id,
      deleted: true,
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

  const repo = await db.select().from(repositories).where(eq(repositories.id, id)).get()

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
 * GET /repositories/:id/webhook-url
 * 获取 Webhook URL 配置信息
 */
repoRoutes.get('/:id/webhook-url', async (c) => {
  const db = getDatabase()
  const id = c.req.param('id')

  const repo = await db.select().from(repositories).where(eq(repositories.id, id)).get()

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
