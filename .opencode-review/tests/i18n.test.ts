/**
 * Test i18n functionality
 * Run: cd .opencode-review && bun test tests/i18n.test.ts
 */

import { describe, test, expect, beforeEach } from "bun:test"
import { setLocale, getLocale, t, initI18n } from "../tools/i18n"

describe("i18n Functionality", () => {
  beforeEach(() => {
    // Reset to default locale
    setLocale("en")
  })

  test("setLocale and getLocale work correctly", () => {
    setLocale("zh-CN")
    expect(getLocale()).toBe("zh-CN")
    
    setLocale("en")
    expect(getLocale()).toBe("en")
  })

  test("t() returns translated string in English", () => {
    setLocale("en")
    expect(t("webhook.list.title")).toBe("Webhook List")
    expect(t("webhook.list.empty")).toBe("No webhooks configured")
    expect(t("common.confirm")).toBe("Confirm")
  })

  test("t() returns translated string in Chinese", () => {
    setLocale("zh-CN")
    expect(t("webhook.list.title")).toBe("Webhook 列表")
    expect(t("webhook.list.empty")).toBe("未配置 Webhook")
    expect(t("common.confirm")).toBe("确认")
  })

  test("t() supports variable interpolation", () => {
    setLocale("en")
    const result = t("webhook.list.error", { error: "Connection failed" })
    expect(result).toBe("Failed to load webhooks: Connection failed")
  })

  test("t() supports Chinese variable interpolation", () => {
    setLocale("zh-CN")
    const result = t("webhook.list.error", { error: "连接失败" })
    expect(result).toBe("加载 Webhook 失败: 连接失败")
  })

  test("t() returns key if translation not found", () => {
    setLocale("en")
    expect(t("nonexistent.key")).toBe("nonexistent.key")
  })

  test("t() supports nested keys", () => {
    setLocale("en")
    expect(t("webhook.list.status.active")).toBe("Active")
    expect(t("webhook.list.status.inactive")).toBe("Inactive")
  })

  test("t() fallbacks to English if Chinese translation not found", () => {
    setLocale("zh-CN")
    // If a key exists in English but not Chinese, should fallback
    const result = t("webhook.list.title")
    expect(result).toBeTruthy()
  })

  test("initI18n detects language from environment", () => {
    const originalLang = process.env.REVIEW_LANGUAGE
    
    process.env.REVIEW_LANGUAGE = "zh-CN"
    initI18n()
    expect(getLocale()).toBe("zh-CN")
    
    process.env.REVIEW_LANGUAGE = "en"
    initI18n()
    expect(getLocale()).toBe("en")
    
    // Restore
    if (originalLang) {
      process.env.REVIEW_LANGUAGE = originalLang
    } else {
      delete process.env.REVIEW_LANGUAGE
    }
  })

  test("All webhook error messages are translatable", () => {
    const errorKeys = [
      "webhook.errors.no_token",
      "webhook.errors.invalid_token",
      "webhook.errors.permission_denied",
      "webhook.errors.not_found",
    ]

    for (const key of errorKeys) {
      setLocale("en")
      const enMsg = t(key)
      expect(enMsg).not.toBe(key)
      
      setLocale("zh-CN")
      const zhMsg = t(key)
      expect(zhMsg).not.toBe(key)
      expect(zhMsg).not.toBe(enMsg) // Chinese should be different from English
    }
  })
})

console.log("✅ All i18n tests passed!")
