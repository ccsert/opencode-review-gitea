import { useTranslation } from 'react-i18next'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function ReviewsPage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('reviews.title')}</h1>
        <p className="text-muted-foreground">
          View and manage code review history
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.recentReviews')}</CardTitle>
          <CardDescription>
            All code reviews performed by the AI
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
