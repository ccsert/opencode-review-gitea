import { useTranslation } from 'react-i18next'
import { GitBranch, FileSearch, FileText, TrendingUp } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function DashboardPage() {
  const { t } = useTranslation()

  // TODO: Fetch real data from API
  const stats = [
    {
      title: t('dashboard.totalReviews'),
      value: '0',
      icon: FileSearch,
      description: '+0% from last month',
    },
    {
      title: t('dashboard.totalRepositories'),
      value: '0',
      icon: GitBranch,
      description: 'Connected repositories',
    },
    {
      title: t('templates.title'),
      value: '0',
      icon: FileText,
      description: 'Active templates',
    },
    {
      title: t('dashboard.reviewStats'),
      value: '0%',
      icon: TrendingUp,
      description: 'Success rate',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('dashboard.title')}</h1>
        <p className="text-muted-foreground">{t('app.description')}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {stat.title}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">
                  {stat.description}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Recent Reviews */}
      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.recentReviews')}</CardTitle>
          <CardDescription>
            Your most recent code reviews will appear here
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            No reviews yet
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
