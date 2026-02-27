/**
 * Platform tools barrel export
 * Re-exports all platform management tool factories, deps interfaces, and types
 */

// Shared types and helpers
export {
  ToolErrorCode,
  ok,
  err,
  type ToolResult,
  type PlatformDB,
  type PlatformToolContext,
} from "./types";

// Template management tools
export { createTemplateTools, type TemplateToolDeps } from "./template-tools";

// Repository management tools
export { createRepoTools, type RepoToolDeps } from "./repo-tools";

// Review operation tools
export { createReviewTools, type ReviewToolDeps } from "./review-tools";

// AI config management tools
export { createAIConfigTools, type AIConfigToolDeps } from "./ai-config-tools";

// Webhook management tools
export { createWebhookTools, type WebhookToolDeps } from "./webhook-tools";

// System management tools
export { createSystemTools, type SystemToolDeps } from "./system-tools";
