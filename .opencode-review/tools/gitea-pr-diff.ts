import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./gitea-pr-diff.txt"
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
    file_patterns: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Optional glob patterns to filter files (e.g., ['*.ts', 'src/**/*.go']). Only matching files will be included in the diff."),
  },
  async execute(args, context) {
    return fetchReviewDiff(args, context.sessionID)
  },
})
