/**
 * Git review submission tool (reserved for future autonomous mode)
 * Tool factory pattern — each instance is bound to a specific GitProvider
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { GitProvider } from "../../providers/types";

export const createGitReviewTool = (provider: GitProvider) =>
  createTool({
    id: "git-submit-review",
    description: "Submit code review with decision, summary, and line comments",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
      decision: z.enum(["APPROVED", "REQUEST_CHANGES", "COMMENT"]),
      summary: z.string(),
      comments: z
        .array(
          z.object({
            path: z.string(),
            line: z.number(),
            body: z.string(),
          }),
        )
        .optional(),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      reviewId: z.number().optional(),
    }),
    execute: async (inputData) => {
      const result = await provider.createReview(
        inputData.owner,
        inputData.repo,
        inputData.pullNumber,
        {
          body: inputData.summary,
          decision: inputData.decision,
          comments: inputData.comments,
        },
      );
      return { success: true, reviewId: result?.id };
    },
  });
