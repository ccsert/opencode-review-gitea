/**
 * 直接 AI 调用客户端
 * 使用 AI SDK 直接调用各种 AI 供应商的 API
 * 作为 OpenCode SDK 的备选方案
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'

export interface DirectAIConfig {
  /** 供应商 ID (deepseek, openai, anthropic, etc.) */
  provider: string
  /** API Key */
  apiKey: string
  /** 自定义 Base URL（可选） */
  baseUrl?: string
  /** 模型 ID */
  model: string
}

export interface DirectAIResult {
  text: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

// 预定义的供应商 Base URL
const PROVIDER_BASE_URLS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/v1',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  together: 'https://api.together.xyz/v1',
  groq: 'https://api.groq.com/openai/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  ollama: 'http://localhost:11434/v1',
}

/**
 * 直接 AI 调用客户端
 */
export class DirectAIClient {
  private config: DirectAIConfig

  constructor(config: DirectAIConfig) {
    this.config = config
  }

  /**
   * 获取 Base URL
   */
  private getBaseUrl(): string {
    if (this.config.baseUrl) {
      return this.config.baseUrl
    }
    return PROVIDER_BASE_URLS[this.config.provider] || PROVIDER_BASE_URLS.openai
  }

  /**
   * 获取模型 ID
   */
  private getModelId(): string {
    // 如果模型 ID 包含 provider 前缀，去掉它
    const model = this.config.model
    if (model.includes('/')) {
      return model.split('/').slice(1).join('/')
    }
    return model
  }

  /**
   * 发送 prompt 并获取 AI 响应
   */
  async prompt(
    userMessage: string,
    options: { systemPrompt?: string } = {}
  ): Promise<DirectAIResult> {
    const baseUrl = this.getBaseUrl()
    const modelId = this.getModelId()

    console.log(`[DirectAIClient] Calling ${this.config.provider} API`)
    console.log(`[DirectAIClient] Base URL: ${baseUrl}`)
    console.log(`[DirectAIClient] Model: ${modelId}`)
    console.log(`[DirectAIClient] User message length: ${userMessage.length}`)
    if (options.systemPrompt) {
      console.log(`[DirectAIClient] System prompt length: ${options.systemPrompt.length}`)
    }

    // 创建 OpenAI 兼容的 provider
    const provider = createOpenAICompatible({
      baseURL: baseUrl,
      name: this.config.provider,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    })

    // 调用 AI
    const result = await generateText({
      model: provider(modelId),
      system: options.systemPrompt,
      prompt: userMessage,
      maxOutputTokens: 8192,
    })

    console.log(`[DirectAIClient] Response received, length: ${result.text.length}`)
    console.log(`[DirectAIClient] Usage:`, result.usage)

    // 从 usage 中提取 token 信息
    const usage = result.usage as { promptTokens?: number; completionTokens?: number } | undefined

    return {
      text: result.text,
      usage: usage ? {
        promptTokens: usage.promptTokens || 0,
        completionTokens: usage.completionTokens || 0,
        totalTokens: (usage.promptTokens || 0) + (usage.completionTokens || 0),
      } : undefined,
    }
  }
}

/**
 * 创建直接 AI 调用客户端
 */
export function createDirectClient(config: DirectAIConfig): DirectAIClient {
  return new DirectAIClient(config)
}
