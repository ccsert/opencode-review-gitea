/**
 * Platform Agent factory
 * Creates a Mastra Agent with all platform management tools loaded.
 * The agent acts as a "全能管家" (universal steward) for the platform.
 */

import { Agent } from "@mastra/core/agent";
import { resolveModel } from "./model-router";
import {
  createTemplateTools,
  type TemplateToolDeps,
} from "./tools/platform/template-tools";
import {
  createRepoTools,
  type RepoToolDeps,
} from "./tools/platform/repo-tools";
import {
  createReviewTools,
  type ReviewToolDeps,
} from "./tools/platform/review-tools";
import {
  createAIConfigTools,
  type AIConfigToolDeps,
} from "./tools/platform/ai-config-tools";
import {
  createWebhookTools,
  type WebhookToolDeps,
} from "./tools/platform/webhook-tools";
import {
  createSystemTools,
  type SystemToolDeps,
} from "./tools/platform/system-tools";
import type { PlatformToolContext } from "./tools/platform/types";

/**
 * All dependency injection interfaces combined for the platform agent
 */
export interface PlatformAgentDeps {
  template: TemplateToolDeps;
  repo: RepoToolDeps;
  review: ReviewToolDeps;
  aiConfig: AIConfigToolDeps;
  webhook: WebhookToolDeps;
  system: SystemToolDeps;
}

/**
 * Configuration for creating a platform agent instance
 */
export interface PlatformAgentConfig {
  /** AI model ID, e.g. 'deepseek/deepseek-chat' */
  model: string;
  /** AI provider API key */
  apiKey: string;
  /** Optional AI provider base URL */
  baseUrl?: string;
  /** Max tool-call steps per turn (default: 10) */
  maxSteps?: number;
  /** Platform context injected into every tool */
  ctx: PlatformToolContext;
  /** Dependency injection for all tool domains */
  deps: PlatformAgentDeps;
}

const PLATFORM_AGENT_SYSTEM_PROMPT = `You are the OpenCode Review Platform Agent — a universal steward ("全能管家") for managing the AI-powered code review platform.

## Your Capabilities

You have access to tools organized in 6 domains:

### 1. Template Management
- List, create, update, delete, and clone review templates
- Test templates with sample data and preview rendered output
- Manage default template assignment

### 2. Repository Management
- List, add, update, and remove repositories
- Configure review settings per repository (file patterns, language, style)
- Monitor repository status and review counts

### 3. Review Operations
- List reviews with filtering (by repo, status, date range)
- Get detailed review information including comments
- View review statistics and trends
- Trigger manual reviews and retry failed ones

### 4. AI Provider Configuration
- List and configure AI providers (OpenAI, Anthropic, DeepSeek, etc.)
- Set default provider, enable/disable providers
- Test provider connections to verify API keys

### 5. Webhook Management
- List registered webhooks and their status
- Register new webhooks for repositories
- Delete webhooks and view delivery history

### 6. System Management
- Check system health and database connectivity
- View system configuration and environment
- Get dashboard data with key metrics

## Guidelines

1. **Be precise**: When users ask about specific resources, use the appropriate tool to fetch real data. Never guess or fabricate information.
2. **Be helpful**: Suggest related actions. If a user adds a repository, offer to set up a webhook for it.
3. **Be safe**: For destructive operations (delete, overwrite), confirm the target resource before proceeding.
4. **Be efficient**: Minimize tool calls. If you need multiple pieces of data, consider which tools to call.
5. **Respect permissions**: The tools enforce role-based access. If an operation fails with PERMISSION_DENIED, explain what role is required.
6. **Error handling**: When a tool returns an error, explain what went wrong in plain language and suggest how to fix it.

## Communication Style

- Respond in the same language the user uses (Chinese or English)
- Be concise but thorough
- Use structured formatting (lists, tables) for multi-item results
- When showing review data, include key metrics (status, comments count, model used)
`;

/**
 * Creates a Platform Agent instance with all management tools loaded.
 *
 * @example
 * ```typescript
 * const agent = createPlatformAgent({
 *   model: 'deepseek/deepseek-chat',
 *   apiKey: 'sk-xxx',
 *   ctx: { db, userId: 'user_123', userRole: 'admin' },
 *   deps: { template: templateDeps, repo: repoDeps, ... },
 * });
 *
 * const result = await agent.generate('List all repositories');
 * ```
 */
export function createPlatformAgent(config: PlatformAgentConfig): Agent {
  // Create all tool sets via dependency injection
  const templateTools = createTemplateTools(config.ctx, config.deps.template);
  const repoTools = createRepoTools(config.ctx, config.deps.repo);
  const reviewTools = createReviewTools(config.ctx, config.deps.review);
  const aiConfigTools = createAIConfigTools(config.ctx, config.deps.aiConfig);
  const webhookTools = createWebhookTools(config.ctx, config.deps.webhook);
  const systemTools = createSystemTools(config.ctx, config.deps.system);

  // Merge all tools into a single record
  const tools = {
    ...templateTools,
    ...repoTools,
    ...reviewTools,
    ...aiConfigTools,
    ...webhookTools,
    ...systemTools,
  };

  // Split 'provider/modelId' format back into components for router
  const [providerType, ...modelParts] = config.model.split("/");
  const modelId = modelParts.join("/") || providerType;
  const model = resolveModel({
    provider: providerType,
    modelId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });

  return new Agent({
    id: "platform-agent",
    name: "OpenCode Review Platform Agent",
    instructions: PLATFORM_AGENT_SYSTEM_PROMPT,
    model,
    tools,
  });
}
