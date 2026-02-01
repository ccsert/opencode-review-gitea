import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Plus,
  FileText,
  MoreHorizontal,
  Trash2,
  Edit,
  Eye,
  Lock,
  Loader2,
  Star,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { ScrollArea } from '@/components/ui/scroll-area'

import {
  useTemplates,
  useTemplate,
  useCreateTemplate,
  useUpdateTemplate,
  useDeleteTemplate,
} from '@/lib/hooks'
import type { Template } from '@/lib/types'

// 创建模板表单 Schema
const createTemplateSchema = (t: (key: string) => string) => z.object({
  name: z.string().min(1, t('templates.nameRequired')).max(255),
  description: z.string().optional(),
  systemPrompt: z.string().min(1, t('templates.systemPromptRequired')),
  categories: z.string().optional(),
  severities: z.string().optional(),
})

type CreateTemplateFormData = z.infer<ReturnType<typeof createTemplateSchema>>

export function TemplatesPage() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState('all')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)

  // API Queries
  const { data: templatesData, isLoading } = useTemplates()
  const createMutation = useCreateTemplate()
  const deleteMutation = useDeleteTemplate()

  const templates = templatesData?.data || []
  const systemTemplates = templates.filter((t) => t.isSystem)
  const userTemplates = templates.filter((t) => !t.isSystem)

  const displayedTemplates =
    activeTab === 'system'
      ? systemTemplates
      : activeTab === 'user'
      ? userTemplates
      : templates

  // Form
  const form = useForm<CreateTemplateFormData>({
    resolver: zodResolver(createTemplateSchema(t)),
    defaultValues: {
      name: '',
      description: '',
      systemPrompt: '',
      categories: 'BUG,SECURITY,PERFORMANCE,STYLE',
      severities: 'CRITICAL,HIGH,MEDIUM,LOW',
    },
  })

  const handleCreate = async (data: CreateTemplateFormData) => {
    try {
      await createMutation.mutateAsync({
        name: data.name,
        description: data.description,
        systemPrompt: data.systemPrompt,
        categories: data.categories?.split(',').map((s) => s.trim()).filter(Boolean),
        severities: data.severities?.split(',').map((s) => s.trim()).filter(Boolean),
      })
      toast.success(t('templates.createSuccess'))
      setCreateDialogOpen(false)
      form.reset()
    } catch (err) {
      toast.error(t('templates.createFailed'), {
        description: err instanceof Error ? err.message : t('templates.unknownError'),
      })
    }
  }

  const handleDelete = async () => {
    if (!selectedTemplate) return

    try {
      await deleteMutation.mutateAsync(selectedTemplate.id)
      toast.success(t('templates.deleteSuccess'))
      setDeleteDialogOpen(false)
      setSelectedTemplate(null)
    } catch {
      toast.error(t('templates.deleteFailed'))
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('templates.title')}</h1>
          <p className="text-muted-foreground">
            {t('templates.description')}
          </p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {t('templates.createTemplate')}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>{t('templates.createTemplate')}</DialogTitle>
              <DialogDescription>
                {t('templates.createCustomTemplate')}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(handleCreate)} className="space-y-4">
              <div className="space-y-2">
                <Label>{t('templates.name')}</Label>
                <Input
                  placeholder={t('templates.namePlaceholder')}
                  {...form.register('name')}
                />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t('templates.description')}</Label>
                <Input
                  placeholder={t('templates.descriptionPlaceholder')}
                  {...form.register('description')}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('templates.systemPrompt')}</Label>
                <Textarea
                  placeholder={t('templates.systemPromptPlaceholder')}
                  className="min-h-[200px] font-mono text-sm"
                  {...form.register('systemPrompt')}
                />
                {form.formState.errors.systemPrompt && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.systemPrompt.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('templates.categories')}</Label>
                  <Input
                    placeholder={t('templates.categoriesPlaceholder')}
                    {...form.register('categories')}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('templates.severities')}</Label>
                  <Input
                    placeholder={t('templates.severitiesPlaceholder')}
                    {...form.register('severities')}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateDialogOpen(false)}
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

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">{t('templates.all', { count: templates.length })}</TabsTrigger>
          <TabsTrigger value="system">
            {t('templates.system', { count: systemTemplates.length })}
          </TabsTrigger>
          <TabsTrigger value="user">
            {t('templates.user', { count: userTemplates.length })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-20 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : displayedTemplates.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={activeTab === 'user' ? t('templates.emptyUserTitle') : t('templates.emptyTitle')}
              description={
                activeTab === 'user'
                  ? t('templates.emptyUserDescription')
                  : t('templates.emptyDescription')
              }
              action={
                <Button onClick={() => setCreateDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t('templates.createTemplate')}
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {displayedTemplates.map((template) => (
                <Card key={template.id} className="relative">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <CardTitle className="text-base">{template.name}</CardTitle>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedTemplate(template)
                              setPreviewDialogOpen(true)
                            }}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            {t('templates.viewTemplate')}
                          </DropdownMenuItem>
                          {!template.isSystem && (
                            <>
                              <DropdownMenuItem
                                onClick={() => {
                                  setSelectedTemplate(template)
                                  setEditDialogOpen(true)
                                }}
                              >
                                <Edit className="mr-2 h-4 w-4" />
                                {t('common.edit')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => {
                                  setSelectedTemplate(template)
                                  setDeleteDialogOpen(true)
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                {t('common.delete')}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <CardDescription className="line-clamp-2">
                      {template.description || t('templates.emptyDescription')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex flex-wrap gap-2">
                      {template.isSystem && (
                        <Badge variant="secondary" className="gap-1">
                          <Lock className="h-3 w-3" />
                          {t('templates.systemTemplate')}
                        </Badge>
                      )}
                      {template.isDefault && (
                        <Badge className="gap-1">
                          <Star className="h-3 w-3" />
                          {t('templates.isDefault')}
                        </Badge>
                      )}
                      {template.categories?.slice(0, 3).map((cat) => (
                        <Badge key={cat} variant="outline" className="text-xs">
                          {cat}
                        </Badge>
                      ))}
                      {template.categories && template.categories.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{template.categories.length - 3}
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Preview Dialog */}
      <TemplatePreviewDialog
        open={previewDialogOpen}
        onOpenChange={setPreviewDialogOpen}
        templateId={selectedTemplate?.id}
      />

      {/* Edit Dialog */}
      <EditTemplateDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        template={selectedTemplate}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('templates.deleteTemplate')}
        description={t('templates.deleteTemplateDescription', { name: selectedTemplate?.name || '' })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}

// 模板预览对话框
function TemplatePreviewDialog({
  open,
  onOpenChange,
  templateId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  templateId?: string
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useTemplate(templateId || '')
  const template = data?.data

  if (!templateId) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {template?.name}
            {template?.isSystem && (
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" />
                {t('templates.systemTemplate')}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>{template?.description}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-60 w-full" />
        ) : template ? (
          <ScrollArea className="max-h-[50vh]">
            <div className="space-y-4 pr-4">
              <div>
                <Label className="text-muted-foreground mb-2 block">
                  {t('templates.systemPrompt')}
                </Label>
                <div className="rounded-lg border bg-muted/50 p-4 font-mono text-sm whitespace-pre-wrap">
                  {template.systemPrompt || t('common.no')}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground mb-2 block">
                    {t('templates.categories')}
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {template.categories?.map((cat) => (
                      <Badge key={cat} variant="outline">
                        {cat}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground mb-2 block">
                    {t('templates.severities')}
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {template.severities?.map((sev) => (
                      <Badge key={sev} variant="secondary">
                        {sev}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        ) : null}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 编辑模板对话框
function EditTemplateDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  template: Template | null
}) {
  const { t } = useTranslation()
  const { data: templateDetail } = useTemplate(template?.id || '')
  const updateMutation = useUpdateTemplate()

  const form = useForm<CreateTemplateFormData>({
    resolver: zodResolver(createTemplateSchema(t)),
  })

  // 当模板详情加载后填充表单
  useEffect(() => {
    if (templateDetail?.data) {
      const t = templateDetail.data
      form.reset({
        name: t.name,
        description: t.description || '',
        systemPrompt: t.systemPrompt || '',
        categories: t.categories?.join(',') || '',
        severities: t.severities?.join(',') || '',
      })
    }
  }, [templateDetail, form])

  const handleSave = async (data: CreateTemplateFormData) => {
    if (!template) return

    try {
      await updateMutation.mutateAsync({
        id: template.id,
        data: {
          name: data.name,
          description: data.description,
          systemPrompt: data.systemPrompt,
          categories: data.categories?.split(',').map((s) => s.trim()).filter(Boolean),
          severities: data.severities?.split(',').map((s) => s.trim()).filter(Boolean),
        },
      })
      toast.success(t('templates.updateSuccess'))
      onOpenChange(false)
    } catch {
      toast.error(t('templates.updateFailed'))
    }
  }

  if (!template) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t('templates.editTemplate')}</DialogTitle>
          <DialogDescription>{t('templates.editTemplateDescription')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleSave)} className="space-y-4">
          <div className="space-y-2">
            <Label>{t('templates.name')}</Label>
            <Input {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t('templates.description')}</Label>
            <Input {...form.register('description')} />
          </div>

          <div className="space-y-2">
            <Label>{t('templates.systemPrompt')}</Label>
            <Textarea
              className="min-h-[200px] font-mono text-sm"
              {...form.register('systemPrompt')}
            />
            {form.formState.errors.systemPrompt && (
              <p className="text-sm text-destructive">
                {form.formState.errors.systemPrompt.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('templates.categories')}</Label>
              <Input {...form.register('categories')} />
            </div>
            <div className="space-y-2">
              <Label>{t('templates.severities')}</Label>
              <Input {...form.register('severities')} />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
