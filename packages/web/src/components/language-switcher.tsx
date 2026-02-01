import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supportedLanguages } from '@/i18n'

export function LanguageSwitcher() {
  const { i18n } = useTranslation()

  const currentLang = supportedLanguages.find(
    (lang) => lang.code === i18n.language
  )

  const toggleLanguage = () => {
    const currentIndex = supportedLanguages.findIndex(
      (lang) => lang.code === i18n.language
    )
    const nextIndex = (currentIndex + 1) % supportedLanguages.length
    i18n.changeLanguage(supportedLanguages[nextIndex].code)
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleLanguage}
      title={currentLang?.nativeName}
    >
      <Languages className="h-4 w-4" />
      <span className="sr-only">{currentLang?.nativeName}</span>
    </Button>
  )
}
