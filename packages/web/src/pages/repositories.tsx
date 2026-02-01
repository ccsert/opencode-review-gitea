import { useTranslation } from 'react-i18next'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function RepositoriesPage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('repositories.title')}</h1>
        <p className="text-muted-foreground">
          Manage your connected code repositories
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('repositories.addRepository')}</CardTitle>
          <CardDescription>
            Connect a new repository to enable AI-powered code reviews
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
