import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FileSearch, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { LanguageSwitcher } from '@/components/language-switcher'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { useAuthStore } from '@/stores/auth'
import { apiClient } from '@/lib/api-client'

const loginSchema = z.object({
  adminSecret: z.string().min(1, 'Admin secret is required'),
})

type LoginFormData = z.infer<typeof loginSchema>

export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setTokens } = useAuthStore()
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await apiClient.post<{
        accessToken: string
        refreshToken: string
      }>(
        '/auth/login',
        { adminSecret: data.adminSecret },
        { skipAuth: true }
      )
      setTokens(response.accessToken, response.refreshToken)
      navigate('/')
    } catch {
      setError(t('auth.invalidCredentials'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-end gap-2 p-4">
        <LanguageSwitcher />
        <ThemeSwitcher />
      </header>

      {/* Main content */}
      <main className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <FileSearch className="h-6 w-6" />
            </div>
            <CardTitle className="text-2xl">{t('app.title')}</CardTitle>
            <CardDescription>{t('auth.loginTitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="adminSecret">{t('auth.adminSecret')}</Label>
                <Input
                  id="adminSecret"
                  type="password"
                  placeholder={t('auth.enterSecret')}
                  {...register('adminSecret')}
                  aria-invalid={!!errors.adminSecret}
                />
                {errors.adminSecret && (
                  <p className="text-sm text-destructive">
                    {errors.adminSecret.message}
                  </p>
                )}
              </div>

              {error && (
                <p className="text-sm text-destructive text-center">{error}</p>
              )}

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('auth.login')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
