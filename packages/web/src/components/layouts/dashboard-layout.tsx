import { Outlet, Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  GitBranch,
  FileSearch,
  FileText,
  Settings,
  Key,
  LogOut,
  Server,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/language-switcher'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { useAuthStore } from '@/stores/auth'

const navItems = [
  { key: 'dashboard', icon: LayoutDashboard, href: '/' },
  { key: 'platforms', icon: Server, href: '/platforms' },
  { key: 'repositories', icon: GitBranch, href: '/repositories' },
  { key: 'reviews', icon: FileSearch, href: '/reviews' },
  { key: 'templates', icon: FileText, href: '/templates' },
  { key: 'apiKeys', icon: Key, href: '/api-keys' },
  { key: 'settings', icon: Settings, href: '/settings' },
]

export function DashboardLayout() {
  const { t } = useTranslation()
  const location = useLocation()
  const { clearTokens } = useAuthStore()

  const handleLogout = () => {
    clearTokens()
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r bg-card">
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center border-b px-6">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <FileSearch className="h-4 w-4" />
              </div>
              <span className="font-semibold">{t('app.title')}</span>
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 px-3 py-4">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = location.pathname === item.href
              return (
                <Link
                  key={item.key}
                  to={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t(`nav.${item.key}`)}
                </Link>
              )
            })}
          </nav>

          {/* Logout */}
          <div className="border-t p-3">
            <Button
              variant="ghost"
              className="w-full justify-start gap-3"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              {t('nav.logout')}
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 pl-64">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-end gap-2 border-b bg-background/95 px-6 backdrop-blur supports-backdrop-filter:bg-background/60">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </header>

        {/* Page content */}
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
