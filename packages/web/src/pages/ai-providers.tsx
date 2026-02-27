import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  Bot,
  MoreHorizontal,
  Trash2,
  Loader2,
  Star,
  Check,
  Zap,
  Settings2,
  Eye,
  EyeOff,
  TestTube2,
  Sparkles,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Switch } from '@/components/ui/switch'
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
  useAiProviders,
  useAiProviderPresets,
  useCreateAiProvider,
  useUpdateAiProvider,
  useDeleteAiProvider,
  useSetDefaultAiProvider,
  useTestAiConnection,
} from '@/lib/hooks'
import type { AiProvider, AiProviderType, AiProviderPreset } from '@/lib/types'

// 创建 AI 供应商表单 Schema
const createProviderSchema = (t: (key: string, options?: Record<string, unknown>) => string) => z.object({
  name: z.string().min(1, t('aiProviders.validation.nameRequired')).max(50, t('aiProviders.validation.nameTooLong')),
  provider: z.enum(['openai', 'anthropic', 'deepseek', 'glm', 'minimax', 'openrouter', 'ollama', 'custom']),
  baseUrl: z.string().url(t('aiProviders.validation.baseUrlInvalid')).optional().or(z.literal('')),
  apiKey: z.string().optional(),
  defaultModel: z.string().optional(),
  isDefault: z.boolean().optional(),
})

type CreateProviderFormData = z.input<ReturnType<typeof createProviderSchema>>

// Provider 配置
const providerConfig: Record<AiProviderType, { label: string; color: string; icon: string; needsKey: boolean }> = {
  openai: { label: 'OpenAI', color: 'bg-emerald-500', icon: '🤖', needsKey: true },
  anthropic: { label: 'Anthropic', color: 'bg-orange-500', icon: '🧠', needsKey: true },
  deepseek: { label: 'DeepSeek', color: 'bg-blue-500', icon: '🔍', needsKey: true },
  glm: { label: '智谱 GLM', color: 'bg-violet-500', icon: '🌟', needsKey: true },
  minimax: { label: 'MiniMax', color: 'bg-pink-500', icon: '🔮', needsKey: true },
  openrouter: { label: 'OpenRouter', color: 'bg-purple-500', icon: '🌐', needsKey: true },
  ollama: { label: 'Ollama', color: 'bg-gray-600', icon: '🦙', needsKey: false },
  custom: { label: 'Custom', color: 'bg-slate-500', icon: '⚙️', needsKey: true },
}

