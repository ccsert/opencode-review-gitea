/**
 * AI Provider configuration and model resolution
 * Supports multi-provider: OpenAI, DeepSeek, Anthropic, Google, etc.
 */

export interface AIProviderConfig {
  provider: string; // 'openai' | 'deepseek' | 'anthropic' | 'google' | 'xai'
  model: string; // 'gpt-4o' | 'deepseek-chat' | 'claude-4-5-sonnet'
  apiKey: string;
  baseUrl?: string;
}

/**
 * Resolve provider + model into Mastra model ID format
 * e.g. 'deepseek' + 'deepseek-chat' → 'deepseek/deepseek-chat'
 */
export function resolveModelId(config: AIProviderConfig): string {
  return `${config.provider}/${config.model}`;
}

/**
 * Resolve full model config for Mastra Agent constructor
 */
export function resolveModelConfig(config: AIProviderConfig) {
  return {
    id: resolveModelId(config),
    apiKey: config.apiKey,
    ...(config.baseUrl && { url: config.baseUrl }),
  };
}
