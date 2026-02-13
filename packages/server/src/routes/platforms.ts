/**
 * 平台凭证管理路由
 * 用于管理用户的 Git 平台（Gitea/GitHub/GitLab）访问凭证
 * 支持多实例配置（如多个 Gitea 服务器）
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { eq, and } from 'drizzle-orm'
import { ulid } from 'ulid'

import { getDatabase } from '../db/client'
import { platformCredentials } from '../db/schema/index'
import { authMiddleware } from '../middleware/auth'
import { createProvider } from '@opencode-review/core'

// ============ Schema 定义 ============

// 创建平台凭证 Schema
const createPlatformSchema = z.object({
  provider: z.enum(['gitea', 'gitlab']),
  baseUrl: z.string().url('Invalid platform URL'),
  name: z.string().min(1, 'Name is required').max(50, 'Name too long'),
  accessToken: z.string().min(1, 'Access token is required'),
})
type CreatePlatformInput = z.infer<typeof createPlatformSchema>

// 更新平台凭证 Schema
const updatePlatformSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  accessToken: z.string().min(1).optional(),
})
type UpdatePlatformInput = z.infer<typeof updatePlatformSchema>

// 查询仓库列表参数
const listReposQuerySchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  perPage: z.coerce.number().min(1).max(100).optional().default(50),
  org: z.string().optional(), // 可选：指定组织
})

export const platformRoutes = new Hono()

// 所有路由需要认证
platformRoutes.use('/*', authMiddleware)

/**
 * GET /platforms
 * 获取用户的平台凭证列表
 */
platformRoutes.get('/', async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id

  const platforms = await db
    .select({
      id: platformCredentials.id,
      provider: platformCredentials.provider,
      baseUrl: platformCredentials.baseUrl,
      name: platformCredentials.name,
      lastUsedAt: platformCredentials.lastUsedAt,
      createdAt: platformCredentials.createdAt,
    })
    .from(platformCredentials)
    .where(eq(platformCredentials.userId, userId))

  return c.json({
    success: true,
    data: platforms,
  })
})

/**
 * POST /platforms
 * 添加新的平台凭证
 */
platformRoutes.post('/', zValidator('json', createPlatformSchema), async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id
  const body = c.req.valid<CreatePlatformInput>('json')

  // 验证凭证有效性：尝试获取用户信息
  try {
    const provider = createProvider({
      type: body.provider,
      baseUrl: body.baseUrl,
      token: body.accessToken,
    })
    
    // 尝试获取仓库列表来验证 Token 有效性
    await provider.listUserRepositories({ page: 1, perPage: 1 })
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: 'INVALID_CREDENTIALS',
        message: `Failed to connect to platform: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
    }, 400)
  }

  const id = ulid()
  
  // TODO: 实现 Token 加密存储
  await db.insert(platformCredentials).values({
    id,
    userId,
    provider: body.provider,
    baseUrl: body.baseUrl.replace(/\/$/, ''), // 移除尾部斜杠
    name: body.name,
    accessToken: body.accessToken,
  })

  return c.json({
    success: true,
    data: {
      id,
      provider: body.provider,
      baseUrl: body.baseUrl,
      name: body.name,
    },
  }, 201)
})

/**
 * GET /platforms/:id
 * 获取平台凭证详情
 */
platformRoutes.get('/:id', async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id
  const id = c.req.param('id')

  const [platform] = await db
    .select({
      id: platformCredentials.id,
      provider: platformCredentials.provider,
      baseUrl: platformCredentials.baseUrl,
      name: platformCredentials.name,
      lastUsedAt: platformCredentials.lastUsedAt,
      createdAt: platformCredentials.createdAt,
    })
    .from(platformCredentials)
    .where(and(
      eq(platformCredentials.id, id),
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

  return c.json({
    success: true,
    data: platform,
  })
})

/**
 * PUT /platforms/:id
 * 更新平台凭证
 */
platformRoutes.put('/:id', zValidator('json', updatePlatformSchema), async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id
  const id = c.req.param('id')
  const body = c.req.valid<UpdatePlatformInput>('json')

  // 检查是否存在
  const [existing] = await db
    .select()
    .from(platformCredentials)
    .where(and(
      eq(platformCredentials.id, id),
      eq(platformCredentials.userId, userId)
    ))

  if (!existing) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Platform credential not found',
      },
    }, 404)
  }

  // 如果更新了 Token，验证新 Token 的有效性
  if (body.accessToken) {
    try {
      const provider = createProvider({
        type: existing.provider as 'gitea' | 'gitlab',
        baseUrl: existing.baseUrl,
        token: body.accessToken,
      })
      await provider.listUserRepositories({ page: 1, perPage: 1 })
    } catch (error) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: `Invalid access token: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      }, 400)
    }
  }

  await db
    .update(platformCredentials)
    .set({
      ...body,
      updatedAt: new Date(),
    })
    .where(eq(platformCredentials.id, id))

  return c.json({
    success: true,
    data: { id },
  })
})

/**
 * DELETE /platforms/:id
 * 删除平台凭证
 */
platformRoutes.delete('/:id', async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id
  const id = c.req.param('id')

  const result = await db
    .delete(platformCredentials)
    .where(and(
      eq(platformCredentials.id, id),
      eq(platformCredentials.userId, userId)
    ))
    .returning({ id: platformCredentials.id })

  if (result.length === 0) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Platform credential not found',
      },
    }, 404)
  }

  return c.json({
    success: true,
    data: { deleted: true },
  })
})

/**
 * GET /platforms/:id/repositories
 * 获取平台上用户可访问的仓库列表
 * 这是核心功能：用户配置好平台后可以直接选择仓库
 */
platformRoutes.get('/:id/repositories', zValidator('query', listReposQuerySchema), async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id
  const id = c.req.param('id')
  const query = c.req.valid<z.infer<typeof listReposQuerySchema>>('query')

  // 获取平台凭证
  const [platform] = await db
    .select()
    .from(platformCredentials)
    .where(and(
      eq(platformCredentials.id, id),
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

  try {
    const provider = createProvider({
      type: platform.provider as 'gitea' | 'gitlab',
      baseUrl: platform.baseUrl,
      token: platform.accessToken,
    })

    let result
    if (query.org) {
      // 获取指定组织的仓库
      result = await provider.listOrganizationRepositories(query.org, {
        page: query.page,
        perPage: query.perPage,
      })
    } else {
      // 获取用户所有可访问的仓库
      result = await provider.listUserRepositories({
        page: query.page,
        perPage: query.perPage,
      })
    }

    // 更新最后使用时间
    await db
      .update(platformCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(platformCredentials.id, id))

    return c.json({
      success: true,
      data: {
        repositories: result.repositories,
        hasMore: result.hasMore,
        page: query.page,
        perPage: query.perPage,
      },
    })
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: 'PROVIDER_ERROR',
        message: `Failed to fetch repositories: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
    }, 500)
  }
})

/**
 * GET /platforms/:id/organizations
 * 获取用户所属的组织列表
 */
platformRoutes.get('/:id/organizations', async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id
  const id = c.req.param('id')

  // 获取平台凭证
  const [platform] = await db
    .select()
    .from(platformCredentials)
    .where(and(
      eq(platformCredentials.id, id),
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

  try {
    const provider = createProvider({
      type: platform.provider as 'gitea' | 'gitlab',
      baseUrl: platform.baseUrl,
      token: platform.accessToken,
    })

    const organizations = await provider.listUserOrganizations()

    return c.json({
      success: true,
      data: organizations,
    })
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: 'PROVIDER_ERROR',
        message: `Failed to fetch organizations: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
    }, 500)
  }
})