export function AiProvidersPage() {
  const { t } = useTranslation()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<AiProvider | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // API Queries
  const { data: providersData, isLoading } = useAiProviders()
  const { data: presetsData } = useAiProviderPresets()
  const createMutation = useCreateAiProvider()
  const updateMutation = useUpdateAiProvider()
  const deleteMutation = useDeleteAiProvider()
  const setDefaultMutation = useSetDefaultAiProvider()
  const testMutation = useTestAiConnection()

  // Form
  const form = useForm<CreateProviderFormData>({
    resolver: zodResolver(createProviderSchema(t)),
    defaultValues: {
      name: '',
      provider: 'deepseek',
      baseUrl: '',
      apiKey: '',
      defaultModel: '',
      isDefault: false,
    },
  })

  const watchProvider = form.watch('provider')
  const providers = providersData?.data || []
  const presets = presetsData?.data || []

  // 根据选择的 provider 获取预设
  const selectedPreset = presets.find(p => p.id === watchProvider)

  const handleCreate = async (data: CreateProviderFormData) => {
    try {
      const result = await createMutation.mutateAsync({
        ...data,
        baseUrl: data.baseUrl || undefined,
        apiKey: data.apiKey || undefined,
        defaultModel: data.defaultModel || undefined,
      })
      if (result.success) {
        toast.success(t('aiProviders.createSuccess'), {
          description: t('aiProviders.createSuccessDesc'),
        })
        setAddDialogOpen(false)
        form.reset()
        setTestResult(null)
      }
    } catch (error) {
      toast.error(t('aiProviders.createFailed'), {
        description: error instanceof Error ? error.message : t('common.unknownError'),
      })
    }
  }

  const handleDelete = async () => {
    if (!selectedProvider) return
    
    try {
      await deleteMutation.mutateAsync(selectedProvider.id)
      toast.success(t('aiProviders.deleteSuccess'))
      setDeleteDialogOpen(false)
      setSelectedProvider(null)
    } catch (error) {
      toast.error(t('aiProviders.deleteFailed'), {
        description: error instanceof Error ? error.message : t('common.unknownError'),
      })
    }
  }

  const handleSetDefault = async (provider: AiProvider) => {
    try {
      await setDefaultMutation.mutateAsync(provider.id)
      toast.success(t('aiProviders.setDefaultSuccess'), {
        description: `${provider.name} ${t('aiProviders.isNowDefault')}`,
      })
    } catch (err) {
      toast.error(t('aiProviders.setDefaultFailed'), {
        description: err instanceof Error ? err.message : t('common.unknownError'),
      })
    }
  }

  const handleToggleEnabled = async (provider: AiProvider) => {
    try {
      await updateMutation.mutateAsync({
        id: provider.id,
        data: { isEnabled: !provider.isEnabled },
      })
      toast.success(provider.isEnabled ? t('aiProviders.disabled') : t('aiProviders.enabled'))
    } catch {
      toast.error(t('common.operationFailed'))
    }
  }

  const handleTestConnection = async () => {
    const values = form.getValues()
    const preset = presets.find(p => p.id === values.provider)
    
    try {
      setTestResult(null)
      const result = await testMutation.mutateAsync({
        provider: values.provider,
        baseUrl: values.baseUrl || preset?.baseUrl,
        apiKey: values.apiKey || undefined,
      })
      
      if (result.success && result.data) {
        setTestResult({ success: true, message: result.data.message })
        // 如果获取到了模型列表，自动选择第一个
        if (result.data.models.length > 0 && !values.defaultModel) {
          form.setValue('defaultModel', result.data.models[0])
        }
      }
    } catch (error) {
      setTestResult({ 
        success: false, 
        message: error instanceof Error ? error.message : t('aiProviders.testFailed') 
      })
    }
  }

  const openAddDialog = (preset?: AiProviderPreset) => {
    form.reset({
      name: preset?.name || '',
      provider: preset?.id || 'deepseek',
      baseUrl: preset?.baseUrl || '',
      apiKey: '',
      defaultModel: preset?.models[0] || '',
      isDefault: providers.length === 0,
    })
    setTestResult(null)
    setShowApiKey(false)
    setAddDialogOpen(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('aiProviders.title')}</h1>
          <p className="text-muted-foreground">
            {t('aiProviders.description')}
          </p>
        </div>
        <Button onClick={() => openAddDialog()}>
          <Plus className="mr-2 h-4 w-4" />
          {t('aiProviders.add')}
        </Button>
      </div>

      {/* Quick Add Presets */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-yellow-500" />
            {t('aiProviders.quickAdd')}
          </CardTitle>
          <CardDescription>{t('aiProviders.quickAddDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Object.entries(providerConfig).map(([key, config]) => (
              <Button
                key={key}
                variant="outline"
                className="h-auto py-4 flex flex-col gap-2"
                onClick={() => openAddDialog(presets.find(p => p.id === key))}
              >
                <span className="text-2xl">{config.icon}</span>
                <span className="font-medium">{config.label}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Provider List */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : providers.length === 0 ? (
        <EmptyState
          icon={Bot}
          title={t('aiProviders.empty')}
          description={t('aiProviders.emptyDesc')}
          action={
            <Button onClick={() => openAddDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              {t('aiProviders.addFirst')}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {providers.map((provider) => {
            const config = providerConfig[provider.provider as AiProviderType]
            return (
              <Card 
                key={provider.id} 
                className={`relative ${!provider.isEnabled ? 'opacity-60' : ''}`}
              >
                {provider.isDefault && (
                  <div className="absolute -top-2 -right-2">
                    <Badge className="bg-yellow-500 text-white">
                      <Star className="h-3 w-3 mr-1 fill-current" />
                      {t('aiProviders.default')}
                    </Badge>
                  </div>
                )}
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg ${config?.color || 'bg-gray-500'} flex items-center justify-center text-xl`}>
                      {config?.icon || '🤖'}
                    </div>
                    <div>
                      <CardTitle className="text-lg">{provider.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {config?.label || provider.provider}
                      </p>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!provider.isDefault && (
                        <DropdownMenuItem onClick={() => handleSetDefault(provider)}>
                          <Star className="mr-2 h-4 w-4" />
                          {t('aiProviders.setAsDefault')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => handleToggleEnabled(provider)}>
                        {provider.isEnabled ? (
                          <>
                            <EyeOff className="mr-2 h-4 w-4" />
                            {t('aiProviders.disable')}
                          </>
                        ) : (
                          <>
                            <Eye className="mr-2 h-4 w-4" />
                            {t('aiProviders.enable')}
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => {
                          setSelectedProvider(provider)
                          setDeleteDialogOpen(true)
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('common.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {provider.defaultModel && (
                      <div className="flex items-center gap-2 text-sm">
                        <Zap className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">{t('aiProviders.model')}:</span>
                        <code className="px-1.5 py-0.5 bg-muted rounded text-xs">
                          {provider.defaultModel}
                        </code>
                      </div>
                    )}
                    {provider.baseUrl && (
                      <div className="flex items-center gap-2 text-sm">
                        <Settings2 className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground truncate">
                          {provider.baseUrl}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-2">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={provider.isEnabled}
                          onCheckedChange={() => handleToggleEnabled(provider)}
                        />
                        <span className="text-sm text-muted-foreground">
                          {provider.isEnabled ? t('aiProviders.enabled') : t('aiProviders.disabled')}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-125">
          <DialogHeader>
            <DialogTitle>{t('aiProviders.addTitle')}</DialogTitle>
            <DialogDescription>
              {t('aiProviders.addDescription')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(handleCreate)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider">{t('aiProviders.providerType')}</Label>
              <Select
                value={form.watch('provider')}
                onValueChange={(value) => {
                  form.setValue('provider', value as AiProviderType)
                  const preset = presets.find(p => p.id === value)
                  if (preset) {
                    form.setValue('name', preset.name)
                    form.setValue('baseUrl', preset.baseUrl)
                    if (preset.models.length > 0) {
                      form.setValue('defaultModel', preset.models[0])
                    }
                  }
                  setTestResult(null)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(providerConfig).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      <span className="flex items-center gap-2">
                        <span>{config.icon}</span>
                        <span>{config.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">{t('aiProviders.name')}</Label>
              <Input
                id="name"
                placeholder={t('aiProviders.namePlaceholder')}
                {...form.register('name')}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="baseUrl">{t('aiProviders.baseUrl')}</Label>
              <Input
                id="baseUrl"
                placeholder={selectedPreset?.baseUrl || 'https://api.example.com'}
                {...form.register('baseUrl')}
              />
              {form.formState.errors.baseUrl && (
                <p className="text-sm text-destructive">{form.formState.errors.baseUrl.message}</p>
              )}
            </div>

            {providerConfig[watchProvider]?.needsKey && (
              <div className="space-y-2">
                <Label htmlFor="apiKey">{t('aiProviders.apiKey')}</Label>
                <div className="relative">
                  <Input
                    id="apiKey"
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="sk-..."
                    {...form.register('apiKey')}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="defaultModel">{t('aiProviders.defaultModel')}</Label>
              <Select
                value={form.watch('defaultModel') || ''}
                onValueChange={(value) => form.setValue('defaultModel', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('aiProviders.selectModel')} />
                </SelectTrigger>
                <SelectContent>
                  {(selectedPreset?.models || []).map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="isDefault"
                checked={form.watch('isDefault')}
                onCheckedChange={(checked) => form.setValue('isDefault', checked)}
              />
              <Label htmlFor="isDefault">{t('aiProviders.setAsDefaultOnCreate')}</Label>
            </div>

            {/* Test Connection */}
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleTestConnection}
                disabled={testMutation.isPending}
              >
                {testMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <TestTube2 className="mr-2 h-4 w-4" />
                )}
                {t('aiProviders.testConnection')}
              </Button>
              {testResult && (
                <div className={`p-3 rounded-lg text-sm ${
                  testResult.success 
                    ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' 
                    : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                }`}>
                  <div className="flex items-center gap-2">
                    {testResult.success ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    {testResult.message}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('common.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('aiProviders.deleteTitle')}
        description={t('aiProviders.deleteDescription', { name: selectedProvider?.name })}
        confirmText={t('common.delete')}
        onConfirm={handleDelete}
        variant="destructive"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
