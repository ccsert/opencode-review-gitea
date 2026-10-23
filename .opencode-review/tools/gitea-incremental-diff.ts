import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./gitea-incremental-diff.txt"
import { fetchReviewDiff } from "../lib/review-diff"

export default tool({
  description: DESCRIPTION,
  args: {
    owner: tool.schema.string().describe("Repository owner"),
    repo: tool.schema.string().describe("Repository name"),
    pull_number: tool.schema.number().describe("Pull request number"),
    format: tool.schema
      .enum(["raw", "parsed"])
      .optional()
      .default("parsed")
      .describe("Output format: 'raw' for unified diff, 'parsed' for line-numbered format"),
    page: tool.schema
      .number()
      .optional()
      .describe("Output page (default 1). Large diffs are split into pages; read every page before submitting a review."),
  },
  async execute(args, context) {
    return fetchReviewDiff({ ...args, incremental: true }, context.sessionID)
  },
})
