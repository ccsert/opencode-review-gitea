import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  GitBranch,
  FileSearch,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  ArrowRight,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

import { useReviewStats, useReviews, useRepositories } from '@/lib/hooks'
import type { ReviewStatus, ReviewDecision } from '@/lib/types'

// 状态配置
const statusConfig: Record<ReviewStatus, { icon: typeof CheckCircle2; className: string }> = {
  pending: { icon: Clock, className: 'text-yellow-500' },
  processing: { icon: Clock, className: 'text-blue-500 animate-pulse' },
  completed: { icon: CheckCircle2, className: 'text-green-500' },
  failed: { icon: XCircle, className: 'text-red-500' },
}

const decisionLabels: Record<ReviewDecision, string> = {
  APPROVED: '批准',
  REQUEST_CHANGES: '需要修改',
  COMMENT: '评论',
}

export function DashboardPage() {
  const { t } = useTranslation()

  // API Queries
  const { data: statsData, isLoading: statsLoading } = useReviewStats()
  const { data: reposData, isLoading: reposLoading } = useRepositories({ pageSize: 5 })
  const { data: reviewsData, isLoading: reviewsLoading } = useReviews({ limit: 5 })

  const stats = statsData?.data
  const repos = reposData?.data || []
  const recentReviews = reviewsData?.data?.items || []

  // 计算成功率
  const successRate = stats
    ? stats.total > 0
      ? Math.round((stats.completed / stats.total) * 100)
      : 0
    : 0

  const formatDuration = (ms: number | null | undefined) => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}min`
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('dashboard.title')}</h1>
        <p className="text-muted-foreground">{t('app.description')}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t('dashboard.totalReviews')}
            </CardTitle>
            <FileSearch className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.total || 0}</div>
                <p className="text-xs text-muted-foreground">
                  {stats?.pending || 0} 待处理
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t('dashboard.totalRepositories')}
            </CardTitle>
            <GitBranch className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {reposLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">{repos.length}</div>
                <p className="text-xs text-muted-foreground">
                  {repos.filter((r) => r.enabled).length} 已启用
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">成功率</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">{successRate}%</div>
                <p className="text-xs text-muted-foreground">
                  {stats?.completed || 0} 成功 / {stats?.failed || 0} 失败
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">平均耗时</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {formatDuration(stats?.avgDuration)}
                </div>
                <p className="text-xs text-muted-foreground">每次审查</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Decision Distribution */}
      {stats && stats.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">决策分布</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-green-500" />
                <span className="text-sm">批准: {stats.byDecision.APPROVE || 0}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-orange-500" />
                <span className="text-sm">需要修改: {stats.byDecision.REQUEST_CHANGES || 0}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-blue-500" />
                <span className="text-sm">评论: {stats.byDecision.COMMENT || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Reviews */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>{t('dashboard.recentReviews')}</CardTitle>
              <CardDescription>最近的 AI 代码审查记录</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/reviews">
                查看全部
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {reviewsLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 rounded" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : recentReviews.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                暂无审查记录
              </div>
            ) : (
              <div className="space-y-4">
                {recentReviews.map((review) => {
                  const StatusIcon = statusConfig[review.status].icon
                  return (
                    <div
                      key={review.id}
                      className="flex items-center gap-3 rounded-lg border p-3"
                    >
                      <StatusIcon
                        className={`h-5 w-5 ${statusConfig[review.status].className}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">#{review.prNumber}</span>
                          {review.decision && (
                            <Badge variant="secondary" className="text-xs">
                              {decisionLabels[review.decision]}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {review.prTitle}
                        </p>
                      </div>
                      <a
                        href={review.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Repositories */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>仓库概览</CardTitle>
              <CardDescription>已连接的代码仓库状态</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/repositories">
                管理仓库
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {reposLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 rounded" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : repos.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 text-muted-foreground">
                <GitBranch className="h-8 w-8" />
                <p>暂无仓库</p>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/repositories">添加仓库</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {repos.slice(0, 5).map((repo) => (
                  <div
                    key={repo.id}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                      <GitBranch className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{repo.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {repo.reviewCount} 次审查
                      </p>
                    </div>
                    <Badge variant={repo.enabled ? 'default' : 'secondary'}>
                      {repo.enabled ? '已启用' : '已禁用'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
