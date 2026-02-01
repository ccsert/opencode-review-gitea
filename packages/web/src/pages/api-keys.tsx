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
const createApiKeySchema = (t: (key: string) => string) => z.object({
  name: z.string().min(1, t('apiKeys.nameRequired')).max(100),
  scopes: z.array(z.enum(['webhook', 'read', 'write', 'admin'])).min(1, t('apiKeys.scopesRequired')),
  expiresInDays: z.number().min(0).max(365).optional(),
})

type CreateApiKeyFormData = z.infer<ReturnType<typeof createApiKeySchema>>

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

  // Scope descriptions
  const getScopeLabel = (scope: ApiKeyScope) => t(`apiKeys.scopes.${scope}.label`)
  const getScopeDescription = (scope: ApiKeyScope) => t(`apiKeys.scopes.${scope}.description`)

  // Form
  const form = useForm<CreateApiKeyFormData>({
    resolver: zodResolver(createApiKeySchema(t)),
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
      toast.error(t('apiKeys.createFailed'), {
        description: err instanceof Error ? err.message : t('apiKeys.unknownError'),
      })
    }
  }

  const handleDelete = async () => {
    if (!selectedKey) return

    try {
      await deleteMutation.mutateAsync(selectedKey.id)
      toast.success(t('apiKeys.deleteSuccess'))
      setDeleteDialogOpen(false)
      setSelectedKey(null)
    } catch {
      toast.error(t('apiKeys.deleteFailed'))
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success(t('apiKeys.copiedToClipboard'))
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
          <h1 className="text-3xl font-bold">{t('apiKeys.title')}</h1>
          <p className="text-muted-foreground">
            {t('apiKeys.description')}
          </p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {t('apiKeys.create')}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{t('apiKeys.createTitle')}</DialogTitle>
              <DialogDescription>
                {t('apiKeys.createDescription')}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(handleCreate)} className="space-y-4">
              <div className="space-y-2">
                <Label>{t('apiKeys.keyName')}</Label>
                <Input
                  placeholder={t('apiKeys.namePlaceholder')}
                  {...form.register('name')}
                />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t('apiKeys.scopes')}</Label>
                <div className="space-y-2">
                  {(['webhook', 'read', 'write', 'admin'] as ApiKeyScope[]).map((scope) => (
                    <div
                      key={scope}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="space-y-0.5">
                        <Label className="text-sm font-medium">
                          {getScopeLabel(scope)}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {getScopeDescription(scope)}
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
                  <p className="text-sm text-destructive">{t('apiKeys.scopesRequired')}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t('apiKeys.expiresIn')}</Label>
                <Select value={expiresOption} onValueChange={setExpiresOption}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">{t('apiKeys.neverExpires')}</SelectItem>
                    <SelectItem value="7">{t('apiKeys.expires7Days')}</SelectItem>
                    <SelectItem value="30">{t('apiKeys.expires30Days')}</SelectItem>
                    <SelectItem value="90">{t('apiKeys.expires90Days')}</SelectItem>
                    <SelectItem value="365">{t('apiKeys.expires1Year')}</SelectItem>
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
              {t('apiKeys.securityTitle')}
            </p>
            <p className="text-amber-700 dark:text-amber-300">
              {t('apiKeys.securityWarning')}
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
              title={t('apiKeys.emptyTitle')}
              description={t('apiKeys.emptyDescription')}
              action={
                <Button onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t('apiKeys.create')}
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('apiKeys.name')}</TableHead>
                  <TableHead>{t('apiKeys.prefix')}</TableHead>
                  <TableHead>{t('apiKeys.scopes')}</TableHead>
                  <TableHead>{t('apiKeys.expiresAt')}</TableHead>
                  <TableHead>{t('apiKeys.lastUsedAt')}</TableHead>
                  <TableHead>{t('apiKeys.createdAt')}</TableHead>
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
                            {getScopeLabel(scope)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {key.expiresAt ? (
                        <div className="flex items-center gap-1">
                          {isExpired(key.expiresAt) ? (
                            <Badge variant="destructive" className="text-xs">
                              {t('apiKeys.expired')}
                            </Badge>
                          ) : (
                            <span className="text-sm">{formatDate(key.expiresAt)}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{t('apiKeys.neverExpires')}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {key.lastUsedAt ? formatDate(key.lastUsedAt) : t('apiKeys.neverUsed')}
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
                            {t('common.delete')}
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
              {t('apiKeys.createdTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('apiKeys.createdDescription')}
            </DialogDescription>
          </DialogHeader>

          {createdKey && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{t('apiKeys.createdWarningTitle')}</AlertTitle>
                <AlertDescription>
                  {t('apiKeys.createdWarning')}
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
                  <Label className="text-muted-foreground">{t('apiKeys.name')}</Label>
                  <p>{createdKey.name}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t('apiKeys.expiresAt')}</Label>
                  <p>
                    {createdKey.expiresAt
                      ? formatDate(createdKey.expiresAt)
                      : t('apiKeys.neverExpires')}
                  </p>
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">{t('apiKeys.scopes')}</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {createdKey.scopes.map((scope) => (
                    <Badge key={scope} variant="secondary">
                      {getScopeLabel(scope)}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setCreatedKeyDialogOpen(false)}>
              {t('apiKeys.savedConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('apiKeys.deleteTitle')}
        description={t('apiKeys.deleteDescription', { name: selectedKey?.name || '' })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
