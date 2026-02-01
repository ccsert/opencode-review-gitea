import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Moon, Sun, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useThemeStore, applyTheme } from '@/stores/theme'

export function ThemeSwitcher() {
  const { t } = useTranslation()
  const { theme, setTheme } = useThemeStore()

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (theme === 'system') {
        applyTheme('system')
      }
    }
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  const cycleTheme = () => {
    const themes = ['light', 'dark', 'system'] as const
    const currentIndex = themes.indexOf(theme)
    const nextIndex = (currentIndex + 1) % themes.length
    setTheme(themes[nextIndex])
  }

  const getIcon = () => {
    switch (theme) {
      case 'light':
        return <Sun className="h-4 w-4" />
      case 'dark':
        return <Moon className="h-4 w-4" />
      default:
        return <Monitor className="h-4 w-4" />
    }
  }

  const getLabel = () => {
    switch (theme) {
      case 'light':
        return t('settings.lightMode')
      case 'dark':
        return t('settings.darkMode')
      default:
        return t('settings.systemMode')
    }
  }

  return (
    <Button variant="ghost" size="icon" onClick={cycleTheme} title={getLabel()}>
      {getIcon()}
      <span className="sr-only">{getLabel()}</span>
    </Button>
  )
}
