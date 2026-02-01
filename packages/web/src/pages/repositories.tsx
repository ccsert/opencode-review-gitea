import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Plus,
  GitBranch,
  MoreHorizontal,
  Copy,
  ExternalLink,
  Trash2,
  Settings,
  RefreshCw,
  Check,
  Search,
  Loader2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import {
  useRepositories,
  useRepository,
  useCreateRepository,
  useUpdateRepository,
  useDeleteRepository,
  useTestRepositoryConnection,
  useTemplates,
} from '@/lib/hooks'
import type { Repository, ProviderType } from '@/lib/types'

// 创建仓库表单 Schema
const createRepoSchema = z.object({
  provider: z.enum(['gitea', 'github', 'gitlab']),
  url: z.string().url('请输入有效的仓库 URL'),
  accessToken: z.string().min(1, '请输入访问令牌'),
  webhookSecret: z.string().optional(),
  templateId: z.string().optional(),
  autoReview: z.boolean(),
})

type CreateRepoFormData = z.input<typeof createRepoSchema>

// Provider 图标和颜色
const providerConfig: Record<ProviderType, { label: string; color: string }> = {
  gitea: { label: 'Gitea', color: 'bg-green-500' },
  github: { label: 'GitHub', color: 'bg-gray-800' },
  gitlab: { label: 'GitLab', color: 'bg-orange-500' },
}

const ALL_PROVIDER_VALUE = '__all__'
const DEFAULT_TEMPLATE_VALUE = '__default__'

