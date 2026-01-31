/// <reference path="../types/shims.d.ts" />
/**
 * 认证路由
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import * as jose from 'jose'
import { createHash } from 'crypto'

// 使用与 middleware/auth.ts 相同的密钥
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'opencode-review-secret-change-in-production'
)
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin'
const ACCESS_TOKEN_EXPIRES = 15 * 60 // 15 分钟
const REFRESH_TOKEN_EXPIRES = 7 * 24 * 60 * 60 // 7 天

// 登录请求 Schema
const loginSchema = z.object({
  secret: z.string().min(1, 'Secret is required'),
})

// 刷新 Token Schema
const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
})

export const authRoutes = new Hono()

/**
 * POST /auth/login
 * 用户登录（密钥认证）
 */
authRoutes.post('/login', zValidator('json', loginSchema), async (c: any) => {
  const { secret } = c.req.valid('json')
  
  // 验证管理员密钥
  if (secret !== ADMIN_SECRET) {
    return c.json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid secret',
      },
    }, 401)
  }

  const userId = 'admin' // 单用户模式

  // 生成 Access Token（使用 jose）
  const accessToken = await new jose.SignJWT({
    sub: userId,
    type: 'access',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_EXPIRES}s`)
    .sign(JWT_SECRET)

  // 生成 Refresh Token
  const refreshToken = await new jose.SignJWT({
    sub: userId,
    type: 'refresh',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TOKEN_EXPIRES}s`)
    .sign(JWT_SECRET)

  return c.json({
    success: true,
    data: {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRES,
    },
  })
})

/**
 * POST /auth/refresh
 * 刷新访问令牌
 */
authRoutes.post('/refresh', zValidator('json', refreshSchema), async (c: any) => {
  const { refreshToken } = c.req.valid('json')
  
  try {
    const { payload } = await jose.jwtVerify(refreshToken, JWT_SECRET)
    
    if (payload.type !== 'refresh') {
      throw new Error('Invalid token type')
    }

    const userId = payload.sub as string

    // 生成新的 Access Token
    const accessToken = await new jose.SignJWT({
      sub: userId,
      type: 'access',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_EXPIRES}s`)
      .sign(JWT_SECRET)

    return c.json({
      success: true,
      data: {
        accessToken,
        expiresIn: ACCESS_TOKEN_EXPIRES,
      },
    })
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired refresh token',
      },
    }, 401)
  }
})

/**
 * POST /auth/logout
 * 登出（客户端删除 token 即可）
 */
authRoutes.post('/logout', async (c: any) => {
  // JWT 无状态，登出由客户端删除 token
  // 后续可以添加 token 黑名单机制
  return c.json({
    success: true,
    data: {
      message: 'Logged out successfully',
    },
  })
})

/**
 * GET /auth/me
 * 获取当前用户信息
 */
authRoutes.get('/me', async (c: any) => {
  const authHeader = c.req.header('Authorization')
  
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid Authorization header',
      },
    }, 401)
  }

  const token = authHeader.slice(7)
  
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET)
    
    if (payload.type !== 'access') {
      throw new Error('Invalid token type')
    }

    return c.json({
      success: true,
      data: {
        id: payload.sub,
        role: 'admin',
      },
    })
  } catch (error) {
    return c.json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
      },
    }, 401)
  }
})
