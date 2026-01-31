/// <reference path="../types/shims.d.ts" />
/**
 * 模板管理路由
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { eq, isNull, or } from 'drizzle-orm'
import { ulid } from 'ulid'

import { getDatabase } from '../db/client'
import { reviewTemplates } from '../db/schema/index'
import { authMiddleware } from '../middleware/auth'
import { getAllSystemTemplates } from '@opencode-review/core'

// 创建模板 Schema
const createTemplateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
  systemPrompt: z.string().min(1, 'System prompt is required'),
  categories: z.array(z.string()).optional(),
  severities: z.array(z.string()).optional(),
})

// 更新模板 Schema
const updateTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  systemPrompt: z.string().min(1).optional(),
  categories: z.array(z.string()).optional(),
  severities: z.array(z.string()).optional(),
  isDefault: z.boolean().optional(),
})
type CreateTemplateInput = z.infer<typeof createTemplateSchema>
type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>

export const templateRoutes = new Hono()

// 所有路由需要认证
templateRoutes.use('/*', authMiddleware)

/**
 * GET /templates
 * 获取模板列表
 */
templateRoutes.get('/', async (c: any) => {
  const db = getDatabase()
  const userId = c.get('user').id as string
  const includeSystem = c.req.query('includeSystem') !== 'false'

  // 获取系统模板
  const systemTemplates = includeSystem ? getAllSystemTemplates() : []

  // 获取用户模板
  const userTemplates = await db.select()
    .from(reviewTemplates)
    .where(eq(reviewTemplates.userId, userId))
    .all()

  const allTemplates = [
    ...systemTemplates.map((t: any) => ({
      ...t,
      userId: null,
      createdAt: null,
      updatedAt: null,
    })),
    ...userTemplates,
  ]

  return c.json({
    success: true,
    data: allTemplates.map((t: any) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      isSystem: t.isSystem,
      isDefault: t.isDefault,
      categories: t.categories,
      severities: t.severities,
      createdAt: t.createdAt,
    })),
  })
})

/**
 * POST /templates
 * 创建新模板
 */
templateRoutes.post('/', zValidator('json', createTemplateSchema), async (c: any) => {
  const db = getDatabase()
  const userId = c.get('user').id
  const body = c.req.valid('json') as CreateTemplateInput

  const id = ulid()
  
  await db.insert(reviewTemplates).values({
    id,
    userId,
    name: body.name,
    description: body.description,
    systemPrompt: body.systemPrompt,
    categories: body.categories || ['BUG', 'SECURITY', 'PERFORMANCE', 'STYLE'],
    severities: body.severities || ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
    isDefault: false,
    isSystem: false,
  })

  return c.json({
    success: true,
    data: {
      id,
      name: body.name,
    },
  }, 201)
})

/**
 * GET /templates/:id
 * 获取模板详情
 */
templateRoutes.get('/:id', async (c: any) => {
  const db = getDatabase()
  const id = c.req.param('id')

  // 检查是否是系统模板
  const systemTemplates = getAllSystemTemplates()
  const systemTemplate = systemTemplates.find(t => t.id === id)
  
  if (systemTemplate) {
    return c.json({
      success: true,
      data: systemTemplate,
    })
  }

  // 查询用户模板
  const template = await db.select()
    .from(reviewTemplates)
    .where(eq(reviewTemplates.id, id))
    .get()

  if (!template) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Template not found',
      },
    }, 404)
  }

  return c.json({
    success: true,
    data: template,
  })
})

/**
 * PUT /templates/:id
 * 更新模板
 */
templateRoutes.put('/:id', zValidator('json', updateTemplateSchema), async (c: any) => {
  const db = getDatabase()
  const id = c.req.param('id')
  const body = c.req.valid('json') as UpdateTemplateInput

  // 检查是否是系统模板
  const systemTemplates = getAllSystemTemplates()
  if (systemTemplates.some(t => t.id === id)) {
    return c.json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'System templates cannot be modified',
      },
    }, 403)
  }

  const existing = await db.select()
    .from(reviewTemplates)
    .where(eq(reviewTemplates.id, id))
    .get()

  if (!existing) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Template not found',
      },
    }, 404)
  }

  await db.update(reviewTemplates)
    .set({
      ...body,
      updatedAt: new Date(),
    })
    .where(eq(reviewTemplates.id, id))

  return c.json({
    success: true,
    data: {
      id,
      updated: true,
    },
  })
})

/**
 * DELETE /templates/:id
 * 删除模板
 */
templateRoutes.delete('/:id', async (c: any) => {
  const db = getDatabase()
  const id = c.req.param('id')

  // 检查是否是系统模板
  const systemTemplates = getAllSystemTemplates()
  if (systemTemplates.some(t => t.id === id)) {
    return c.json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'System templates cannot be deleted',
      },
    }, 403)
  }

  const existing = await db.select()
    .from(reviewTemplates)
    .where(eq(reviewTemplates.id, id))
    .get()

  if (!existing) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Template not found',
      },
    }, 404)
  }

  await db.delete(reviewTemplates).where(eq(reviewTemplates.id, id))

  return c.json({
    success: true,
    data: {
      id,
      deleted: true,
    },
  })
})

/**
 * POST /templates/:id/duplicate
 * 复制模板
 */
templateRoutes.post('/:id/duplicate', async (c: any) => {
  const db = getDatabase()
  const userId = c.get('user').id
  const id = c.req.param('id')

  // 获取源模板（可能是系统模板或用户模板）
  const systemTemplates = getAllSystemTemplates()
  let sourceTemplate: any = systemTemplates.find(t => t.id === id)
  
  if (!sourceTemplate) {
    const userTemplate = await db.select()
      .from(reviewTemplates)
      .where(eq(reviewTemplates.id, id))
      .get()
    
    if (userTemplate) {
      sourceTemplate = {
        ...userTemplate,
        description: userTemplate.description ?? undefined,
        isSystem: false,
        isDefault: false,
      }
    }
  }

  if (!sourceTemplate) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Template not found',
      },
    }, 404)
  }

  const newId = ulid()
  
  await db.insert(reviewTemplates).values({
    id: newId,
    userId,
    name: `${sourceTemplate.name} (副本)`,
    description: sourceTemplate.description,
    systemPrompt: sourceTemplate.systemPrompt,
    categories: sourceTemplate.categories,
    severities: sourceTemplate.severities,
    isDefault: false,
    isSystem: false,
  })

  return c.json({
    success: true,
    data: {
      id: newId,
      name: `${sourceTemplate.name} (副本)`,
    },
  }, 201)
})
