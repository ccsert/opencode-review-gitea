/**
 * AI provider configuration tools for the platform AI agent.
 * All DB access is injected via AIConfigToolDeps — core stays DB-independent.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { PlatformToolContext } from "./types";
import { ToolErrorCode } from "./types";

/** Supported AI provider types */
const providerEnum = z.enum([
  "openai",
  "anthropic",
  "deepseek",
  "openrouter",
  "ollama",
  "custom",
]);

/**
 * Dependency injection interface for AI provider data access.
 * Implemented by the server package against the actual DB layer.
 */
export interface AIConfigToolDeps {
  listProviders: (userId: string) => Promise<
    Array<{
      id: string;
      name: string;
      provider: string;
      baseUrl?: string | null;
      models?: string[] | null;
      defaultModel?: string | null;
      isDefault: boolean;
      isEnabled: boolean;
      lastUsedAt?: Date | null;
    }>
  >;
  getProvider: (id: string) => Promise<{
    id: string;
    name: string;
    provider: string;
    baseUrl?: string | null;
    models?: string[] | null;
    defaultModel?: string | null;
    isDefault: boolean;
    isEnabled: boolean;
    config: Record<string, unknown>;
    lastUsedAt?: Date | null;
    createdAt?: Date | null;
  } | null>;
  configureProvider: (
    userId: string,
    data: {
      name: string;
      provider: string;
      baseUrl?: string;
      apiKey?: string;
      models?: string[];
      defaultModel?: string;
      isDefault?: boolean;
      config?: Record<string, unknown>;
    },
  ) => Promise<{
    id: string;
    name: string;
    provider: string;
    isDefault: boolean;
  }>;
  testProvider: (params: {
    provider: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  }) => Promise<{
    connected: boolean;
    models?: string[];
    message: string;
  }>;
}

/**
 * Creates the AI provider configuration toolset for platform agents.
 *
 * @param ctx  - Authenticated platform context (userId, userRole, etc.)
 * @param deps - DB callbacks injected by the server layer
 */
export function createAIConfigTools(
  ctx: PlatformToolContext,
  deps: AIConfigToolDeps,
) {
  return {
    listAIProviders: createTool({
      id: "list-ai-providers",
      description:
        "List all AI providers configured by the current user, including their status and default model",
      inputSchema: z.object({}),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              provider: z.string(),
              isDefault: z.boolean(),
              isEnabled: z.boolean(),
              defaultModel: z.string().nullable().optional(),
            }),
          )
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async () => {
        try {
          const providers = await deps.listProviders(ctx.userId);
          return {
            success: true as const,
            data: providers.map((p) => ({
              id: p.id,
              name: p.name,
              provider: p.provider,
              isDefault: p.isDefault,
              isEnabled: p.isEnabled,
              defaultModel: p.defaultModel ?? null,
            })),
          };
        } catch (e) {
          return {
            success: false as const,
            error: String(e),
            code: ToolErrorCode.INTERNAL_ERROR,
          };
        }
      },
    }),

    configureAIProvider: createTool({
      id: "configure-ai-provider",
      description:
        "Create or update an AI provider configuration. Requires admin or member role.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .max(50)
          .describe("User-friendly name for the provider"),
        provider: providerEnum.describe("AI provider type"),
        baseUrl: z
          .string()
          .optional()
          .describe("Custom API base URL (uses preset default if omitted)"),
        apiKey: z
          .string()
          .optional()
          .describe("API key for the provider (encrypted at rest)"),
        models: z
          .array(z.string())
          .optional()
          .describe("List of available model IDs"),
        defaultModel: z
          .string()
          .optional()
          .describe("Default model to use for reviews"),
        isDefault: z
          .boolean()
          .optional()
          .describe("Set as the default provider for the user"),
        config: z
          .record(z.unknown())
          .optional()
          .describe(
            "Additional configuration (maxTokens, temperature, timeout, etc.)",
          ),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            id: z.string(),
            name: z.string(),
            provider: z.string(),
            isDefault: z.boolean(),
          })
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async (inputData) => {
        try {
          if (ctx.userRole === "viewer") {
            return {
              success: false as const,
              error: "Permission denied: viewer cannot configure AI providers",
              code: ToolErrorCode.PERMISSION_DENIED,
            };
          }

          const result = await deps.configureProvider(ctx.userId, {
            name: inputData.name,
            provider: inputData.provider,
            baseUrl: inputData.baseUrl,
            apiKey: inputData.apiKey,
            models: inputData.models,
            defaultModel: inputData.defaultModel,
            isDefault: inputData.isDefault,
            config: inputData.config,
          });
          return {
            success: true as const,
            data: {
              id: result.id,
              name: result.name,
              provider: result.provider,
              isDefault: result.isDefault,
            },
          };
        } catch (e) {
          return {
            success: false as const,
            error: String(e),
            code: ToolErrorCode.INTERNAL_ERROR,
          };
        }
      },
    }),

    testAIProvider: createTool({
      id: "test-ai-provider",
      description:
        "Test connectivity to an AI provider by making a simple API call",
      inputSchema: z.object({
        provider: providerEnum.describe("AI provider type to test"),
        baseUrl: z
          .string()
          .optional()
          .describe("API base URL (uses preset default if omitted)"),
        apiKey: z.string().optional().describe("API key for authentication"),
        model: z.string().optional().describe("Specific model to test against"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            connected: z.boolean(),
            models: z.array(z.string()).optional(),
            message: z.string(),
          })
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async (inputData) => {
        try {
          const result = await deps.testProvider({
            provider: inputData.provider,
            baseUrl: inputData.baseUrl,
            apiKey: inputData.apiKey,
            model: inputData.model,
          });
          return {
            success: true as const,
            data: {
              connected: result.connected,
              models: result.models,
              message: result.message,
            },
          };
        } catch (e) {
          return {
            success: false as const,
            error: String(e),
            code: ToolErrorCode.INTERNAL_ERROR,
          };
        }
      },
    }),
  };
}
