/**
 * AI Module - Mastra Agent integration for code review
 */

// Structured output schemas
export { reviewCommentSchema, reviewResultSchema } from "./schemas";
export type { ReviewOutput, ReviewComment } from "./schemas";

// AI provider configuration
export { resolveModelId, resolveModelConfig } from "./provider";
export type { AIProviderConfig } from "./provider";

// Model router — routes to correct native AI SDK provider
export { resolveModel } from "./model-router";
export type { ModelRouterConfig, AIProviderType } from "./model-router";

// Mastra Agent factory
export { createReviewAgent } from "./agent";
export type { ReviewAgentConfig } from "./agent";

// Tools (git tools + platform management tools)
export * from "./tools";

// Platform Agent factory
export { createPlatformAgent } from "./platform-agent";
export type { PlatformAgentConfig, PlatformAgentDeps } from "./platform-agent";
