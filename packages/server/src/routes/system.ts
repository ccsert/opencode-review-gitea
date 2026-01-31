/**
 * 系统管理路由
 */

import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { getDatabase, getDatabaseType } from '../db/client'
import { users, repositories, reviews, webhookLogs } from '../db/schema/index'
import { authMiddleware } from '../middleware/auth'

export const systemRoutes = new Hono()

/**
 * GET /system/health
 * 健康检查（无需认证）
 */
systemRoutes.get('/health', async (c) => {
  const db = getDatabase()
  
  try {
    // 简单的数据库连接检查
    db.run(sql`SELECT 1`)

    return c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: getDatabaseType(),
      version: process.env.npm_package_version || '1.0.0',
    })
  } catch (error) {
    return c.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Database connection failed',
    }, 503)
  }
})

/**
 * GET /system/info
 * 系统信息（需要认证）
 */
systemRoutes.get('/info', authMiddleware, async (c) => {
  const db = getDatabase()
  const user = c.get('user')

  // 只有管理员可以查看完整系统信息
  if (user.role !== 'admin') {
    return c.json({
      version: process.env.npm_package_version || '1.0.0',
      database: getDatabaseType(),
    })
  }

  // 获取统计信息
  const [userCount, repoCount, reviewCount, webhookLogCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(users).get(),
    db.select({ count: sql<number>`count(*)` }).from(repositories).get(),
    db.select({ count: sql<number>`count(*)` }).from(reviews).get(),
    db.select({ count: sql<number>`count(*)` }).from(webhookLogs).get(),
  ])

  return c.json({
    version: process.env.npm_package_version || '1.0.0',
    database: getDatabaseType(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    stats: {
      users: userCount?.count || 0,
      repositories: repoCount?.count || 0,
      reviews: reviewCount?.count || 0,
      webhookLogs: webhookLogCount?.count || 0,
    },
    env: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  })
})

/**
 * GET /system/config
 * 获取公开配置（无需认证）
 */
systemRoutes.get('/config', async (c) => {
  return c.json({
    success: true,
    data: {
      providers: ['gitea', 'github', 'gitlab'],
      features: {
        registration: process.env.ENABLE_REGISTRATION !== 'false',
        oauth: false, // TODO: OAuth 支持
        multiUser: process.env.MULTI_USER !== 'false',
      },
      limits: {
        maxReposPerUser: parseInt(process.env.MAX_REPOS_PER_USER || '50'),
        maxApiKeysPerUser: parseInt(process.env.MAX_API_KEYS_PER_USER || '10'),
      },
    },
  })
})

/**
 * POST /system/config
 * 更新系统配置（仅管理员）
 */
systemRoutes.post(
  '/config',
  authMiddleware,
  zValidator('json', z.object({
    defaultModel: z.string().optional(),
    maxReposPerUser: z.number().min(1).optional(),
    maxApiKeysPerUser: z.number().min(1).optional(),
    enableRegistration: z.boolean().optional(),
  })),
  async (c) => {
    const user = c.get('user')

    if (user.role !== 'admin') {
      return c.json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Admin access required',
        },
      }, 403)
    }

    // TODO: 实现配置更新
    // 可以存入数据库或配置文件

    return c.json({
      success: true,
      data: {
        message: 'Configuration updated',
      },
    })
  }
)

// 日志查询 Schema
const logsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
  level: z.enum(['error', 'warn', 'info', 'debug']).optional(),
})
type LogsQuery = z.infer<typeof logsQuerySchema>

/**
 * GET /system/logs
 * 获取系统日志（仅管理员）
 */
systemRoutes.get(
  '/logs',
  authMiddleware,
  zValidator('query', logsQuerySchema),
  async (c) => {
    const user = c.get('user')
    const query = c.req.valid<LogsQuery>('query')

    if (user.role !== 'admin') {
      return c.json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Admin access required',
        },
      }, 403)
    }

    // TODO: 实现日志查询
    // 可以从文件或数据库读取

    return c.json({
      success: true,
      data: {
        items: [],
        pagination: {
          page: query.page,
          limit: query.limit,
          total: 0,
          totalPages: 0,
        },
      },
    })
  }
)

// 清理 Schema
const cleanupSchema = z.object({
  olderThanDays: z.number().min(7).max(365).default(30),
  types: z.array(z.enum(['webhookLogs', 'reviews'])).default(['webhookLogs']),
})
type CleanupInput = z.infer<typeof cleanupSchema>

/**
 * POST /system/cleanup
 * 清理旧数据（仅管理员）
 */
systemRoutes.post(
  '/cleanup',
  authMiddleware,
  zValidator('json', cleanupSchema),
  async (c) => {
    const db = getDatabase()
    const user = c.get('user')
    const body = c.req.valid<CleanupInput>('json')

    if (user.role !== 'admin') {
      return c.json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Admin access required',
        },
      }, 403)
    }

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - body.olderThanDays)

    const results: Record<string, number> = {}

    if (body.types.includes('webhookLogs')) {
      // 先计数再删除（SQLite 不支持 DELETE ... RETURNING COUNT）
      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(webhookLogs)
        .where(sql`${webhookLogs.createdAt} < ${cutoffDate}`)
        .get()
      
      await db.delete(webhookLogs)
        .where(sql`${webhookLogs.createdAt} < ${cutoffDate}`)
      results.webhookLogs = countResult?.count ?? 0
    }

    if (body.types.includes('reviews')) {
      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(reviews)
        .where(sql`${reviews.createdAt} < ${cutoffDate}`)
        .get()
      
      await db.delete(reviews)
        .where(sql`${reviews.createdAt} < ${cutoffDate}`)
      results.reviews = countResult?.count ?? 0
    }

    return c.json({
      success: true,
      data: {
        cleaned: results,
        olderThan: cutoffDate.toISOString(),
      },
    })
  }
)

/**
 * GET /system/models
 * 获取可用的 AI 模型列表
 */
systemRoutes.get('/models', authMiddleware, async (c) => {
  // TODO: 从 OpenCode SDK 或配置获取可用模型
  const models = [
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
    { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
    { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku', provider: 'anthropic' },
    { id: 'deepseek-v3', name: 'DeepSeek V3', provider: 'deepseek' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google' },
  ]

  return c.json({
    success: true,
    data: models,
  })
})
