/**
 * 错误处理中间件
 */

import { Context, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'

/**
 * API 错误类
 */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public details?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }

  static badRequest(message: string, code: string = 'BAD_REQUEST') {
    return new ApiError(code, message, 400)
  }

  static unauthorized(message: string = 'Unauthorized') {
    return new ApiError('UNAUTHORIZED', message, 401)
  }

  static forbidden(message: string = 'Forbidden') {
    return new ApiError('FORBIDDEN', message, 403)
  }

  static notFound(message: string = 'Not found') {
    return new ApiError('NOT_FOUND', message, 404)
  }

  static conflict(message: string) {
    return new ApiError('CONFLICT', message, 409)
  }

  static tooManyRequests(message: string = 'Too many requests') {
    return new ApiError('TOO_MANY_REQUESTS', message, 429)
  }

  static internal(message: string = 'Internal server error') {
    return new ApiError('INTERNAL_ERROR', message, 500)
  }
}

/**
 * 格式化 Zod 验证错误
 */
function formatZodError(error: ZodError): { field: string; message: string }[] {
  return error.errors.map((e) => ({
    field: e.path.join('.'),
    message: e.message,
  }))
}

/**
 * 全局错误处理中间件
 */
export const errorMiddleware: MiddlewareHandler = async (c, next) => {
  try {
    await next()
  } catch (error) {
    console.error('[Error]', error)

    // API 错误
    if (error instanceof ApiError) {
      return c.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        },
        error.statusCode as any
      )
    }

    // Zod 验证错误
    if (error instanceof ZodError) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: formatZodError(error),
          },
        },
        400
      )
    }

    // Hono HTTP 异常
    if (error instanceof HTTPException) {
      return c.json(
        {
          success: false,
          error: {
            code: 'HTTP_ERROR',
            message: error.message,
          },
        },
        error.status
      )
    }

    // 未知错误
    const isDev = process.env.NODE_ENV !== 'production'
    return c.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: isDev && error instanceof Error ? error.message : 'Internal server error',
          stack: isDev && error instanceof Error ? error.stack : undefined,
        },
      },
      500
    )
  }
}

/**
 * 404 处理
 */
export const notFoundHandler = (c: Context) => {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
    },
    404
  )
}

/**
 * 请求日志中间件
 */
export const loggerMiddleware: MiddlewareHandler = async (c, next) => {
  const start = Date.now()
  const method = c.req.method
  const path = c.req.path

  await next()

  const duration = Date.now() - start
  const status = c.res.status

  // 根据状态码选择日志级别
  const logLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
  
  const logMessage = `${method} ${path} ${status} ${duration}ms`
  
  if (logLevel === 'error') {
    console.error(`[HTTP] ${logMessage}`)
  } else if (logLevel === 'warn') {
    console.warn(`[HTTP] ${logMessage}`)
  } else {
    console.log(`[HTTP] ${logMessage}`)
  }
}

/**
 * 请求 ID 中间件
 */
export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
  const requestId = c.req.header('X-Request-ID') || crypto.randomUUID()
  c.res.headers.set('X-Request-ID', requestId)
  await next()
}

/**
 * CORS 配置
 */
export const corsConfig = {
  origin: (origin: string) => {
    // 允许的来源
    const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000']
    
    // 开发环境允许所有来源
    if (process.env.NODE_ENV !== 'production') {
      return origin
    }
    
    return allowedOrigins.includes(origin) ? origin : null
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
  exposeHeaders: ['X-Request-ID'],
  maxAge: 86400,
  credentials: true,
}
