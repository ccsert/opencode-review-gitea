/**
 * Mastra Agent factory for code review
 * Creates a configured review agent with structured output support
 */

import { Agent } from "@mastra/core/agent";
import { resolveModel } from "./model-router";
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
  // config.model is in 'provider/modelId' format from resolveModelId()
  const [providerType, ...modelParts] = config.model.split("/");
  const modelId = modelParts.join("/") || providerType;
  const model = resolveModel({
    provider: providerType,
    modelId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });

  return new Agent({
    id: "code-review-agent",
    name: "Code Review Agent",
    instructions: config.instructions,
    model,
    // Tools reserved for future autonomous mode
    tools: {},
  });
}
