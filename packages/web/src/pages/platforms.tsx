import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Plus,
  Server,
  MoreHorizontal,
  Trash2,
  GitBranch,
  Loader2,
  RefreshCw,
  Building2,
  Lock,
  ChevronRight,
  Import,
  Copy,
  Check,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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


import {
  usePlatforms,
  useCreatePlatform,
  useDeletePlatform,
  usePlatformRepositories,
  usePlatformOrganizations,
  useImportRepositories,
} from '@/lib/hooks'
import type { Platform, RemoteRepository, ProviderType, ImportResult } from '@/lib/types'

// 导入结果项类型
type ImportResultItem = ImportResult['results'][0]

// 创建平台凭证表单 Schema
const createPlatformSchema = (t: (key: string, options?: Record<string, unknown>) => string) => z.object({
  provider: z.enum(['gitea', 'gitlab']),
  baseUrl: z.string().url(t('platforms.validation.baseUrlInvalid')),
  name: z.string().min(1, t('platforms.validation.nameRequired')).max(50, t('platforms.validation.nameTooLong')),
  accessToken: z.string().min(1, t('platforms.validation.accessTokenRequired')),
})

type CreatePlatformFormData = z.input<ReturnType<typeof createPlatformSchema>>

// Provider 配置
const providerConfig: Record<ProviderType, { label: string; color: string; icon: string }> = {
  gitea: { label: 'Gitea', color: 'bg-green-500', icon: '🍵' },
  github: { label: 'GitHub', color: 'bg-gray-800', icon: '🐙' },
  gitlab: { label: 'GitLab', color: 'bg-orange-500', icon: '🦊' },
}

const ALL_ORG_VALUE = '__all__'