export function RepositoriesPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState<string>(ALL_PROVIDER_VALUE)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [webhookDialogOpen, setWebhookDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)

  // API Queries
  const { data: reposData, isLoading } = useRepositories({
    page,
    pageSize: 20,
    provider: providerFilter === ALL_PROVIDER_VALUE ? undefined : providerFilter,
    search: search || undefined,
  })

  const { data: templatesData } = useTemplates()
  const createMutation = useCreateRepository()
  const updateMutation = useUpdateRepository()
  const deleteMutation = useDeleteRepository()
  const testConnectionMutation = useTestRepositoryConnection()

  // Form
  const form = useForm<CreateRepoFormData>({
    resolver: zodResolver(createRepoSchema),
    defaultValues: {
      provider: 'gitea',
      url: '',
      accessToken: '',
      webhookSecret: '',
      templateId: '',
      autoReview: true,
    },
  })

  const handleCreate = async (data: CreateRepoFormData) => {
    try {
      const result = await createMutation.mutateAsync({
        provider: data.provider,
        url: data.url,
        accessToken: data.accessToken,
        webhookSecret: data.webhookSecret || undefined,
        templateId: data.templateId || undefined,
        config: {
          autoReview: data.autoReview,
        },
      })

      if (result.success) {
        toast.success('仓库添加成功', {
          description: `Webhook URL 已复制到剪贴板`,
        })
        // 复制 Webhook URL
        if (result.data.webhookUrl) {
          navigator.clipboard.writeText(result.data.webhookUrl)
        }
        setAddDialogOpen(false)
        form.reset()
      }
    } catch (err) {
      toast.error('添加仓库失败', {
        description: err instanceof Error ? err.message : '未知错误',
      })
    }
  }

  const handleToggleEnabled = async (repo: Repository) => {
    try {
      await updateMutation.mutateAsync({
        id: repo.id,
        data: { enabled: !repo.enabled },
      })
      toast.success(repo.enabled ? '已禁用仓库' : '已启用仓库')
    } catch {
      toast.error('操作失败')
    }
  }

  const handleDelete = async () => {
    if (!selectedRepo) return

    try {
      await deleteMutation.mutateAsync(selectedRepo.id)
      toast.success('仓库已删除')
      setDeleteDialogOpen(false)
      setSelectedRepo(null)
    } catch {
      toast.error('删除失败')
    }
  }

  const handleTestConnection = async (id: string) => {
    try {
      await testConnectionMutation.mutateAsync(id)
      toast.success('连接测试成功')
    } catch (err) {
      toast.error('连接测试失败', {
        description: err instanceof Error ? err.message : '无法连接到仓库',
      })
    }
  }

  const repos = reposData?.data || []
  const pagination = reposData?.pagination

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('repositories.title')}</h1>
          <p className="text-muted-foreground">
            管理您连接的代码仓库，配置自动审查选项
          </p>
        </div>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {t('repositories.addRepository')}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{t('repositories.addRepository')}</DialogTitle>
              <DialogDescription>
                连接一个新的仓库以启用 AI 代码审查功能
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(handleCreate)} className="space-y-4">
              <div className="space-y-2">
                <Label>{t('repositories.provider')}</Label>
                <Select
                  value={form.watch('provider')}
                  onValueChange={(v) => form.setValue('provider', v as ProviderType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gitea">Gitea</SelectItem>
                    <SelectItem value="github">GitHub</SelectItem>
                    <SelectItem value="gitlab">GitLab</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t('repositories.url')}</Label>
                <Input
                  placeholder="https://gitea.example.com/owner/repo"
                  {...form.register('url')}
                />
                {form.formState.errors.url && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.url.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>访问令牌 (Access Token)</Label>
                <Input
                  type="password"
                  placeholder="ghp_xxxx 或 glpat-xxxx"
                  {...form.register('accessToken')}
                />
                {form.formState.errors.accessToken && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.accessToken.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  需要 repo 或 api 权限
                </p>
              </div>

              <div className="space-y-2">
                <Label>审查模板 (可选)</Label>
                <Select
                  value={form.watch('templateId') || DEFAULT_TEMPLATE_VALUE}
                  onValueChange={(v) =>
                    form.setValue('templateId', v === DEFAULT_TEMPLATE_VALUE ? '' : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="使用默认模板" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_TEMPLATE_VALUE}>使用默认模板</SelectItem>
                    {templatesData?.data?.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                        {template.isSystem && ' (系统)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>自动审查</Label>
                  <p className="text-xs text-muted-foreground">
                    接收到 Webhook 时自动开始代码审查
                  </p>
                </div>
                <Switch
                  checked={form.watch('autoReview')}
                  onCheckedChange={(v) => form.setValue('autoReview', v)}
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAddDialogOpen(false)}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {t('common.create')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索仓库..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="所有平台" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PROVIDER_VALUE}>所有平台</SelectItem>
                <SelectItem value="gitea">Gitea</SelectItem>
                <SelectItem value="github">GitHub</SelectItem>
                <SelectItem value="gitlab">GitLab</SelectItem>
              </SelectContent>
            </Select>
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
                  <Skeleton className="h-10 w-10 rounded" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                </div>
              ))}
            </div>
          ) : repos.length === 0 ? (
            <EmptyState
              icon={GitBranch}
              title="暂无仓库"
              description="添加您的第一个代码仓库以开始使用 AI 代码审查"
              action={
                <Button onClick={() => setAddDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  添加仓库
                </Button>
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>仓库</TableHead>
                    <TableHead>平台</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>审查次数</TableHead>
                    <TableHead>最后审查</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {repos.map((repo) => (
                    <TableRow key={repo.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded bg-muted">
                            <GitBranch className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="font-medium">{repo.name}</div>
                            <a
                              href={repo.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
                            >
                              {new URL(repo.url).host}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`${providerConfig[repo.provider].color} text-white`}
                        >
                          {providerConfig[repo.provider].label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={repo.enabled ? 'default' : 'secondary'}>
                          {repo.enabled ? t('repositories.active') : t('repositories.inactive')}
                        </Badge>
                      </TableCell>
                      <TableCell>{repo.reviewCount}</TableCell>
                      <TableCell>
                        {repo.lastReviewAt
                          ? new Date(repo.lastReviewAt).toLocaleDateString()
                          : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedRepo(repo)
                                setWebhookDialogOpen(true)
                              }}
                            >
                              <Copy className="mr-2 h-4 w-4" />
                              Webhook 配置
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleTestConnection(repo.id)}
                            >
                              <RefreshCw className="mr-2 h-4 w-4" />
                              测试连接
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleToggleEnabled(repo)}
                            >
                              {repo.enabled ? (
                                <>
                                  <Check className="mr-2 h-4 w-4" />
                                  禁用
                                </>
                              ) : (
                                <>
                                  <Check className="mr-2 h-4 w-4" />
                                  启用
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedRepo(repo)
                                setEditDialogOpen(true)
                              }}
                            >
                              <Settings className="mr-2 h-4 w-4" />
                              设置
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                setSelectedRepo(repo)
                                setDeleteDialogOpen(true)
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              {t('common.delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between border-t px-4 py-3">
                  <p className="text-sm text-muted-foreground">
                    共 {pagination.total} 个仓库，第 {page} / {pagination.totalPages} 页
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

      {/* Webhook Dialog */}
      <WebhookDialog
        open={webhookDialogOpen}
        onOpenChange={setWebhookDialogOpen}
        repoId={selectedRepo?.id}
      />

      {/* Edit Dialog */}
      <EditRepoDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        repo={selectedRepo}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="删除仓库"
        description={`确定要删除仓库 "${selectedRepo?.name}" 吗？此操作不可撤销，所有相关的审查记录将被保留。`}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}

// Webhook 配置对话框
function WebhookDialog({
  open,
  onOpenChange,
  repoId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId?: string
}) {
  const { data, isLoading } = useRepository(repoId || '')

  const repo = data?.data

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast.success(`${label} 已复制到剪贴板`)
  }

  if (!repoId) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Webhook 配置</DialogTitle>
          <DialogDescription>
            在您的仓库中配置 Webhook 以启用自动代码审查
          </DialogDescription>
        </DialogHeader>
        
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : repo ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Webhook URL</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={repo.webhookUrl || ''}
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(repo.webhookUrl || '', 'Webhook URL')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Webhook Secret</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={repo.webhookSecret || ''}
                  type="password"
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(repo.webhookSecret || '', 'Webhook Secret')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/50 p-4 text-sm">
              <p className="font-medium mb-2">配置说明:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>进入仓库设置 → Webhooks</li>
                <li>添加新的 Webhook</li>
                <li>粘贴上述 URL 和 Secret</li>
                <li>选择触发事件: Pull Request</li>
                <li>Content Type: application/json</li>
              </ol>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 编辑仓库对话框
function EditRepoDialog({
  open,
  onOpenChange,
  repo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  repo: Repository | null
}) {
  const { t } = useTranslation()
  const { data: templatesData } = useTemplates()
  const updateMutation = useUpdateRepository()
  
  const [templateId, setTemplateId] = useState(repo?.templateId || '')
  const [autoReview, setAutoReview] = useState(true)

  const handleSave = async () => {
    if (!repo) return

    try {
      await updateMutation.mutateAsync({
        id: repo.id,
        data: {
          templateId: templateId || null,
          config: {
            autoReview,
          },
        },
      })
      toast.success('设置已保存')
      onOpenChange(false)
    } catch {
      toast.error('保存失败')
    }
  }

  if (!repo) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>仓库设置</DialogTitle>
          <DialogDescription>
            配置 {repo.name} 的审查选项
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>审查模板</Label>
            <Select
              value={templateId || DEFAULT_TEMPLATE_VALUE}
              onValueChange={(v) => setTemplateId(v === DEFAULT_TEMPLATE_VALUE ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="使用默认模板" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_TEMPLATE_VALUE}>使用默认模板</SelectItem>
                {templatesData?.data?.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                    {template.isSystem && ' (系统)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label>自动审查</Label>
              <p className="text-xs text-muted-foreground">
                接收到 Webhook 时自动开始代码审查
              </p>
            </div>
            <Switch checked={autoReview} onCheckedChange={setAutoReview} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
