/**
 * AI Module - Mastra Agent integration for code review
 */

// Structured output schemas
export { reviewCommentSchema, reviewResultSchema } from "./schemas";
export type { ReviewOutput, ReviewComment } from "./schemas";

// AI provider configuration
export { resolveModelId, resolveModelConfig } from "./provider";
export type { AIProviderConfig } from "./provider";

// Mastra Agent factory
export { createReviewAgent } from "./agent";
export type { ReviewAgentConfig } from "./agent";

// Tools (reserved for future autonomous mode)
export { createGitDiffTool, createGitReviewTool } from "./tools";

// Platform Agent factory
export { createPlatformAgent } from "./platform-agent";
export type { PlatformAgentConfig, PlatformAgentDeps } from "./platform-agent";
