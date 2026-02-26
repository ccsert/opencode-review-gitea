/**
 * Mastra Agent factory for code review
 * Creates a configured review agent with structured output support
 */

import { Agent } from "@mastra/core/agent";
import type { OpenAICompatibleConfig } from "@mastra/core/llm";
import type { GitProvider } from "../providers/types";

export interface ReviewAgentConfig {
  model: string; // Mastra model ID, e.g. 'deepseek/deepseek-chat'
  apiKey: string;
  baseUrl?: string;
  instructions: string;
  provider: GitProvider;
  maxSteps?: number; // default 3
}

export function createReviewAgent(config: ReviewAgentConfig): Agent {
  const modelConfig: OpenAICompatibleConfig = {
    id: config.model as `${string}/${string}`,
    apiKey: config.apiKey,
    ...(config.baseUrl ? { url: config.baseUrl } : {}),
  };

  return new Agent({
    id: "code-review-agent",
    name: "Code Review Agent",
    instructions: config.instructions,
    model: modelConfig,
    // Tools reserved for future autonomous mode
    tools: {},
  });
}
