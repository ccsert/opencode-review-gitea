/**
 * Repository management tools for the platform AI agent.
 * All DB access is injected via RepoToolDeps — core stays DB-independent.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { PlatformToolContext } from "./types";
import { ToolErrorCode } from "./types";

/**
 * Dependency injection interface for repository data access.
 * Implemented by the server package against the actual DB layer.
 */
export interface RepoToolDeps {
  listRepos: (userId: string) => Promise<
    Array<{
      id: string;
      name: string;
      fullName: string;
      provider: string;
      isActive: boolean;
      defaultBranch?: string | null;
      reviewCount?: number;
      lastReviewAt?: Date | null;
    }>
  >;
  getRepo: (id: string) => Promise<{
    id: string;
    name: string;
    fullName: string;
    provider: string;
    isActive: boolean;
    defaultBranch?: string | null;
    config: Record<string, unknown>;
    createdAt?: Date | null;
    updatedAt?: Date | null;
  } | null>;
  configureRepo: (
    id: string,
    config: Record<string, unknown>,
  ) => Promise<{ id: string; updated: boolean } | null>;
  getRepoStats: (id: string) => Promise<{
    totalReviews: number;
    completedReviews: number;
    failedReviews: number;
    avgResponseTime?: number;
    lastReviewAt?: Date | null;
  } | null>;
}

/**
 * Creates the repository management toolset for platform agents.
 *
 * @param ctx  - Authenticated platform context (userId, userRole, etc.)
 * @param deps - DB callbacks injected by the server layer
 */
export function createRepoTools(ctx: PlatformToolContext, deps: RepoToolDeps) {
  return {
    listRepos: createTool({
      id: "list-repos",
      description: "List all repositories managed by the current user",
      inputSchema: z.object({}),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              fullName: z.string(),
              provider: z.string(),
              isActive: z.boolean(),
            }),
          )
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async () => {
        try {
          const repos = await deps.listRepos(ctx.userId);
          return {
            success: true as const,
            data: repos.map((r) => ({
              id: r.id,
              name: r.name,
              fullName: r.fullName,
              provider: r.provider,
              isActive: r.isActive,
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

    getRepo: createTool({
      id: "get-repo",
      description: "Get detailed information about a specific repository by ID",
      inputSchema: z.object({
        repoId: z.string().describe("The repository ID to look up"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            id: z.string(),
            name: z.string(),
            fullName: z.string(),
            provider: z.string(),
            isActive: z.boolean(),
            defaultBranch: z.string().nullable().optional(),
            config: z.record(z.unknown()),
          })
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async (inputData) => {
        try {
          const repo = await deps.getRepo(inputData.repoId);
          if (!repo) {
            return {
              success: false as const,
              error: `Repository not found: ${inputData.repoId}`,
              code: ToolErrorCode.NOT_FOUND,
            };
          }
          return {
            success: true as const,
            data: {
              id: repo.id,
              name: repo.name,
              fullName: repo.fullName,
              provider: repo.provider,
              isActive: repo.isActive,
              defaultBranch: repo.defaultBranch,
              config: repo.config,
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

    configureRepo: createTool({
      id: "configure-repo",
      description:
        "Update configuration for a repository. Requires admin or member role.",
      inputSchema: z.object({
        repoId: z.string().describe("The repository ID to configure"),
        config: z
          .record(z.unknown())
          .describe("Configuration key-value pairs to set"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            id: z.string(),
            updated: z.boolean(),
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
              error: "Permission denied: viewer cannot configure repos",
              code: ToolErrorCode.PERMISSION_DENIED,
            };
          }

          const result = await deps.configureRepo(
            inputData.repoId,
            inputData.config,
          );
          if (!result) {
            return {
              success: false as const,
              error: `Repository not found: ${inputData.repoId}`,
              code: ToolErrorCode.NOT_FOUND,
            };
          }
          return {
            success: true as const,
            data: { id: result.id, updated: result.updated },
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

    getRepoStats: createTool({
      id: "get-repo-stats",
      description: "Get review statistics for a specific repository",
      inputSchema: z.object({
        repoId: z.string().describe("The repository ID to get statistics for"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            totalReviews: z.number(),
            completedReviews: z.number(),
            failedReviews: z.number(),
            avgResponseTime: z.number().optional(),
            lastReviewAt: z.string().nullable().optional(),
          })
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async (inputData) => {
        try {
          const stats = await deps.getRepoStats(inputData.repoId);
          if (!stats) {
            return {
              success: false as const,
              error: `Repository not found: ${inputData.repoId}`,
              code: ToolErrorCode.NOT_FOUND,
            };
          }
          return {
            success: true as const,
            data: {
              totalReviews: stats.totalReviews,
              completedReviews: stats.completedReviews,
              failedReviews: stats.failedReviews,
              avgResponseTime: stats.avgResponseTime,
              lastReviewAt: stats.lastReviewAt?.toISOString() ?? null,
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
