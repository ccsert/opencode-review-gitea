/**
 * Model Router
 *
 * Routes AI provider configuration to the appropriate model format for Mastra Agent.
 *
 * ## Mastra Native Routing (OpenAICompatibleConfig "provider/model" string)
 * Mastra has a built-in model router that natively handles 100+ providers via
 * the "provider/model" ID format — no custom SDK instances needed:
 *   openai, deepseek, minimax, zai (GLM), groq, mistral, xai, ollama, openrouter, etc.
 * Full list: https://mastra.ai/models/providers/
 *
 * ## Native SDK (truly incompatible API formats)
 * Only two providers require their own SDK because their APIs differ from OpenAI:
 *   - anthropic → @ai-sdk/anthropic
 *   - google    → @ai-sdk/google
 *
 * ## Provider ID mapping (DB name → Mastra routing ID)
 *   - glm / zhipu → zai   (Zhipu AI's international domain is z.ai)
 *   - minimax     → minimax (same in Mastra, model IDs are lowercase)
 *   - everything else → pass-through
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { OpenAICompatibleConfig } from "@mastra/core/llm";
import type { MastraModelConfig } from "@mastra/core/llm";

export type AIProviderType =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "glm"
  | "zhipu"
  | "minimax"
  | "minimax-cn"
  | "groq"
  | "mistral"
  | "xai"
  | "openrouter"
  | "ollama"
  | "custom";

export interface ModelRouterConfig {
  /** Provider identifier stored in DB, e.g. 'openai', 'anthropic', 'deepseek', 'glm' */
  provider: string;
  /** Model ID without provider prefix, e.g. 'gpt-4o', 'deepseek-chat', 'glm-4-plus' */
  modelId: string;
  /** API key for the provider */
  apiKey: string;
  /** Optional custom base URL override */
  baseUrl?: string;
}

/**
 * DB provider name → Mastra model router provider ID.
 * Only needed where names differ.
 */
const PROVIDER_ID_MAP: Record<string, string> = {
  glm: "zai",    // Zhipu AI → z.ai (Mastra provider ID)
  zhipu: "zai",
};

/**
 * Creates the appropriate model config for Mastra Agent's `model` field.
 *
 * - anthropic / google: native SDK instances (API format differs from OpenAI)
 * - everything else: Mastra's native model router via OpenAICompatibleConfig
 *   Mastra handles routing, API key injection, and provider-specific quirks.
 */
export function resolveModel(config: ModelRouterConfig): MastraModelConfig {
  const { provider, modelId, apiKey, baseUrl } = config;

  // ── Anthropic: incompatible API (x-api-key header, different message format)
  if (provider === "anthropic") {
    const client = createAnthropic({
      apiKey,
      ...(baseUrl && { baseURL: baseUrl }),
    });
    return client(modelId);
  }

  // ── Google: incompatible API (Gemini-specific protocol)
  if (provider === "google") {
    const client = createGoogleGenerativeAI({
      apiKey,
      ...(baseUrl && { baseURL: baseUrl }),
    });
    return client(modelId);
  }

  // ── All other providers: Mastra's built-in model router
  // Mastra natively supports: openai, deepseek, minimax, zai (GLM/Zhipu),
  // groq, mistral, xai, ollama, openrouter, and 100+ more.
  // Thinking/reasoning models (DeepSeek-R1, MiniMax-M1, etc.) are handled
  // automatically by Mastra's gateway when using the string ID format.
  const routerId = PROVIDER_ID_MAP[provider] ?? provider;

  const compatConfig: OpenAICompatibleConfig = {
    id: `${routerId}/${modelId}` as `${string}/${string}`,
    apiKey,
    ...(baseUrl && { url: baseUrl }),
  };
  return compatConfig;
}


