/**
 * AI 模块 - OpenCode SDK 集成 + 直接 AI 调用
 */

export {
  OpenCodeClient,
  createClient,
  getGlobalClient,
  resetGlobalClient
} from './client'

export type { 
  OpenCodeClientConfig, 
  PromptOptions, 
  PromptResult 
} from './client'

export {
  DirectAIClient,
  createDirectClient,
} from './direct-client'

export type {
  DirectAIConfig,
  DirectAIResult,
} from './direct-client'
