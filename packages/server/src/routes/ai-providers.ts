/**
 * AI 供应商管理路由
 * 用于管理用户的 AI 供应商配置（API Key、模型选择等）
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { eq, and, desc } from 'drizzle-orm'
import { ulid } from 'ulid'

import { getDatabase } from '../db/client'
import { aiProviders, PREDEFINED_PROVIDERS, type PredefinedProviderKey } from '../db/schema/index'
import { authMiddleware } from '../middleware/auth'

// ============ Schema 定义 ============

// 创建 AI 供应商 Schema
const createProviderSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name too long'),
  provider: z.enum(['openai', 'anthropic', 'deepseek', 'openrouter', 'ollama', 'custom']),
  baseUrl: z.string().url('Invalid URL').optional().or(z.literal('')),
  apiKey: z.string().optional(),
  models: z.array(z.string()).optional(),
  defaultModel: z.string().optional(),
  isDefault: z.boolean().optional(),
  config: z.object({
    maxTokens: z.number().optional(),
    temperature: z.number().min(0).max(2).optional(),
    timeout: z.number().optional(),
  }).passthrough().optional(),
})
type CreateProviderInput = z.infer<typeof createProviderSchema>

// 更新 AI 供应商 Schema
const updateProviderSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  baseUrl: z.string().url('Invalid URL').optional().or(z.literal('')),
  apiKey: z.string().optional(),
  models: z.array(z.string()).optional(),
  defaultModel: z.string().optional(),
  isDefault: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
  config: z.object({
    maxTokens: z.number().optional(),
    temperature: z.number().min(0).max(2).optional(),
    timeout: z.number().optional(),
  }).passthrough().optional(),
})
type UpdateProviderInput = z.infer<typeof updateProviderSchema>

// 测试连接 Schema
const testConnectionSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'deepseek', 'openrouter', 'ollama', 'custom']),
  baseUrl: z.string().url('Invalid URL').optional().or(z.literal('')),
  apiKey: z.string().optional(),
  model: z.string().optional(),
})

export const aiProviderRoutes = new Hono()

// 所有路由需要认证
aiProviderRoutes.use('/*', authMiddleware)

/**
 * GET /ai-providers/presets
 * 获取预定义的 AI 供应商列表
 */
aiProviderRoutes.get('/presets', async (c) => {
  const presets = Object.entries(PREDEFINED_PROVIDERS).map(([key, value]) => ({
    id: key,
    ...value,
  }))

  return c.json({
    success: true,
    data: presets,
  })
})

/**
 * GET /ai-providers
 * 获取用户配置的 AI 供应商列表
 */
aiProviderRoutes.get('/', async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id

  const providers = await db
    .select({
      id: aiProviders.id,
      name: aiProviders.name,
      provider: aiProviders.provider,
      baseUrl: aiProviders.baseUrl,
      models: aiProviders.models,
      defaultModel: aiProviders.defaultModel,
      isDefault: aiProviders.isDefault,
      isEnabled: aiProviders.isEnabled,
      config: aiProviders.config,
      lastUsedAt: aiProviders.lastUsedAt,
      createdAt: aiProviders.createdAt,
    })
    .from(aiProviders)
    .where(eq(aiProviders.userId, userId))
    .orderBy(desc(aiProviders.isDefault), desc(aiProviders.createdAt))

  return c.json({
    success: true,
    data: providers,
  })
})

/**
 * GET /ai-providers/default
 * 获取用户的默认 AI 供应商配置
 */
