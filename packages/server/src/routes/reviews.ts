/**
 * Review 历史路由
 */

import { Hono } from 'hono'
import { eq, desc, and, gte, lte, like, sql } from 'drizzle-orm'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

import { getDatabase } from '../db/client'
import { reviews, repositories } from '../db/schema/index'
import { authMiddleware } from '../middleware/auth'

export const reviewRoutes = new Hono()

// 所有路由需要认证
reviewRoutes.use('/*', authMiddleware)

/**
 * GET /reviews
 * 获取 Review 列表
 */
reviewRoutes.get(
  '/',
  zValidator('query', z.object({
    repositoryId: z.string().optional(),
    status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
    decision: z.enum(['APPROVED', 'REQUEST_CHANGES', 'COMMENT']).optional(),
    prAuthor: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
  })),
  async (c) => {
    const db = getDatabase()
    const query = c.req.valid('query')
    const user = c.get('user')

    // 构建查询条件
    const conditions: any[] = []

    // 获取用户有权限的仓库
    const userRepos = await db.select()
      .from(repositories)
      .where(eq(repositories.userId, user.id))

    const repoIds = userRepos.map(r => r.id)
    
    if (query.repositoryId) {
      if (!repoIds.includes(query.repositoryId)) {
        return c.json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'No access to this repository',
          },
        }, 403)
      }
      conditions.push(eq(reviews.repositoryId, query.repositoryId))
    } else {
      // 只返回用户仓库的 Reviews
      conditions.push(sql`${reviews.repositoryId} IN (${sql.join(repoIds.map(id => sql`${id}`), sql`, `)})`)
    }

    if (query.status) {
      conditions.push(eq(reviews.status, query.status))
    }

    if (query.decision) {
      conditions.push(eq(reviews.decision, query.decision))
    }

    if (query.prAuthor) {
      conditions.push(like(reviews.prAuthor, `%${query.prAuthor}%`))
    }

    if (query.startDate) {
      conditions.push(gte(reviews.createdAt, new Date(query.startDate)))
    }

    if (query.endDate) {
      conditions.push(lte(reviews.createdAt, new Date(query.endDate)))
    }

    const offset = (query.page - 1) * query.limit

    // 获取总数
    const countResult = await db.select({ count: sql<number>`count(*)` })
      .from(reviews)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .get()

    const total = countResult?.count || 0

    // 获取数据
    const items = await db.select({
      id: reviews.id,
      repositoryId: reviews.repositoryId,
      prNumber: reviews.prNumber,
      prTitle: reviews.prTitle,
      prAuthor: reviews.prAuthor,
      prUrl: reviews.prUrl,
      status: reviews.status,
      decision: reviews.decision,
      commentsCount: reviews.commentsCount,
      model: reviews.model,
      durationMs: reviews.durationMs,
      triggeredBy: reviews.triggeredBy,
      createdAt: reviews.createdAt,
      completedAt: reviews.completedAt,
    })
      .from(reviews)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(reviews.createdAt))
      .limit(query.limit)
      .offset(offset)

    return c.json({
      success: true,
      data: {
        items,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      },
    })
  }
)

/**
 * GET /reviews/stats
 * 获取 Review 统计
 */
