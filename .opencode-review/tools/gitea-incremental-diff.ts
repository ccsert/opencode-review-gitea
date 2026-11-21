import { z } from "zod"
import DESCRIPTION from "./gitea-incremental-diff.txt"
import { fetchReviewDiff } from "../lib/review-diff"
import { giteaTool } from "../lib/tool"

export default giteaTool({
  name: "gitea-incremental-diff",
  description: DESCRIPTION,
  input: z.object({
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    pull_number: z.number().describe("Pull request number"),
    format: z
      .enum(["raw", "parsed"])
      .optional()
      .default("parsed")
      .describe("Output format: 'raw' for unified diff, 'parsed' for line-numbered format"),
    page: z
      .number()
      .optional()
      .describe("Output page (default 1). Large diffs are split into pages; read every page before submitting a review."),
  }),
  async execute(args, context) {
    return fetchReviewDiff({ ...args, incremental: true }, context.sessionID)
  },
})
