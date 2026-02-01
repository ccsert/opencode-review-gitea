import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Plus,
  Key,
  MoreHorizontal,
  Trash2,
  Copy,
  AlertTriangle,
  Loader2,
  Shield,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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

import { useApiKeys, useCreateApiKey, useDeleteApiKey } from '@/lib/hooks'
import type { ApiKey, ApiKeyScope, CreatedApiKey } from '@/lib/types'

// 创建 API Key 表单 Schema
const createApiKeySchema = z.object({
  name: z.string().min(1, '请输入密钥名称').max(100),
  scopes: z.array(z.enum(['webhook', 'read', 'write', 'admin'])).min(1, '请至少选择一个权限'),
  expiresInDays: z.number().min(0).max(365).optional(),
})

type CreateApiKeyFormData = z.infer<typeof createApiKeySchema>

// 权限描述
const scopeDescriptions: Record<ApiKeyScope, { label: string; description: string }> = {
  webhook: { label: 'Webhook', description: '接收 Webhook 事件' },
  read: { label: '读取', description: '读取仓库和审查数据' },
  write: { label: '写入', description: '创建和修改资源' },
  admin: { label: '管理', description: '完全访问权限' },
}

export function ApiKeysPage() {
  const { t } = useTranslation()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [createdKeyDialogOpen, setCreatedKeyDialogOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState<ApiKey | null>(null)
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null)

  // API Queries
  const { data: keysData, isLoading } = useApiKeys()
  const createMutation = useCreateApiKey()
  const deleteMutation = useDeleteApiKey()

  const keys = keysData?.data || []

  // Form
  const form = useForm<CreateApiKeyFormData>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: {
      name: '',
      scopes: ['webhook'],
      expiresInDays: 0,
    },
  })

  const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>(['webhook'])
  const [expiresOption, setExpiresOption] = useState<string>('never')

  const handleCreate = async (data: CreateApiKeyFormData) => {
    try {
      const expiresInDays =
        expiresOption === 'never' ? undefined : parseInt(expiresOption)

      const result = await createMutation.mutateAsync({
        name: data.name,
        scopes: selectedScopes,
        expiresInDays,
      })

      if (result.success) {
        setCreatedKey(result.data)
        setCreateDialogOpen(false)
        setCreatedKeyDialogOpen(true)
        form.reset()
        setSelectedScopes(['webhook'])
        setExpiresOption('never')
      }
    } catch (err) {
      toast.error('创建失败', {
        description: err instanceof Error ? err.message : '未知错误',
      })
    }
  }

  const handleDelete = async () => {
    if (!selectedKey) return

    try {
      await deleteMutation.mutateAsync(selectedKey.id)
      toast.success('API 密钥已删除')
      setDeleteDialogOpen(false)
      setSelectedKey(null)
    } catch {
      toast.error('删除失败')
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('已复制到剪贴板')
  }

  const formatDate = (date: string | null) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false
    return new Date(expiresAt) < new Date()
  }

  const toggleScope = (scope: ApiKeyScope) => {
    setSelectedScopes((prev) =>
      prev.includes(scope)
        ? prev.filter((s) => s !== scope)
        : [...prev, scope]
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('nav.apiKeys')}</h1>
          <p className="text-muted-foreground">
            管理 API 密钥用于程序化访问
          </p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              创建 API Key
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>创建 API Key</DialogTitle>
              <DialogDescription>
                创建新的 API 密钥用于外部集成
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(handleCreate)} className="space-y-4">
              <div className="space-y-2">
                <Label>密钥名称</Label>
                <Input
                  placeholder="例如: CI/CD Integration"
                  {...form.register('name')}
                />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>权限范围</Label>
                <div className="space-y-2">
                  {(Object.keys(scopeDescriptions) as ApiKeyScope[]).map((scope) => (
                    <div
                      key={scope}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="space-y-0.5">
                        <Label className="text-sm font-medium">
                          {scopeDescriptions[scope].label}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {scopeDescriptions[scope].description}
                        </p>
                      </div>
                      <Switch
                        checked={selectedScopes.includes(scope)}
                        onCheckedChange={() => toggleScope(scope)}
                      />
                    </div>
                  ))}
                </div>
                {selectedScopes.length === 0 && (
                  <p className="text-sm text-destructive">请至少选择一个权限</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>过期时间</Label>
                <Select value={expiresOption} onValueChange={setExpiresOption}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">永不过期</SelectItem>
                    <SelectItem value="7">7 天</SelectItem>
                    <SelectItem value="30">30 天</SelectItem>
                    <SelectItem value="90">90 天</SelectItem>
                    <SelectItem value="365">1 年</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateDialogOpen(false)}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || selectedScopes.length === 0}
                >
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

      {/* Info Card */}
      <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
        <CardContent className="flex items-start gap-3 pt-6">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-200">
              安全提示
            </p>
            <p className="text-amber-700 dark:text-amber-300">
              API 密钥只会在创建时显示一次，请立即保存。密钥一旦丢失无法恢复，需要重新创建。
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
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
          ) : keys.length === 0 ? (
            <EmptyState
              icon={Key}
              title="暂无 API 密钥"
              description="创建 API 密钥以启用程序化访问"
              action={
                <Button onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  创建 API Key
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>密钥前缀</TableHead>
                  <TableHead>权限</TableHead>
                  <TableHead>过期时间</TableHead>
                  <TableHead>最后使用</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Key className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{key.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-2 py-1 text-sm">
                        {key.prefix}...
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <Badge key={scope} variant="secondary" className="text-xs">
                            {scopeDescriptions[scope].label}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {key.expiresAt ? (
                        <div className="flex items-center gap-1">
                          {isExpired(key.expiresAt) ? (
                            <Badge variant="destructive" className="text-xs">
                              已过期
                            </Badge>
                          ) : (
                            <span className="text-sm">{formatDate(key.expiresAt)}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">永不过期</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {key.lastUsedAt ? formatDate(key.lastUsedAt) : '从未使用'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {formatDate(key.createdAt)}
                      </span>
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
                            className="text-destructive"
                            onClick={() => {
                              setSelectedKey(key)
                              setDeleteDialogOpen(true)
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Created Key Dialog */}
      <Dialog open={createdKeyDialogOpen} onOpenChange={setCreatedKeyDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-green-500" />
              API 密钥已创建
            </DialogTitle>
            <DialogDescription>
              请立即保存此密钥，关闭对话框后将无法再次查看
            </DialogDescription>
          </DialogHeader>

          {createdKey && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>重要提示</AlertTitle>
                <AlertDescription>
                  这是您唯一一次能看到完整密钥的机会，请立即复制并安全保存！
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Label>API Key</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={createdKey.key}
                    className="font-mono text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(createdKey.key)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <Label className="text-muted-foreground">名称</Label>
                  <p>{createdKey.name}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">过期时间</Label>
                  <p>
                    {createdKey.expiresAt
                      ? formatDate(createdKey.expiresAt)
                      : '永不过期'}
                  </p>
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">权限</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {createdKey.scopes.map((scope) => (
                    <Badge key={scope} variant="secondary">
                      {scopeDescriptions[scope].label}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setCreatedKeyDialogOpen(false)}>
              我已保存密钥
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="删除 API 密钥"
        description={`确定要删除密钥 "${selectedKey?.name}" 吗？此操作不可撤销，使用此密钥的所有集成将立即失效。`}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
