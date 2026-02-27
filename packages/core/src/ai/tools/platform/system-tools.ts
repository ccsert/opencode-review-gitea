/**
 * System management tools for the platform AI agent.
 * All DB access is injected via SystemToolDeps — core stays DB-independent.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { PlatformToolContext } from "./types";
import { ToolErrorCode } from "./types";

/**
 * Dependency injection interface for system data access.
 * Implemented by the server package against the actual DB layer.
 */
export interface SystemToolDeps {
  getHealth: () => Promise<{
    status: "healthy" | "unhealthy";
    database: string;
    version: string;
    error?: string;
  }>;
  getConfig: () => Promise<{
    providers: string[];
    features: Record<string, boolean>;
    limits: Record<string, number>;
  }>;
  getDashboardData: (userId: string) => Promise<{
    repoCount: number;
    reviewCount: number;
    completedReviews: number;
    failedReviews: number;
    recentActivity: Array<{
      id: string;
      type: string;
      description: string;
      createdAt?: Date | null;
    }>;
  }>;
}

/**
 * Creates the system management toolset for platform agents.
 *
 * @param ctx  - Authenticated platform context (userId, userRole, etc.)
 * @param deps - DB callbacks injected by the server layer
 */
export function createSystemTools(
  ctx: PlatformToolContext,
  deps: SystemToolDeps,
) {
  return {
    getSystemHealth: createTool({
      id: "get-system-health",
      description:
        "Check the health status of the platform, including database and service connectivity",
      inputSchema: z.object({}),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            status: z.string(),
            database: z.string(),
            version: z.string(),
            error: z.string().optional(),
          })
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async () => {
        try {
          const health = await deps.getHealth();
          return {
            success: true as const,
            data: {
              status: health.status,
              database: health.database,
              version: health.version,
              error: health.error,
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

    getSystemConfig: createTool({
      id: "get-system-config",
      description:
        "Get the current system configuration summary, including supported providers, features, and limits",
      inputSchema: z.object({}),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            providers: z.array(z.string()),
            features: z.record(z.boolean()),
            limits: z.record(z.number()),
          })
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async () => {
        try {
          const config = await deps.getConfig();
          return {
            success: true as const,
            data: {
              providers: config.providers,
              features: config.features,
              limits: config.limits,
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

    getDashboardData: createTool({
      id: "get-dashboard-data",
      description:
        "Get aggregated dashboard data for the current user, including repo count, review stats, and recent activity",
      inputSchema: z.object({}),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            repoCount: z.number(),
            reviewCount: z.number(),
            completedReviews: z.number(),
            failedReviews: z.number(),
            recentActivity: z.array(
              z.object({
                id: z.string(),
                type: z.string(),
                description: z.string(),
                createdAt: z.string().nullable().optional(),
              }),
            ),
          })
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async () => {
        try {
          const dashboard = await deps.getDashboardData(ctx.userId);
          return {
            success: true as const,
            data: {
              repoCount: dashboard.repoCount,
              reviewCount: dashboard.reviewCount,
              completedReviews: dashboard.completedReviews,
              failedReviews: dashboard.failedReviews,
              recentActivity: dashboard.recentActivity.map((a) => ({
                id: a.id,
                type: a.type,
                description: a.description,
                createdAt: a.createdAt?.toISOString() ?? null,
              })),
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