aiProviderRoutes.get('/default', async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id

  // 先查找标记为默认的供应商
  let [provider] = await db
    .select()
    .from(aiProviders)
    .where(and(
      eq(aiProviders.userId, userId),
      eq(aiProviders.isDefault, true),
      eq(aiProviders.isEnabled, true)
    ))
    .limit(1)

  // 如果没有默认的，返回第一个启用的
  if (!provider) {
    [provider] = await db
      .select()
      .from(aiProviders)
      .where(and(
        eq(aiProviders.userId, userId),
        eq(aiProviders.isEnabled, true)
      ))
      .orderBy(desc(aiProviders.createdAt))
      .limit(1)
  }

  if (!provider) {
    return c.json({
      success: false,
      error: {
        code: 'NO_PROVIDER',
        message: 'No AI provider configured. Please add one in Settings > AI Providers.',
      },
    }, 404)
  }

  return c.json({
    success: true,
    data: {
      id: provider.id,
      name: provider.name,
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey, // 在实际调用时需要
      defaultModel: provider.defaultModel,
      config: provider.config,
    },
  })
})

/**
 * POST /ai-providers
 * 添加新的 AI 供应商配置
 */
aiProviderRoutes.post('/', zValidator('json', createProviderSchema), async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id
  const body = c.req.valid<CreateProviderInput>('json')

  // 获取预设配置
  const preset = PREDEFINED_PROVIDERS[body.provider as PredefinedProviderKey]
  
  // 使用预设的 baseUrl，如果用户没有提供
  const baseUrl = body.baseUrl || preset?.baseUrl || ''
  
  // 合并模型列表
  const models = body.models?.length 
    ? body.models 
    : (preset?.models ? [...preset.models] : [])

  const id = ulid()

  // 如果设置为默认，先取消其他默认
  if (body.isDefault) {
    await db
      .update(aiProviders)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(
        eq(aiProviders.userId, userId),
        eq(aiProviders.isDefault, true)
      ))
  }

  // TODO: 实现 API Key 加密存储
  await db.insert(aiProviders).values({
    id,
    userId,
    name: body.name,
    provider: body.provider,
    baseUrl,
    apiKey: body.apiKey || null,
    models,
    defaultModel: body.defaultModel || models[0] || null,
    isDefault: body.isDefault || false,
    isEnabled: true,
    config: body.config || {},
  })

  return c.json({
    success: true,
    data: {
      id,
      name: body.name,
      provider: body.provider,
      baseUrl,
      models,
      defaultModel: body.defaultModel || models[0] || null,
      isDefault: body.isDefault || false,
    },
  }, 201)
})

/**
 * GET /ai-providers/:id
 * 获取 AI 供应商详情
 */
aiProviderRoutes.get('/:id', async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id
  const id = c.req.param('id')

  const [provider] = await db
    .select({
      id: aiProviders.id,
      name: aiProviders.name,
      provider: aiProviders.provider,
      baseUrl: aiProviders.baseUrl,
      models: aiProviders.models,
      defaultModel: aiProviders.defaultModel,
      isDefault: aiProviders.isDefault,
      isEnabled: aiProviders.isEnabled,
      config: aiProviders.config,
      lastUsedAt: aiProviders.lastUsedAt,
      createdAt: aiProviders.createdAt,
    })
    .from(aiProviders)
    .where(and(
      eq(aiProviders.id, id),
      eq(aiProviders.userId, userId)
    ))

  if (!provider) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'AI provider not found',
      },
    }, 404)
  }

  return c.json({
    success: true,
    data: provider,
  })
})

/**
 * PUT /ai-providers/:id
 * 更新 AI 供应商配置
 */
aiProviderRoutes.put('/:id', zValidator('json', updateProviderSchema), async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id
  const id = c.req.param('id')
  const body = c.req.valid<UpdateProviderInput>('json')

  // 检查是否存在
  const [existing] = await db
    .select({ id: aiProviders.id })
    .from(aiProviders)
    .where(and(
      eq(aiProviders.id, id),
      eq(aiProviders.userId, userId)
    ))

  if (!existing) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'AI provider not found',
      },
    }, 404)
  }

  // 如果设置为默认，先取消其他默认
  if (body.isDefault) {
    await db
      .update(aiProviders)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(
        eq(aiProviders.userId, userId),
        eq(aiProviders.isDefault, true)
      ))
  }

  // 构建更新对象
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  }

  if (body.name !== undefined) updateData.name = body.name
  if (body.baseUrl !== undefined) updateData.baseUrl = body.baseUrl
  if (body.apiKey !== undefined) updateData.apiKey = body.apiKey
  if (body.models !== undefined) updateData.models = body.models
  if (body.defaultModel !== undefined) updateData.defaultModel = body.defaultModel
  if (body.isDefault !== undefined) updateData.isDefault = body.isDefault
  if (body.isEnabled !== undefined) updateData.isEnabled = body.isEnabled
  if (body.config !== undefined) updateData.config = body.config

  await db
    .update(aiProviders)
    .set(updateData)
    .where(eq(aiProviders.id, id))

  return c.json({
    success: true,
    data: { id, ...body },
  })
})

