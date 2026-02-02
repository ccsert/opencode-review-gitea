import { useState } from 'react'
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
import type { Platform, RemoteRepository, ProviderType } from '@/lib/types'

// 创建平台凭证表单 Schema
const createPlatformSchema = z.object({
  provider: z.enum(['gitea']),
  baseUrl: z.string().url('请输入有效的平台地址'),
  name: z.string().min(1, '请输入平台名称').max(50, '名称过长'),
  accessToken: z.string().min(1, '请输入访问令牌'),
})

type CreatePlatformFormData = z.infer<typeof createPlatformSchema>

// Provider 配置
const providerConfig: Record<ProviderType, { label: string; color: string; icon: string }> = {
  gitea: { label: 'Gitea', color: 'bg-green-500', icon: '🍵' },
  github: { label: 'GitHub', color: 'bg-gray-800', icon: '🐙' },
  gitlab: { label: 'GitLab', color: 'bg-orange-500', icon: '🦊' },
}

const ALL_ORG_VALUE = '__all__'

export function PlatformsPage() {
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
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
    resolver: zodResolver(createPlatformSchema),
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
        toast.success('平台添加成功', {
          description: '现在可以从该平台选择仓库了',
        })
        setAddDialogOpen(false)
        form.reset()
      }
    } catch (error) {
      toast.error('添加失败', {
        description: error instanceof Error ? error.message : '请检查平台地址和令牌是否正确',
      })
    }
  }

  const handleDelete = async () => {
    if (!selectedPlatform) return
    
    try {
      await deleteMutation.mutateAsync(selectedPlatform.id)
      toast.success('平台已删除')
      setDeleteDialogOpen(false)
      setSelectedPlatform(null)
    } catch (error) {
      toast.error('删除失败', {
        description: error instanceof Error ? error.message : '未知错误',
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
        const { imported, failed } = result.data
        if (failed > 0) {
          toast.warning(`导入完成：${imported} 个成功，${failed} 个失败`, {
            description: '部分仓库可能已存在',
          })
        } else {
          toast.success(`成功导入 ${imported} 个仓库`, {
            description: '请在仓库页面配置 Webhook',
          })
        }
        setImportDialogOpen(false)
        setSelectedRepos(new Set())
      }
    } catch (error) {
      toast.error('导入失败', {
        description: error instanceof Error ? error.message : '未知错误',
      })
    }
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
          <h1 className="text-2xl font-bold tracking-tight">平台管理</h1>
          <p className="text-muted-foreground">
            配置 Git 平台凭证，快速导入仓库
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          添加平台
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
          title="还没有配置平台"
          description="添加 Git 平台凭证后，可以快速选择并导入仓库"
          action={
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              添加平台
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
                        导入仓库
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
                        删除
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
                      ? `最近使用: ${new Date(platform.lastUsedAt).toLocaleDateString()}`
                      : '从未使用'
                    }
                  </span>
                </div>
                <Button
                  className="w-full mt-4"
                  variant="outline"
                  onClick={() => handleOpenImport(platform)}
                >
                  <GitBranch className="mr-2 h-4 w-4" />
                  选择仓库
                  <ChevronRight className="ml-auto h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 添加平台对话框 */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>添加 Git 平台</DialogTitle>
            <DialogDescription>
              配置平台访问凭证后，可以直接选择仓库进行导入
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(handleCreate)}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="provider">平台类型</Label>
                <Select
                  value={form.watch('provider')}
                  onValueChange={(v) => form.setValue('provider', v as 'gitea')}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择平台类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gitea">
                      <span className="flex items-center gap-2">
                        🍵 Gitea
                      </span>
                    </SelectItem>
                    {/* GitHub 和 GitLab 暂不支持 */}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="name">平台名称</Label>
                <Input
                  id="name"
                  placeholder="例如：公司 Gitea"
                  {...form.register('name')}
                />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="baseUrl">平台地址</Label>
                <Input
                  id="baseUrl"
                  placeholder="https://gitea.example.com"
                  {...form.register('baseUrl')}
                />
                {form.formState.errors.baseUrl && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.baseUrl.message}
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="accessToken">访问令牌 (Access Token)</Label>
                <Input
                  id="accessToken"
                  type="password"
                  placeholder="在平台设置中生成的个人访问令牌"
                  {...form.register('accessToken')}
                />
                {form.formState.errors.accessToken && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.accessToken.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  需要 repo 读取权限，用于获取仓库列表和提交 Review
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                添加平台
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 导入仓库对话框 */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              选择要导入的仓库
            </DialogTitle>
            <DialogDescription>
              {selectedPlatform && (
                <span className="flex items-center gap-1">
                  从 <strong>{selectedPlatform.name}</strong> 选择仓库
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
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="选择组织" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_ORG_VALUE}>全部仓库</SelectItem>
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
            <ScrollArea className="h-[400px] rounded-md border p-4">
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
                  <p>没有找到仓库</p>
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
                      全选 ({selectedRepos.size}/{repositories.length})
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
                      加载更多
                    </Button>
                  )}
                </div>
              )}
            </ScrollArea>
          </div>

          <DialogFooter>
            <div className="flex items-center justify-between w-full">
              <span className="text-sm text-muted-foreground">
                已选择 {selectedRepos.size} 个仓库
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setImportDialogOpen(false)}
                >
                  取消
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={selectedRepos.size === 0 || importMutation.isPending}
                >
                  {importMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  导入 {selectedRepos.size > 0 && `(${selectedRepos.size})`}
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
        title="删除平台"
        description={`确定要删除平台 "${selectedPlatform?.name}" 吗？此操作不可撤销。已导入的仓库不会被删除。`}
        confirmText="删除"
        cancelText="取消"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
