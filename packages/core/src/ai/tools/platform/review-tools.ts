/**
 * Review operation tools for the platform AI agent.
 * All DB access is injected via ReviewToolDeps — core stays DB-independent.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { PlatformToolContext } from "./types";
import { ToolErrorCode } from "./types";

/**
 * Dependency injection interface for review data access.
 * Implemented by the server package against the actual DB layer.
 */
export interface ReviewToolDeps {
  listReviews: (
    userId: string,
    filters?: {
      repositoryId?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    },
  ) => Promise<
    Array<{
      id: string;
      repositoryId: string;
      repositoryName?: string;
      prNumber: number;
      prTitle?: string;
      prAuthor?: string;
      status: string;
      decision?: string | null;
      createdAt?: Date | null;
    }>
  >;
  getReview: (id: string) => Promise<{
    id: string;
    repositoryId: string;
    prNumber: number;
    prTitle?: string;
    prAuthor?: string;
    status: string;
    decision?: string | null;
    summary?: string | null;
    comments?: Array<{
      path: string;
      line: number;
      body: string;
      category?: string;
      severity?: string;
    }> | null;
    createdAt?: Date | null;
    completedAt?: Date | null;
  } | null>;
  triggerReview: (data: {
    repositoryId: string;
    prNumber: number;
    userId: string;
  }) => Promise<{ reviewId: string; status: string }>;
  getReviewSummary: (
    userId: string,
    period?: {
      startDate?: string;
      endDate?: string;
    },
  ) => Promise<{
    totalReviews: number;
    completedReviews: number;
    failedReviews: number;
    approvedCount: number;
    requestChangesCount: number;
    commentCount: number;
    avgCompletionTime?: number;
  }>;
}

/**
 * Creates the review operation toolset for platform agents.
 *
 * @param ctx  - Authenticated platform context (userId, userRole, etc.)
 * @param deps - DB callbacks injected by the server layer
 */
export function createReviewTools(
  ctx: PlatformToolContext,
  deps: ReviewToolDeps,
) {
  return {
    listReviews: createTool({
      id: "list-reviews",
      description: "List code reviews with optional filters",
      inputSchema: z.object({
        repositoryId: z.string().optional().describe("Filter by repository ID"),
        status: z
          .enum(["pending", "processing", "completed", "failed"])
          .optional()
          .describe("Filter by review status"),
        startDate: z
          .string()
          .optional()
          .describe("Start date filter (ISO 8601)"),
        endDate: z.string().optional().describe("End date filter (ISO 8601)"),
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe("Maximum number of results to return"),
        offset: z
          .number()
          .min(0)
          .optional()
          .default(0)
          .describe("Pagination offset"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .array(
            z.object({
              id: z.string(),
              repositoryId: z.string(),
              prNumber: z.number(),
              prTitle: z.string().optional(),
              status: z.string(),
              decision: z.string().nullable().optional(),
              createdAt: z.string().nullable().optional(),
            }),
          )
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async (inputData) => {
        try {
          const reviews = await deps.listReviews(ctx.userId, {
            repositoryId: inputData.repositoryId,
            status: inputData.status,
            startDate: inputData.startDate,
            endDate: inputData.endDate,
            limit: inputData.limit,
            offset: inputData.offset,
          });
          return {
            success: true as const,
            data: reviews.map((r) => ({
              id: r.id,
              repositoryId: r.repositoryId,
              prNumber: r.prNumber,
              prTitle: r.prTitle,
              status: r.status,
              decision: r.decision ?? null,
              createdAt: r.createdAt?.toISOString() ?? null,
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

    getReview: createTool({
      id: "get-review",
      description:
        "Get detailed information about a specific code review including comments",
      inputSchema: z.object({
        reviewId: z.string().describe("The review ID to look up"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            id: z.string(),
            repositoryId: z.string(),
            prNumber: z.number(),
            prTitle: z.string().optional(),
            prAuthor: z.string().optional(),
            status: z.string(),
            decision: z.string().nullable().optional(),
            summary: z.string().nullable().optional(),
            comments: z
              .array(
                z.object({
                  path: z.string(),
                  line: z.number(),
                  body: z.string(),
                  category: z.string().optional(),
                  severity: z.string().optional(),
                }),
              )
              .nullable()
              .optional(),
            createdAt: z.string().nullable().optional(),
            completedAt: z.string().nullable().optional(),
          })
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async (inputData) => {
        try {
          const review = await deps.getReview(inputData.reviewId);
          if (!review) {
            return {
              success: false as const,
              error: `Review not found: ${inputData.reviewId}`,
              code: ToolErrorCode.NOT_FOUND,
            };
          }
          return {
            success: true as const,
            data: {
              id: review.id,
              repositoryId: review.repositoryId,
              prNumber: review.prNumber,
              prTitle: review.prTitle,
              prAuthor: review.prAuthor,
              status: review.status,
              decision: review.decision ?? null,
              summary: review.summary ?? null,
              comments: review.comments ?? null,
              createdAt: review.createdAt?.toISOString() ?? null,
              completedAt: review.completedAt?.toISOString() ?? null,
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

    triggerReview: createTool({
      id: "trigger-review",
      description:
        "Trigger a new AI code review for a pull request. Requires admin or member role.",
      inputSchema: z.object({
        repositoryId: z
          .string()
          .describe("The repository ID containing the PR"),
        prNumber: z.number().describe("The pull request number to review"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            reviewId: z.string(),
            status: z.string(),
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
              error: "Permission denied: viewer cannot trigger reviews",
              code: ToolErrorCode.PERMISSION_DENIED,
            };
          }
          const result = await deps.triggerReview({
            repositoryId: inputData.repositoryId,
            prNumber: inputData.prNumber,
            userId: ctx.userId,
          });
          return {
            success: true as const,
            data: { reviewId: result.reviewId, status: result.status },
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

    getReviewSummary: createTool({
      id: "get-review-summary",
      description:
        "Get aggregated review statistics for the current user over a time period",
      inputSchema: z.object({
        startDate: z
          .string()
          .optional()
          .describe("Period start date (ISO 8601)"),
        endDate: z.string().optional().describe("Period end date (ISO 8601)"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        data: z
          .object({
            totalReviews: z.number(),
            completedReviews: z.number(),
            failedReviews: z.number(),
            approvedCount: z.number(),
            requestChangesCount: z.number(),
            commentCount: z.number(),
            avgCompletionTime: z.number().optional(),
          })
          .optional(),
        error: z.string().optional(),
        code: z.string().optional(),
      }),
      execute: async (inputData) => {
        try {
          const period =
            inputData.startDate || inputData.endDate
              ? {
                  startDate: inputData.startDate,
                  endDate: inputData.endDate,
                }
              : undefined;
          const summary = await deps.getReviewSummary(ctx.userId, period);
          return {
            success: true as const,
            data: {
              totalReviews: summary.totalReviews,
              completedReviews: summary.completedReviews,
              failedReviews: summary.failedReviews,
              approvedCount: summary.approvedCount,
              requestChangesCount: summary.requestChangesCount,
              commentCount: summary.commentCount,
              avgCompletionTime: summary.avgCompletionTime,
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
