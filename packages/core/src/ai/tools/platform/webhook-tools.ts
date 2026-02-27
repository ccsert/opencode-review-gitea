/**
 * Webhook management tools for the platform AI agent.
 * All DB access is injected via WebhookToolDeps — core stays DB-independent.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { PlatformToolContext } from "./types";
import { ToolErrorCode } from "./types";

/**
 * Dependency injection interface for webhook data access.
 * Implemented by the server package against the actual DB layer.
 */
export interface WebhookToolDeps {
  listWebhooks: (repoId: string) => Promise<
    Array<{
      id: string;
      repositoryId: string;
      repositoryName: string;
      provider: string;
      webhookUrl: string;
      webhookStatus: string;
      secretConfigured: boolean;
      enabled: boolean;
    }>
  >;
  registerWebhook: (
    repoId: string,
    userId: string,
  ) => Promise<{
    id: string;
    webhookUrl: string;
    webhookStatus: string;
  }>;
  deleteWebhook: (
    repoId: string,
    userId: string,
  ) => Promise<{ deleted: boolean }>;
  getWebhookHistory: (
    repoId: string,
    options?: { limit?: number; offset?: number },
  ) => Promise<{
    items: Array<{
      id: string;
      eventType: string;
      deliveryId?: string | null;
      processed: boolean;
      reviewId?: string | null;
      error?: string | null;
      createdAt?: Date | null;
    }>;
    total: number;
  }>;
}

/**
 * Creates the webhook management toolset for platform agents.
 *
 * @param ctx  - Authenticated platform context (userId, userRole, etc.)
 * @param deps - DB callbacks injected by the server layer
 */
export function createWebhookTools(
  ctx: PlatformToolContext,
  deps: WebhookToolDeps,
) {
  return {
    listWebhooks: createTool({
      id: "list-webhooks",
      description:
        "List all webhooks configured for a specific repository, including their status",
      inputSchema: z.object({
        repoId: z.string().describe("The repository ID to list webhooks for"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .array(
            z.object({
              id: z.string(),
              repositoryId: z.string(),
              repositoryName: z.string(),
              provider: z.string(),
              webhookUrl: z.string(),
              webhookStatus: z.string(),
              secretConfigured: z.boolean(),
              enabled: z.boolean(),
            }),
          )
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async (inputData) => {
        try {
          const webhooks = await deps.listWebhooks(inputData.repoId);
          return {
            success: true as const,
            data: webhooks,
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

    registerWebhook: createTool({
      id: "register-webhook",
      description:
        "Register a new webhook for a repository on the git provider. Requires admin or member role.",
      inputSchema: z.object({
        repoId: z
          .string()
          .describe("The repository ID to register the webhook for"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            id: z.string(),
            webhookUrl: z.string(),
            webhookStatus: z.string(),
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
              error: "Permission denied: viewer cannot register webhooks",
              code: ToolErrorCode.PERMISSION_DENIED,
            };
          }

          const result = await deps.registerWebhook(
            inputData.repoId,
            ctx.userId,
          );
          return {
            success: true as const,
            data: {
              id: result.id,
              webhookUrl: result.webhookUrl,
              webhookStatus: result.webhookStatus,
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

    deleteWebhook: createTool({
      id: "delete-webhook",
      description:
        "Delete (unregister) a webhook from a repository. Requires admin or member role.",
      inputSchema: z.object({
        repoId: z
          .string()
          .describe("The repository ID to delete the webhook from"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            deleted: z.boolean(),
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
              error: "Permission denied: viewer cannot delete webhooks",
              code: ToolErrorCode.PERMISSION_DENIED,
            };
          }

          const result = await deps.deleteWebhook(inputData.repoId, ctx.userId);
          if (!result.deleted) {
            return {
              success: false as const,
              error: `Webhook not found for repository: ${inputData.repoId}`,
              code: ToolErrorCode.NOT_FOUND,
            };
          }
          return {
            success: true as const,
            data: { deleted: true },
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

    getWebhookHistory: createTool({
      id: "get-webhook-history",
      description:
        "Get webhook delivery history (logs) for a specific repository",
      inputSchema: z.object({
        repoId: z
          .string()
          .describe("The repository ID to get webhook history for"),
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum number of entries to return (default 20)"),
        offset: z.number().min(0).optional().describe("Offset for pagination"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            items: z.array(
              z.object({
                id: z.string(),
                eventType: z.string(),
                deliveryId: z.string().nullable().optional(),
                processed: z.boolean(),
                reviewId: z.string().nullable().optional(),
                error: z.string().nullable().optional(),
                createdAt: z.string().nullable().optional(),
              }),
            ),
            total: z.number(),
          })
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async (inputData) => {
        try {
          const result = await deps.getWebhookHistory(inputData.repoId, {
            limit: inputData.limit,
            offset: inputData.offset,
          });
          return {
            success: true as const,
            data: {
              items: result.items.map((item) => ({
                id: item.id,
                eventType: item.eventType,
                deliveryId: item.deliveryId ?? null,
                processed: item.processed,
                reviewId: item.reviewId ?? null,
                error: item.error ?? null,
                createdAt: item.createdAt?.toISOString() ?? null,
              })),
              total: result.total,
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
