import { useTranslation } from 'react-i18next'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function TemplatesPage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('templates.title')}</h1>
        <p className="text-muted-foreground">
          Manage review templates for different scenarios
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('templates.createTemplate')}</CardTitle>
          <CardDescription>
            Create custom templates for your code reviews
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            Coming Soon
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
