/**
 * Git PR diff tool (reserved for future autonomous mode)
 * Tool factory pattern — each instance is bound to a specific GitProvider
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { GitProvider } from "../../providers/types";

export const createGitDiffTool = (provider: GitProvider) =>
  createTool({
    id: "git-pr-diff",
    description: "Get Pull Request code diff",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
    }),
    outputSchema: z.object({
      diff: z.string(),
      filesChanged: z.number(),
      additions: z.number(),
      deletions: z.number(),
    }),
    execute: async (inputData) => {
      const diff = await provider.getPullRequestDiff(
        inputData.owner,
        inputData.repo,
        inputData.pullNumber,
      );
      return { diff, filesChanged: 0, additions: 0, deletions: 0 };
    },
  });
