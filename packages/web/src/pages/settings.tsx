import { useTranslation } from 'react-i18next'
import { Moon, Sun, Monitor, Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { useThemeStore, applyTheme } from '@/stores/theme'
import { supportedLanguages } from '@/i18n'

export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useThemeStore()

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme)
    applyTheme(newTheme)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('settings.title')}</h1>
        <p className="text-muted-foreground">
          Configure your application preferences
        </p>
      </div>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.appearance')}</CardTitle>
          <CardDescription>
            Customize how the application looks
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Theme */}
          <div className="space-y-2">
            <Label>{t('settings.theme')}</Label>
            <div className="flex gap-2">
              <Button
                variant={theme === 'light' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleThemeChange('light')}
              >
                <Sun className="mr-2 h-4 w-4" />
                {t('settings.lightMode')}
              </Button>
              <Button
                variant={theme === 'dark' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleThemeChange('dark')}
              >
                <Moon className="mr-2 h-4 w-4" />
                {t('settings.darkMode')}
              </Button>
              <Button
                variant={theme === 'system' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleThemeChange('system')}
              >
                <Monitor className="mr-2 h-4 w-4" />
                {t('settings.systemMode')}
              </Button>
            </div>
          </div>

          {/* Language */}
          <div className="space-y-2">
            <Label>{t('settings.language')}</Label>
            <div className="flex gap-2">
              {supportedLanguages.map((lang) => (
                <Button
                  key={lang.code}
                  variant={i18n.language === lang.code ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => i18n.changeLanguage(lang.code)}
                >
                  <Languages className="mr-2 h-4 w-4" />
                  {lang.nativeName}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