export function PlatformsPage() {
  const { t } = useTranslation()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importResultDialogOpen, setImportResultDialogOpen] = useState(false)
  const [importResults, setImportResults] = useState<ImportResultItem[]>([])
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null)
  const [selectedOrg, setSelectedOrg] = useState<string>(ALL_ORG_VALUE)
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set())
  const [repoPage, setRepoPage] = useState(1)

  // API Queries
  const { data: platformsData, isLoading } = usePlatforms()
  const createMutation = useCreatePlatform()
  const deleteMutation = useDeletePlatform()
  const importMutation = useImportRepositories()

  // 当选择平台时获取仓库和组织列表
  const { data: reposData, isLoading: isLoadingRepos, refetch: refetchRepos } = usePlatformRepositories({
    id: selectedPlatform?.id || '',
    page: repoPage,
    perPage: 50,
    org: selectedOrg === ALL_ORG_VALUE ? undefined : selectedOrg,
  })

  const { data: orgsData } = usePlatformOrganizations(selectedPlatform?.id || '')

  // Form
  const form = useForm<CreatePlatformFormData>({
    resolver: zodResolver(createPlatformSchema(t)),
    defaultValues: {
      provider: 'gitea',
      baseUrl: '',
      name: '',
      accessToken: '',
    },
  })

  const platforms = platformsData?.data || []
  const repositories = reposData?.data?.repositories || []
  const organizations = orgsData?.data || []
  const hasMore = reposData?.data?.hasMore || false

  const handleCreate = async (data: CreatePlatformFormData) => {
    try {
      const result = await createMutation.mutateAsync(data)
      if (result.success) {
        toast.success(t('platforms.addSuccess'), {
          description: t('platforms.addSuccessDescription'),
        })
        setAddDialogOpen(false)
        form.reset()
      }
    } catch (error) {
      toast.error(t('platforms.addFailed'), {
        description: error instanceof Error ? error.message : t('platforms.addFailedDescription'),
      })
    }
  }

  const handleDelete = async () => {
    if (!selectedPlatform) return
    
    try {
      await deleteMutation.mutateAsync(selectedPlatform.id)
      toast.success(t('platforms.deleteSuccess'))
      setDeleteDialogOpen(false)
      setSelectedPlatform(null)
    } catch (error) {
      toast.error(t('platforms.deleteFailed'), {
        description: error instanceof Error ? error.message : t('common.unknownError'),
      })
    }
  }

  const handleOpenImport = (platform: Platform) => {
    setSelectedPlatform(platform)
    setSelectedOrg(ALL_ORG_VALUE)
    setSelectedRepos(new Set())
    setRepoPage(1)
    setImportDialogOpen(true)
  }

  const handleToggleRepo = (repo: RemoteRepository) => {
    const key = `${repo.fullName}|${repo.url}`
    const newSelected = new Set(selectedRepos)
    if (newSelected.has(key)) {
      newSelected.delete(key)
    } else {
      newSelected.add(key)
    }
    setSelectedRepos(newSelected)
  }

  const handleSelectAll = () => {
    if (selectedRepos.size === repositories.length) {
      setSelectedRepos(new Set())
    } else {
      const allKeys = repositories.map(r => `${r.fullName}|${r.url}`)
      setSelectedRepos(new Set(allKeys))
    }
  }

  const handleImport = async () => {
    if (!selectedPlatform || selectedRepos.size === 0) return

    const reposToImport = Array.from(selectedRepos).map(key => {
      const [fullName, url] = key.split('|')
      return { fullName, url }
    })

    try {
      const result = await importMutation.mutateAsync({
        platformCredentialId: selectedPlatform.id,
        repositories: reposToImport,
      })

      if (result.success) {
        const { imported, failed, results } = result.data
        
        // 保存结果并显示配置对话框
        const successResults = results.filter(r => r.success)
        if (successResults.length > 0) {
          setImportResults(successResults)
          setImportResultDialogOpen(true)
        }
        
        if (failed > 0) {
          toast.warning(t('platforms.importCompleted', { imported, failed }), {
            description: t('platforms.importPartialDescription'),
          })
        } else {
          toast.success(t('platforms.importSuccess', { imported }))
        }
        setImportDialogOpen(false)
        setSelectedRepos(new Set())
      }
    } catch (error) {
      toast.error(t('platforms.importFailed'), {
        description: error instanceof Error ? error.message : t('common.unknownError'),
      })
    }
  }
  
  const handleCopy = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedField(field)
    toast.success(t('common.copiedToClipboard'))
    setTimeout(() => setCopiedField(null), 2000)
  }

  const handleOrgChange = (org: string) => {
    setSelectedOrg(org)
    setRepoPage(1)
    setSelectedRepos(new Set())
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('platforms.title')}</h1>
          <p className="text-muted-foreground">
            {t('platforms.description')}
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t('platforms.addPlatform')}
        </Button>
      </div>

      {/* 平台列表 */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-48" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : platforms.length === 0 ? (
        <EmptyState
          icon={Server}
          title={t('platforms.emptyTitle')}
          description={t('platforms.emptyDescription')}
          action={
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t('platforms.addPlatform')}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {platforms.map((platform) => (
            <Card key={platform.id} className="relative">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">
                      {providerConfig[platform.provider]?.icon || '📦'}
                    </span>
                    <div>
                      <CardTitle className="text-lg">{platform.name}</CardTitle>
                      <CardDescription className="text-xs truncate max-w-50">
                        {platform.baseUrl}
                      </CardDescription>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleOpenImport(platform)}>
                        <Import className="mr-2 h-4 w-4" />
                        {t('platforms.importRepositories')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                          setSelectedPlatform(platform)
                          setDeleteDialogOpen(true)
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('common.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <Badge variant="secondary">
                    {providerConfig[platform.provider]?.label || platform.provider}
                  </Badge>
                  <span>
                    {platform.lastUsedAt 
                      ? t('platforms.lastUsed', { date: new Date(platform.lastUsedAt).toLocaleDateString() })
                      : t('platforms.neverUsed')
                    }
                  </span>
                </div>
                <Button
                  className="w-full mt-4"
                  variant="outline"
                  onClick={() => handleOpenImport(platform)}
                >
                  <GitBranch className="mr-2 h-4 w-4" />
                  {t('platforms.selectRepositories')}
                  <ChevronRight className="ml-auto h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 添加平台对话框 */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-125">
          <DialogHeader>
            <DialogTitle>{t('platforms.addDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('platforms.addDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(handleCreate)}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="provider">{t('platforms.providerType')}</Label>
                <Select
                  value={form.watch('provider')}
                  onValueChange={(v) => form.setValue('provider', v as 'gitea' | 'gitlab')}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('platforms.selectProviderType')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gitea">
                      <span className="flex items-center gap-2">
                        🍵 Gitea
                      </span>
                    </SelectItem>
                    <SelectItem value="gitlab">
                      <span className="flex items-center gap-2">
                        🦊 GitLab
                      </span>
                    </SelectItem>
                    {/* GitHub 暂不支持 */}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="name">{t('platforms.name')}</Label>
                <Input
                  id="name"
                  placeholder={t('platforms.namePlaceholder')}
                  {...form.register('name')}
                />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="baseUrl">{t('platforms.baseUrl')}</Label>
                <Input
                  id="baseUrl"
                  placeholder={t('platforms.baseUrlPlaceholder')}
                  {...form.register('baseUrl')}
                />
                {form.formState.errors.baseUrl && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.baseUrl.message}
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="accessToken">{t('platforms.accessToken')}</Label>
                <Input
                  id="accessToken"
                  type="password"
                  placeholder={t('platforms.accessTokenPlaceholder')}
                  {...form.register('accessToken')}
                />
                {form.formState.errors.accessToken && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.accessToken.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {t('platforms.accessTokenHint')}
                </p>
              </div>
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
                {t('platforms.addPlatform')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 导入仓库对话框 */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-175 max-h-[80vh]">
          <DialogHeader className="flex items-center gap-2">
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              {t('platforms.selectRepositoriesTitle')}
            </DialogTitle>
            <DialogDescription>
              {selectedPlatform && (
                <span className="flex items-center gap-1">
                  {t('platforms.selectRepositoriesFrom', { name: selectedPlatform.name })}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* 组织筛选 */}
            {organizations.length > 0 && (
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <Select value={selectedOrg} onValueChange={handleOrgChange}>
                  <SelectTrigger className="w-50">
                    <SelectValue placeholder={t('platforms.selectOrganization')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_ORG_VALUE}>{t('platforms.allRepositories')}</SelectItem>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.name}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => refetchRepos()}
                  disabled={isLoadingRepos}
                >
                  <RefreshCw className={`h-4 w-4 ${isLoadingRepos ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            )}

            {/* 仓库列表 */}
            <ScrollArea className="h-100 rounded-md border p-4">
              {isLoadingRepos ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-4 w-4" />
                      <Skeleton className="h-4 w-48" />
                    </div>
                  ))}
                </div>
              ) : repositories.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <GitBranch className="h-8 w-8 mb-2" />
                  <p>{t('platforms.noRepositoriesFound')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* 全选 */}
                  <div className="flex items-center gap-2 pb-2 border-b mb-2">
                    <Checkbox
                      id="selectAll"
                      checked={selectedRepos.size === repositories.length && repositories.length > 0}
                      onCheckedChange={handleSelectAll}
                    />
                    <Label htmlFor="selectAll" className="text-sm font-medium cursor-pointer">
                      {t('platforms.selectAll', { selected: selectedRepos.size, total: repositories.length })}
                    </Label>
                  </div>

                  {repositories.map((repo) => {
                    const key = `${repo.fullName}|${repo.url}`
                    const isSelected = selectedRepos.has(key)
                    
                    return (
                      <div
                        key={repo.id}
                        className={`flex items-center gap-3 p-2 rounded-md cursor-pointer hover:bg-muted/50 ${
                          isSelected ? 'bg-muted' : ''
                        }`}
                        onClick={() => handleToggleRepo(repo)}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleToggleRepo(repo)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{repo.fullName}</span>
                            {repo.private && (
                              <Lock className="h-3 w-3 text-muted-foreground" />
                            )}
                          </div>
                          {repo.description && (
                            <p className="text-xs text-muted-foreground truncate">
                              {repo.description}
                            </p>
                          )}
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {repo.defaultBranch}
                        </Badge>
                      </div>
                    )
                  })}

                  {/* 加载更多 */}
                  {hasMore && (
                    <Button
                      variant="ghost"
                      className="w-full mt-2"
                      onClick={() => setRepoPage(p => p + 1)}
                      disabled={isLoadingRepos}
                    >
                      {t('platforms.loadMore')}
                    </Button>
                  )}
                </div>
              )}
            </ScrollArea>
          </div>

          <DialogFooter>
            <div className="flex items-center justify-between w-full">
              <span className="text-sm text-muted-foreground">
                {t('platforms.selectedRepositories', { count: selectedRepos.size })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setImportDialogOpen(false)}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={selectedRepos.size === 0 || importMutation.isPending}
                >
                  {importMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {t('platforms.importSelected', { count: selectedRepos.size })}
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('platforms.deleteTitle')}
        description={t('platforms.deleteDescription', { name: selectedPlatform?.name || '' })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
      />

      {/* 导入结果对话框 - 显示 Webhook 配置信息 */}
      <Dialog open={importResultDialogOpen} onOpenChange={setImportResultDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-500" />
              {t('platforms.webhookConfigTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('platforms.webhookConfigDescription')}
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-4">
              {importResults.map((result, index) => (
                <Card key={result.id || index}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <GitBranch className="h-4 w-4" />
                      {result.fullName}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Webhook URL */}
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Webhook URL</Label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 px-3 py-2 bg-muted rounded text-sm break-all">
                          {result.webhookUrl}
                        </code>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopy(result.webhookUrl || '', `url-${index}`)}
                        >
                          {copiedField === `url-${index}` ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                    
                    {/* Webhook Secret */}
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Webhook Secret</Label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 px-3 py-2 bg-muted rounded text-sm font-mono">
                          {result.webhookSecret}
                        </code>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopy(result.webhookSecret || '', `secret-${index}`)}
                        >
                          {copiedField === `secret-${index}` ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                    
                    {/* 配置说明 */}
                    <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                      <p className="font-medium mb-1">{t('platforms.webhookSetupSteps')}</p>
                      <ol className="list-decimal list-inside space-y-0.5">
                        <li>{t('platforms.webhookStep1')}</li>
                        <li>{t('platforms.webhookStep2')}</li>
                        <li>{t('platforms.webhookStep3')}</li>
                        <li>{t('platforms.webhookStep4')}</li>
                        <li>{t('platforms.webhookStep5')}</li>
                      </ol>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
          
          <DialogFooter>
            <Button onClick={() => setImportResultDialogOpen(false)}>
              {t('platforms.done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