/**
 * DELETE /ai-providers/:id
 * 删除 AI 供应商配置
 */
aiProviderRoutes.delete('/:id', async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id
  const id = c.req.param('id')

  const result = await db
    .delete(aiProviders)
    .where(and(
      eq(aiProviders.id, id),
      eq(aiProviders.userId, userId)
    ))
    .returning({ id: aiProviders.id })

  if (result.length === 0) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'AI provider not found',
      },
    }, 404)
  }

  return c.json({
    success: true,
    data: { id },
  })
})

/**
 * POST /ai-providers/test
 * 测试 AI 供应商连接
 */
aiProviderRoutes.post('/test', zValidator('json', testConnectionSchema), async (c) => {
  const body = c.req.valid<z.infer<typeof testConnectionSchema>>('json')

  // 获取预设配置
  const preset = PREDEFINED_PROVIDERS[body.provider as PredefinedProviderKey]
  const baseUrl = body.baseUrl || preset?.baseUrl || ''

  try {
    // 根据不同供应商测试连接
    if (body.provider === 'ollama') {
      // Ollama 测试：检查 /api/tags 端点
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      })
      
      if (!response.ok) {
        throw new Error(`Ollama server returned ${response.status}`)
      }
      
      const data = await response.json() as { models?: Array<{ name: string }> }
      const models = data.models?.map(m => m.name) || []
      
      return c.json({
        success: true,
        data: {
          connected: true,
          models,
          message: `Connected to Ollama. Found ${models.length} models.`,
        },
      })
    } else {
      // OpenAI 兼容 API 测试：检查 /models 端点
      if (!body.apiKey) {
        return c.json({
          success: false,
          error: {
            code: 'MISSING_API_KEY',
            message: 'API Key is required for this provider',
          },
        }, 400)
      }

      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${body.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API returned ${response.status}: ${errorText.substring(0, 200)}`)
      }

      const data = await response.json() as { data?: Array<{ id: string }> }
      const models = data.data?.map(m => m.id) || []

      return c.json({
        success: true,
        data: {
          connected: true,
          models: models.slice(0, 20), // 限制返回的模型数量
          message: `Connected successfully. Found ${models.length} models.`,
        },
      })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    
    return c.json({
      success: false,
      error: {
        code: 'CONNECTION_FAILED',
        message: `Failed to connect: ${message}`,
      },
    }, 400)
  }
})

/**
 * POST /ai-providers/:id/set-default
 * 设置为默认供应商
 */
aiProviderRoutes.post('/:id/set-default', async (c) => {
  const db = getDatabase()
  const userId = c.get('user').id
  const id = c.req.param('id')

  // 检查是否存在
  const [existing] = await db
    .select({ id: aiProviders.id })
    .from(aiProviders)
    .where(and(
      eq(aiProviders.id, id),
      eq(aiProviders.userId, userId)
    ))

  if (!existing) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'AI provider not found',
      },
    }, 404)
  }

  // 取消其他默认
  await db
    .update(aiProviders)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(
      eq(aiProviders.userId, userId),
      eq(aiProviders.isDefault, true)
    ))

  // 设置新默认
  await db
    .update(aiProviders)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(eq(aiProviders.id, id))

  return c.json({
    success: true,
    data: { id, isDefault: true },
  })
})
