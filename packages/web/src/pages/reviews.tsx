import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FileSearch,
  ExternalLink,
  Eye,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  MessageSquare,
  Search,
  Calendar,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

import { useReviews, useReview, useRepositories } from '@/lib/hooks'
import type { ReviewStatus, ReviewDecision } from '@/lib/types'

// 状态配置
const statusConfig: Record<ReviewStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  pending: { label: '待处理', icon: Clock, className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  processing: { label: '处理中', icon: Loader2, className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  completed: { label: '已完成', icon: CheckCircle2, className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  failed: { label: '失败', icon: XCircle, className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
}

const decisionConfig: Record<ReviewDecision, { label: string; className: string }> = {
  APPROVED: { label: '批准', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  REQUEST_CHANGES: { label: '需要修改', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
  COMMENT: { label: '评论', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
}

export function ReviewsPage() {
  const { t } = useTranslation()
  const allFilterValue = '__all__'
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<{
    repositoryId?: string
    status?: ReviewStatus
    decision?: ReviewDecision
    prAuthor?: string
    startDate?: string
    endDate?: string
  }>({})
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)

  // API Queries
  const { data: reviewsData, isLoading } = useReviews({
    ...filters,
    page,
    limit: 20,
  })
  const { data: reposData } = useRepositories({})

  const reviews = reviewsData?.data?.items || []
  const pagination = reviewsData?.data?.pagination

  const hasActiveFilters = Object.values(filters).some(v => v)

  const clearFilters = () => {
    setFilters({})
    setPage(1)
  }

  const formatDuration = (ms: number | null) => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}min`
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('reviews.title')}</h1>
          <p className="text-muted-foreground">
            查看和管理所有 AI 代码审查记录
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索 PR 作者..."
                value={filters.prAuthor || ''}
                onChange={(e) => setFilters(f => ({ ...f, prAuthor: e.target.value || undefined }))}
                className="pl-9"
              />
            </div>

            <Select
              value={filters.repositoryId ?? allFilterValue}
              onValueChange={(v) =>
                setFilters(f => ({
                  ...f,
                  repositoryId: v === allFilterValue ? undefined : v,
                }))
              }
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="所有仓库" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={allFilterValue}>所有仓库</SelectItem>
                {reposData?.data?.map((repo) => (
                  <SelectItem key={repo.id} value={repo.id}>
                    {repo.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.status ?? allFilterValue}
              onValueChange={(v) =>
                setFilters(f => ({
                  ...f,
                  status: (v === allFilterValue ? undefined : v) as ReviewStatus | undefined,
                }))
              }
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="所有状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={allFilterValue}>所有状态</SelectItem>
                <SelectItem value="pending">待处理</SelectItem>
                <SelectItem value="processing">处理中</SelectItem>
                <SelectItem value="completed">已完成</SelectItem>
                <SelectItem value="failed">失败</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.decision ?? allFilterValue}
              onValueChange={(v) =>
                setFilters(f => ({
                  ...f,
                  decision: (v === allFilterValue ? undefined : v) as ReviewDecision | undefined,
                }))
              }
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="所有决策" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={allFilterValue}>所有决策</SelectItem>
                <SelectItem value="APPROVED">批准</SelectItem>
                <SelectItem value="REQUEST_CHANGES">需要修改</SelectItem>
                <SelectItem value="COMMENT">评论</SelectItem>
              </SelectContent>
            </Select>

            <Popover open={filterOpen} onOpenChange={setFilterOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon">
                  <Calendar className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="space-y-4">
                  <h4 className="font-medium">日期范围</h4>
                  <div className="grid gap-2">
                    <div className="space-y-1">
                      <Label>开始日期</Label>
                      <Input
                        type="date"
                        value={filters.startDate || ''}
                        onChange={(e) => setFilters(f => ({ ...f, startDate: e.target.value || undefined }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>结束日期</Label>
                      <Input
                        type="date"
                        value={filters.endDate || ''}
                        onChange={(e) => setFilters(f => ({ ...f, endDate: e.target.value || undefined }))}
                      />
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setFilters(f => ({ ...f, startDate: undefined, endDate: undefined }))
                      setFilterOpen(false)
                    }}
                  >
                    清除日期
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-1 h-4 w-4" />
                清除筛选
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                  <Skeleton className="h-6 w-16" />
                  <Skeleton className="h-6 w-20" />
                </div>
              ))}
            </div>
          ) : reviews.length === 0 ? (
            <EmptyState
              icon={FileSearch}
              title="暂无审查记录"
              description={hasActiveFilters ? '没有符合筛选条件的审查记录' : '当仓库收到 PR 时，审查记录将显示在这里'}
              action={
                hasActiveFilters ? (
                  <Button variant="outline" onClick={clearFilters}>
                    清除筛选条件
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pull Request</TableHead>
                    <TableHead>作者</TableHead>
                    <TableHead>{t('reviews.status')}</TableHead>
                    <TableHead>决策</TableHead>
                    <TableHead>评论数</TableHead>
                    <TableHead>耗时</TableHead>
                    <TableHead>{t('reviews.createdAt')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviews.map((review) => {
                    const StatusIcon = statusConfig[review.status].icon
                    return (
                      <TableRow key={review.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              #{review.prNumber}
                              <a
                                href={review.prUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </div>
                            <div className="text-sm text-muted-foreground truncate max-w-[300px]">
                              {review.prTitle}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{review.prAuthor}</span>
                        </TableCell>
                        <TableCell>
                          <Badge className={statusConfig[review.status].className}>
                            <StatusIcon className={`mr-1 h-3 w-3 ${review.status === 'processing' ? 'animate-spin' : ''}`} />
                            {statusConfig[review.status].label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {review.decision ? (
                            <Badge className={decisionConfig[review.decision].className}>
                              {decisionConfig[review.decision].label}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                            {review.commentsCount}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{formatDuration(review.durationMs)}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {formatDate(review.createdAt)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedReviewId(review.id)
                              setDetailOpen(true)
                            }}
                          >
                            <Eye className="mr-1 h-4 w-4" />
                            {t('reviews.viewDetails')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

              {/* Pagination */}
              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between border-t px-4 py-3">
                  <p className="text-sm text-muted-foreground">
                    共 {pagination.total} 条记录，第 {page} / {pagination.totalPages} 页
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                      disabled={page === pagination.totalPages}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Review Detail Dialog */}
      <ReviewDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        reviewId={selectedReviewId}
      />
    </div>
  )
}

// 审查详情对话框
function ReviewDetailDialog({
  open,
  onOpenChange,
  reviewId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  reviewId: string | null
}) {
  const { data, isLoading } = useReview(reviewId || '')
  const review = data?.data

  if (!reviewId) return null

  const formatDuration = (ms: number | null) => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}min`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            审查详情
            {review && (
              <a
                href={review.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </DialogTitle>
          <DialogDescription>
            {review?.prTitle}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : review ? (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-6 pr-4">
              {/* Meta Info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-muted-foreground">PR 编号</Label>
                  <p className="font-medium">#{review.prNumber}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">作者</Label>
                  <p className="font-medium">{review.prAuthor}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">状态</Label>
                  <Badge className={statusConfig[review.status].className + ' mt-1'}>
                    {statusConfig[review.status].label}
                  </Badge>
                </div>
                <div>
                  <Label className="text-muted-foreground">决策</Label>
                  {review.decision ? (
                    <Badge className={decisionConfig[review.decision].className + ' mt-1'}>
                      {decisionConfig[review.decision].label}
                    </Badge>
                  ) : (
                    <p className="text-muted-foreground">-</p>
                  )}
                </div>
                <div>
                  <Label className="text-muted-foreground">耗时</Label>
                  <p className="font-medium">{formatDuration(review.durationMs)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">模型</Label>
                  <p className="font-medium">{review.model || '-'}</p>
                </div>
              </div>

              <Separator />

              {/* Summary */}
              {review.summary && (
                <div>
                  <Label className="text-muted-foreground mb-2 block">审查摘要</Label>
                  <div className="rounded-lg border bg-muted/50 p-4 text-sm whitespace-pre-wrap">
                    {review.summary}
                  </div>
                </div>
              )}

              {/* Error */}
              {review.error && (
                <div>
                  <Label className="text-muted-foreground mb-2 block flex items-center gap-1">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    错误信息
                  </Label>
                  <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
                    {review.error}
                  </div>
                </div>
              )}

              {/* Comments */}
              {review.comments && review.comments.length > 0 && (
                <div>
                  <Label className="text-muted-foreground mb-2 block">
                    代码评论 ({review.comments.length})
                  </Label>
                  <div className="space-y-3">
                    {review.comments.map((comment, index) => (
                      <div key={index} className="rounded-lg border p-3 text-sm">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-xs">
                            {comment.category}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {comment.severity}
                          </Badge>
                          <span className="text-muted-foreground text-xs">
                            {comment.path}:{comment.line}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap">{comment.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
