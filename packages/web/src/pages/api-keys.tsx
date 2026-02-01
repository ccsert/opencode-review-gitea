import { useTranslation } from 'react-i18next'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function ApiKeysPage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('nav.apiKeys')}</h1>
        <p className="text-muted-foreground">
          Manage API keys for programmatic access
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('common.create')} API Key</CardTitle>
          <CardDescription>
            Generate new API keys for external integrations
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