reviewRoutes.get('/stats', async (c) => {
  const db = getDatabase()
  const user = c.get('user')

  // 获取用户仓库
  const userRepos = await db.select()
    .from(repositories)
    .where(eq(repositories.userId, user.id))

  const repoIds = userRepos.map(r => r.id)

  if (repoIds.length === 0) {
    return c.json({
      success: true,
      data: {
        total: 0,
        completed: 0,
        failed: 0,
        pending: 0,
        avgDuration: 0,
        byDecision: {
          APPROVE: 0,
          REQUEST_CHANGES: 0,
          COMMENT: 0,
        },
        last7Days: [],
      },
    })
  }

  const repoCondition = sql`${reviews.repositoryId} IN (${sql.join(repoIds.map(id => sql`${id}`), sql`, `)})`

  // 总数统计
  const totalStats = await db.select({
    total: sql<number>`count(*)`,
    completed: sql<number>`sum(case when ${reviews.status} = 'completed' then 1 else 0 end)`,
    failed: sql<number>`sum(case when ${reviews.status} = 'failed' then 1 else 0 end)`,
    pending: sql<number>`sum(case when ${reviews.status} in ('pending', 'processing') then 1 else 0 end)`,
    avgDuration: sql<number>`avg(${reviews.durationMs})`,
  })
    .from(reviews)
    .where(repoCondition)
    .get()

  // 决策分布
  const decisionStats = await db.select({
    decision: reviews.decision,
    count: sql<number>`count(*)`,
  })
    .from(reviews)
    .where(and(repoCondition, eq(reviews.status, 'completed')))
    .groupBy(reviews.decision)

  const byDecision = {
    APPROVE: 0,
    REQUEST_CHANGES: 0,
    COMMENT: 0,
  }
  
  for (const stat of decisionStats) {
    if (stat.decision && stat.decision in byDecision) {
      byDecision[stat.decision as keyof typeof byDecision] = stat.count
    }
  }

  // 最近 7 天趋势
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const dailyStats = await db.select({
    date: sql<string>`date(${reviews.createdAt})`,
    count: sql<number>`count(*)`,
  })
    .from(reviews)
    .where(and(repoCondition, gte(reviews.createdAt, sevenDaysAgo)))
    .groupBy(sql`date(${reviews.createdAt})`)
    .orderBy(sql`date(${reviews.createdAt})`)

  return c.json({
    success: true,
    data: {
      total: totalStats?.total || 0,
      completed: totalStats?.completed || 0,
      failed: totalStats?.failed || 0,
      pending: totalStats?.pending || 0,
      avgDuration: Math.round(totalStats?.avgDuration || 0),
      byDecision,
      last7Days: dailyStats,
    },
  })
})

/**
 * GET /reviews/:id
 * 获取单个 Review 详情
 */
reviewRoutes.get('/:id', async (c) => {
  const db = getDatabase()
  const { id } = c.req.param()
  const user = c.get('user')

  const review = await db.select()
    .from(reviews)
    .where(eq(reviews.id, id))
    .get()

  if (!review) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Review not found',
      },
    }, 404)
  }

  // 检查权限
  const repo = await db.select()
    .from(repositories)
    .where(eq(repositories.id, review.repositoryId))
    .get()

  if (!repo || repo.userId !== user.id) {
    return c.json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'No access to this review',
      },
    }, 403)
  }

  return c.json({
    success: true,
    data: review,
  })
})

/**
 * POST /reviews/:id/retry
 * 重试失败的 Review
 */
reviewRoutes.post('/:id/retry', async (c) => {
  const db = getDatabase()
  const { id } = c.req.param()
  const user = c.get('user')

  const review = await db.select()
    .from(reviews)
    .where(eq(reviews.id, id))
    .get()

  if (!review) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Review not found',
      },
    }, 404)
  }

  // 检查权限
  const repo = await db.select()
    .from(repositories)
    .where(eq(repositories.id, review.repositoryId))
    .get()

  if (!repo || repo.userId !== user.id) {
    return c.json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'No access to this review',
      },
    }, 403)
  }

  if (review.status !== 'failed') {
    return c.json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Only failed reviews can be retried',
      },
    }, 400)
  }

  // 重置状态
  await db.update(reviews)
    .set({
      status: 'pending',
      error: null,
      summary: null,
      decision: null,
      commentsCount: 0,
      durationMs: null,
      completedAt: null,
    })
    .where(eq(reviews.id, id))

  // TODO: 触发重新执行 Review

  return c.json({
    success: true,
    data: {
      id,
      status: 'pending',
      message: 'Review retry scheduled',
    },
  })
})

/**
 * DELETE /reviews/:id
 * 删除 Review 记录
 */
reviewRoutes.delete('/:id', async (c) => {
  const db = getDatabase()
  const { id } = c.req.param()
  const user = c.get('user')

  const review = await db.select()
    .from(reviews)
    .where(eq(reviews.id, id))
    .get()

  if (!review) {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Review not found',
      },
    }, 404)
  }

  // 检查权限
  const repo = await db.select()
    .from(repositories)
    .where(eq(repositories.id, review.repositoryId))
    .get()

  if (!repo || repo.userId !== user.id) {
    return c.json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'No access to this review',
      },
    }, 403)
  }

  await db.delete(reviews).where(eq(reviews.id, id))

  return c.json({
    success: true,
    data: { deleted: true },
  })
})
