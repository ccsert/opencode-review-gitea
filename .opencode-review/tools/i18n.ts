/**
 * Internationalization (i18n) utility
 * Provides translation support for webhook platform
 */

import { readFileSync } from "fs"
import { join } from "path"

type Translations = Record<string, any>

let currentLocale = "en"
let translations: Record<string, Translations> = {}

/**
 * Load translation files
 */
function loadTranslations() {
  try {
    const localesDir = join(__dirname, "../locales")
    const enPath = join(localesDir, "en.json")
    const zhPath = join(localesDir, "zh-CN.json")
    
    translations["en"] = JSON.parse(readFileSync(enPath, "utf-8"))
    translations["zh-CN"] = JSON.parse(readFileSync(zhPath, "utf-8"))
  } catch (error) {
    console.warn("Failed to load translations, using fallback:", error)
    translations["en"] = {}
    translations["zh-CN"] = {}
  }
}

/**
 * Set the current locale
 */
export function setLocale(locale: string) {
  currentLocale = locale
}

/**
 * Get the current locale
 */
export function getLocale(): string {
  return currentLocale
}

/**
 * Get translation for a key
 * Supports nested keys with dot notation: "webhook.list.title"
 * Supports variable interpolation: "Error: {error}"
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  if (Object.keys(translations).length === 0) {
    loadTranslations()
  }
  
  const locale = currentLocale
  const parts = key.split(".")
  let value: any = translations[locale] || translations["en"]
  
  for (const part of parts) {
    if (value && typeof value === "object" && part in value) {
      value = value[part]
    } else {
      // Fallback to English
      value = translations["en"]
      for (const p of parts) {
        if (value && typeof value === "object" && p in value) {
          value = value[p]
        } else {
          return key // Return key if not found
        }
      }
      break
    }
  }
  
  if (typeof value !== "string") {
    return key
  }
  
  // Interpolate variables
  if (vars) {
    return value.replace(/\{(\w+)\}/g, (match, varName) => {
      return varName in vars ? String(vars[varName]) : match
    })
  }
  
  return value
}

/**
 * Initialize i18n with environment variable
 */
export function initI18n() {
  const lang = process.env.REVIEW_LANGUAGE || process.env.LANGUAGE || "auto"
  
  if (lang === "auto") {
    // Auto-detect from system locale
    const systemLocale = process.env.LANG || process.env.LC_ALL || "en"
    if (systemLocale.startsWith("zh")) {
      setLocale("zh-CN")
    } else {
      setLocale("en")
    }
  } else if (lang === "zh-CN" || lang === "zh") {
    setLocale("zh-CN")
  } else {
    setLocale("en")
  }
  
  loadTranslations()
}
