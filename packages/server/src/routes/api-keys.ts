/**
 * API Key 管理路由
 */

import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { ulid } from 'ulid'
import { createHash, randomBytes } from 'crypto'

import { getDatabase } from '../db/client'
import { apiKeys } from '../db/schema/index'
import { authMiddleware } from '../middleware/auth'

export const apiKeyRoutes = new Hono()

// 所有路由需要认证
apiKeyRoutes.use('/*', authMiddleware)

/**
 * 生成 API Key
 * 格式: ocr_{random_32_chars}
 */
function generateApiKey(): string {
  const random = randomBytes(24).toString('base64url')
  return `ocr_${random}`
}

/**
 * 对 API Key 进行哈希（存储时只存哈希值）
 */
function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * GET /api-keys
 * 获取用户的所有 API Key
 */
apiKeyRoutes.get('/', async (c) => {
  const db = getDatabase()
  const user = c.get('user')

  const keys = await db.select({
    id: apiKeys.id,
    name: apiKeys.name,
    prefix: apiKeys.keyPrefix,
    scopes: apiKeys.scopes,
    expiresAt: apiKeys.expiresAt,
    lastUsedAt: apiKeys.lastUsedAt,
    createdAt: apiKeys.createdAt,
  })
    .from(apiKeys)
    .where(eq(apiKeys.userId, user.id))
    .orderBy(desc(apiKeys.createdAt))

  return c.json({
    success: true,
    data: keys,
  })
})

/**
 * POST /api-keys
 * 创建新 API Key
 */
apiKeyRoutes.post(
  '/',
  zValidator('json', z.object({
    name: z.string().min(1).max(100),
    scopes: z.array(z.enum(['webhook', 'read', 'write', 'admin'])).default(['webhook']),
    expiresInDays: z.number().min(1).max(365).optional(),
  })),
  async (c) => {
    const db = getDatabase()
    const user = c.get('user')
    const body = c.req.valid('json')

    // 生成 API Key
    const plainKey = generateApiKey()
    const keyHash = hashApiKey(plainKey)
    const prefix = plainKey.substring(0, 10) // ocr_XXXX

    // 计算过期时间
    let expiresAt: Date | undefined
    if (body.expiresInDays) {
      expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + body.expiresInDays)
    }

    const id = ulid()
    await db.insert(apiKeys).values({
      id,
      userId: user.id,
      name: body.name,
      keyHash,
      keyPrefix: prefix,
      scopes: body.scopes as any,
      expiresAt,
    })

    // 只有创建时返回完整的 Key，之后无法再查看
    return c.json({
      success: true,
      data: {
        id,
        name: body.name,
        key: plainKey, // 仅此一次显示
        prefix,
        scopes: body.scopes,
        expiresAt,
        warning: 'This is the only time you will see this key. Please save it securely.',
      },
    }, 201)
  }
)

/**
 * GET /api-keys/:id
 * 获取单个 API Key 信息（不含完整 key）
 */
apiKeyRoutes.get('/:id', async (c) => {
  const db = getDatabase()
  const { id } = c.req.param()
  const user = c.get('user')

  const key = await db.select({
    id: apiKeys.id,
    name: apiKeys.name,
    prefix: apiKeys.keyPrefix,
    scopes: apiKeys.scopes,
    expiresAt: apiKeys.expiresAt,
    lastUsedAt: apiKeys.lastUsedAt,
    createdAt: apiKeys.createdAt,
  })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)))
    .get()

  if (!key) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'API key not found',
      },
    }, 404)
  }

  return c.json({
    success: true,
    data: key,
  })
})

/**
 * PATCH /api-keys/:id
 * 更新 API Key（只能更新名称和作用域）
 */
apiKeyRoutes.patch(
  '/:id',
  zValidator('json', z.object({
    name: z.string().min(1).max(100).optional(),
    scopes: z.array(z.enum(['webhook', 'read', 'write', 'admin'])).optional(),
  })),
  async (c) => {
    const db = getDatabase()
    const { id } = c.req.param()
    const user = c.get('user')
    const body = c.req.valid('json')

    const existing = await db.select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)))
      .get()

    if (!existing) {
      return c.json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'API key not found',
        },
      }, 404)
    }

    const updates: Partial<typeof apiKeys.$inferInsert> = {
    }

    if (body.name !== undefined) {
      updates.name = body.name
    }

    if (body.scopes !== undefined) {
      updates.scopes = body.scopes as any
    }

    await db.update(apiKeys)
      .set(updates)
      .where(eq(apiKeys.id, id))

    return c.json({
      success: true,
      data: {
        id,
        name: body.name ?? existing.name,
        prefix: existing.keyPrefix,
        scopes: body.scopes ?? existing.scopes,
        expiresAt: existing.expiresAt,
        lastUsedAt: existing.lastUsedAt,
        createdAt: existing.createdAt,
        updatedAt: updates.lastUsedAt,
      },
    })
  }
)

/**
 * DELETE /api-keys/:id
 * 删除（撤销）API Key
 */
apiKeyRoutes.delete('/:id', async (c) => {
  const db = getDatabase()
  const { id } = c.req.param()
  const user = c.get('user')

  const existing = await db.select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)))
    .get()

  if (!existing) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'API key not found',
      },
    }, 404)
  }

  await db.delete(apiKeys).where(eq(apiKeys.id, id))

  return c.json({
    success: true,
    data: { deleted: true },
  })
})

/**
 * POST /api-keys/:id/regenerate
 * 重新生成 API Key（旧的将失效）
 */
apiKeyRoutes.post('/:id/regenerate', async (c) => {
  const db = getDatabase()
  const { id } = c.req.param()
  const user = c.get('user')

  const existing = await db.select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id)))
    .get()

  if (!existing) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'API key not found',
      },
    }, 404)
  }

  // 生成新的 Key
  const plainKey = generateApiKey()
  const keyHash = hashApiKey(plainKey)
  const prefix = plainKey.substring(0, 10)

  await db.update(apiKeys)
    .set({
      keyHash,
      keyPrefix: prefix,
      lastUsedAt: null,
    })
    .where(eq(apiKeys.id, id))

  return c.json({
    success: true,
    data: {
      id,
      name: existing.name,
      key: plainKey, // 仅此一次显示
      prefix,
      scopes: existing.scopes,
      expiresAt: existing.expiresAt,
      warning: 'This is the only time you will see this key. Please save it securely.',
    },
  })
})
