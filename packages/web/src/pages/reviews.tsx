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
const statusConfigBase: Record<ReviewStatus, { icon: typeof CheckCircle2; className: string }> = {
  pending: { icon: Clock, className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  processing: { icon: Loader2, className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  completed: { icon: CheckCircle2, className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  failed: { icon: XCircle, className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
}

const decisionConfigBase: Record<ReviewDecision, { className: string }> = {
  APPROVED: { className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  REQUEST_CHANGES: { className: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
  COMMENT: { className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
}

export function ReviewsPage() {
  const { t } = useTranslation()
  
  // Get localized labels
  const getStatusLabel = (status: ReviewStatus) => t(`reviews.statuses.${status}`)
  const getDecisionLabel = (decision: ReviewDecision) => t(`reviews.decisions.${decision}`)
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
            {t('reviews.description')}
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
                placeholder={t('reviews.searchPlaceholder')}
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
                <SelectValue placeholder={t('reviews.allRepositories')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={allFilterValue}>{t('reviews.allRepositories')}</SelectItem>
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
                <SelectValue placeholder={t('reviews.allStatuses')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={allFilterValue}>{t('reviews.allStatuses')}</SelectItem>
                <SelectItem value="pending">{t('reviews.statuses.pending')}</SelectItem>
                <SelectItem value="processing">{t('reviews.statuses.processing')}</SelectItem>
                <SelectItem value="completed">{t('reviews.statuses.completed')}</SelectItem>
                <SelectItem value="failed">{t('reviews.statuses.failed')}</SelectItem>
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
                <SelectValue placeholder={t('reviews.allDecisions')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={allFilterValue}>{t('reviews.allDecisions')}</SelectItem>
                <SelectItem value="APPROVED">{t('reviews.decisions.APPROVED')}</SelectItem>
                <SelectItem value="REQUEST_CHANGES">{t('reviews.decisions.REQUEST_CHANGES')}</SelectItem>
                <SelectItem value="COMMENT">{t('reviews.decisions.COMMENT')}</SelectItem>
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
                  <h4 className="font-medium">{t('reviews.dateRange')}</h4>
                  <div className="grid gap-2">
                    <div className="space-y-1">
                      <Label>{t('reviews.startDate')}</Label>
                      <Input
                        type="date"
                        value={filters.startDate || ''}
                        onChange={(e) => setFilters(f => ({ ...f, startDate: e.target.value || undefined }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('reviews.endDate')}</Label>
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
                    {t('reviews.clearDate')}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-1 h-4 w-4" />
                {t('reviews.clearFilters')}
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
              title={t('reviews.emptyTitle')}
              description={hasActiveFilters ? t('reviews.emptyFilterDescription') : t('reviews.emptyDescription')}
              action={
                hasActiveFilters ? (
                  <Button variant="outline" onClick={clearFilters}>
                    {t('reviews.clearFilters')}
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
                    <TableHead>{t('reviews.author')}</TableHead>
                    <TableHead>{t('reviews.status')}</TableHead>
                    <TableHead>{t('reviews.decision')}</TableHead>
                    <TableHead>{t('reviews.commentCount')}</TableHead>
                    <TableHead>{t('reviews.duration')}</TableHead>
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
                          <Badge className={statusConfigBase[review.status].className}>
                            <StatusIcon className={`mr-1 h-3 w-3 ${review.status === 'processing' ? 'animate-spin' : ''}`} />
                            {getStatusLabel(review.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {review.decision ? (
                            <Badge className={decisionConfigBase[review.decision].className}>
                              {getDecisionLabel(review.decision)}
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
                    {t('reviews.pagination.total', { 
                      count: pagination.total, 
                      page, 
                      totalPages: pagination.totalPages 
                    })}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      {t('reviews.pagination.previous')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                      disabled={page === pagination.totalPages}
                    >
                      {t('reviews.pagination.next')}
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
  const { t } = useTranslation()
  const { data, isLoading } = useReview(reviewId || '')
  const review = data?.data

  // Get localized labels
  const getStatusLabel = (status: ReviewStatus) => t(`reviews.statuses.${status}`)
  const getDecisionLabel = (decision: ReviewDecision) => t(`reviews.decisions.${decision}`)

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
            {t('reviews.detailTitle')}
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
                  <Label className="text-muted-foreground">{t('reviews.prNumber')}</Label>
                  <p className="font-medium">#{review.prNumber}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t('reviews.author')}</Label>
                  <p className="font-medium">{review.prAuthor}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t('reviews.status')}</Label>
                  <Badge className={statusConfigBase[review.status].className + ' mt-1'}>
                    {getStatusLabel(review.status)}
                  </Badge>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t('reviews.decision')}</Label>
                  {review.decision ? (
                    <Badge className={decisionConfigBase[review.decision].className + ' mt-1'}>
                      {getDecisionLabel(review.decision)}
                    </Badge>
                  ) : (
                    <p className="text-muted-foreground">-</p>
                  )}
                </div>
                <div>
                  <Label className="text-muted-foreground">{t('reviews.duration')}</Label>
                  <p className="font-medium">{formatDuration(review.durationMs)}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t('reviews.model')}</Label>
                  <p className="font-medium">{review.model || '-'}</p>
                </div>
              </div>

              <Separator />

              {/* Summary */}
              {review.summary && (
                <div>
                  <Label className="text-muted-foreground mb-2 block">{t('reviews.reviewSummary')}</Label>
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
                    {t('reviews.errorMessage')}
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
                    {t('reviews.codeComments', { count: review.comments.length })}
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
