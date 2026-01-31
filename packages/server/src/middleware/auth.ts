/// <reference path="../types/shims.d.ts" />
/**
 * 认证中间件
 */

import { Context, MiddlewareHandler } from 'hono'
import { eq, and, gte } from 'drizzle-orm'
import { createHash } from 'crypto'
import * as jose from 'jose'

import { getDatabase } from '../db/client'
import { users, apiKeys } from '../db/schema/index'

// JWT 密钥（从环境变量获取）
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'opencode-review-secret-change-in-production'
)

// 定义用户上下文类型
export interface AuthUser {
  id: string
  username: string
  email: string
  role: 'admin' | 'user'
}

// 扩展 Hono Context
declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
    authType: 'jwt' | 'apikey'
  }
}

/**
 * 生成 JWT Token
 */
export async function generateToken(user: AuthUser, expiresIn: string = '24h'): Promise<string> {
  const jwt = await new jose.SignJWT({
    sub: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(JWT_SECRET)

  return jwt
}

/**
 * 验证 JWT Token
 */
export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET)

    // 支持两种 token 格式：
    // 1. 完整用户信息（来自 generateToken）
    // 2. 简化格式（来自 auth.ts login，只有 sub 和 type）
    const userId = payload.sub as string
    
    return {
      id: userId,
      username: (payload.username as string) || userId,
      email: (payload.email as string) || `${userId}@local`,
      role: (payload.role as 'admin' | 'user') || (userId === 'admin' ? 'admin' : 'user'),
    }
  } catch {
    return null
  }
}

/**
 * 验证 API Key
 */
async function verifyApiKey(key: string, requiredScope?: string): Promise<AuthUser | null> {
  const db = getDatabase()
  
  // 计算哈希
  const keyHash = createHash('sha256').update(key).digest('hex')

  // 查找 API Key
  const apiKey = await db.select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .get()

  if (!apiKey) {
    return null
  }

  // 检查是否过期
  if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
    return null
  }

  // 检查作用域
  if (requiredScope && (!apiKey.scopes || !apiKey.scopes.includes(requiredScope as any))) {
    return null
  }

  // 更新最后使用时间
  await db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, apiKey.id))

  // 获取用户信息
  const user = await db.select()
    .from(users)
    .where(eq(users.id, apiKey.userId))
    .get()

  if (!user) {
    return null
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role as 'admin' | 'user',
  }
}

/**
 * 从请求中提取认证信息
 */
function extractAuthCredentials(c: Context): { type: 'jwt' | 'apikey', token: string } | null {
  const authHeader = c.req.header('Authorization')

  if (authHeader) {
    // Bearer Token (JWT)
    if (authHeader.startsWith('Bearer ')) {
      return { type: 'jwt', token: authHeader.substring(7) }
    }
    
    // API Key
    if (authHeader.startsWith('ApiKey ') || authHeader.startsWith('X-API-Key ')) {
      return { type: 'apikey', token: authHeader.split(' ')[1] }
    }
  }

  // X-API-Key header
  const apiKeyHeader = c.req.header('X-API-Key')
  if (apiKeyHeader) {
    return { type: 'apikey', token: apiKeyHeader }
  }

  // Query parameter (用于 Webhook 回调)
  const apiKeyQuery = c.req.query('api_key')
  if (apiKeyQuery) {
    return { type: 'apikey', token: apiKeyQuery }
  }

  return null
}

/**
 * 认证中间件
 * 支持 JWT 和 API Key 两种认证方式
 */
export const authMiddleware: MiddlewareHandler = async (c: any, next: any) => {
  const credentials = extractAuthCredentials(c)

  if (!credentials) {
    return c.json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    }, 401)
  }

  let user: AuthUser | null = null

  if (credentials.type === 'jwt') {
    user = await verifyToken(credentials.token)
  } else {
    user = await verifyApiKey(credentials.token)
  }

  if (!user) {
    return c.json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired credentials',
      },
    }, 401)
  }

  // 设置用户上下文
  c.set('user', user)
  c.set('authType', credentials.type)

  await next()
}

/**
 * 可选认证中间件
 * 如果提供了认证信息则验证，否则继续处理
 */
export const optionalAuthMiddleware: MiddlewareHandler = async (c: any, next: any) => {
  const credentials = extractAuthCredentials(c)

  if (credentials) {
    let user: AuthUser | null = null

    if (credentials.type === 'jwt') {
      user = await verifyToken(credentials.token)
    } else {
      user = await verifyApiKey(credentials.token)
    }

    if (user) {
      c.set('user', user)
      c.set('authType', credentials.type)
    }
  }

  await next()
}

/**
 * 管理员认证中间件
 */
export const adminMiddleware: MiddlewareHandler = async (c: any, next: any) => {
  const user = c.get('user')

  if (!user) {
    return c.json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    }, 401)
  }

  if (user.role !== 'admin') {
    return c.json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Admin access required',
      },
    }, 403)
  }

  await next()
}

/**
 * API Key 专用认证中间件
 * 用于 Webhook 端点
 */
export const apiKeyAuthMiddleware = (requiredScope: string): MiddlewareHandler => {
  return async (c: any, next: any) => {
    const credentials = extractAuthCredentials(c)

    if (!credentials) {
      return c.json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'API Key required',
        },
      }, 401)
    }

    // 只接受 API Key
    if (credentials.type !== 'apikey') {
      return c.json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'API Key required (JWT not accepted)',
        },
      }, 401)
    }

    const user = await verifyApiKey(credentials.token, requiredScope)

    if (!user) {
      return c.json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API Key or insufficient permissions',
        },
      }, 401)
    }

    c.set('user', user)
    c.set('authType', 'apikey')

    await next()
  }
}
