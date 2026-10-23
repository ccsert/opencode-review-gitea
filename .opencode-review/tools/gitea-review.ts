import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./gitea-review.txt"
import { submitReview } from "../lib/submit-review"

export { REVIEW_CATEGORIES, REVIEW_SEVERITIES, formatReviewTag, parseReviewTag, formatCommentBody } from "../lib/review-format"

export default tool({
  description: DESCRIPTION,
  args: {
    owner: tool.schema.string().describe("Repository owner"),
    repo: tool.schema.string().describe("Repository name"),
    pull_number: tool.schema.number().describe("Pull request number"),
    summary: tool.schema.string().describe("Review summary/report content. This is the main review body that will be displayed. AI should generate a complete, well-formatted summary including overview, key findings, file table, etc."),
    comments: tool.schema
      .array(
        tool.schema.object({
          path: tool.schema.string().describe("File path"),
          line: tool.schema.number().optional().describe("Line number in the NEW file (for added/context lines). Use this OR old_line, not both."),
          old_line: tool.schema.number().optional().describe("Line number in the OLD file (for deleted lines). Use this OR line, not both."),
          body: tool.schema.string().describe("Comment content. Use structured tags like **[BUG:HIGH]** or **[SECURITY:CRITICAL]** for categorization."),
          suggestion: tool.schema.string().optional().describe("Optional: Suggested replacement code. Will create a one-click applicable suggestion block in Gitea."),
        }),
      )
      .optional()
      .describe("Line-level review comments. Use 'line' for new/context lines, 'old_line' for deleted lines. Include 'suggestion' for auto-fix proposals."),
    approval: tool.schema
      .enum(["comment", "approve", "request_changes"])
      .optional()
      .default("comment")
      .describe("Review decision"),
  },
  async execute(args, context) {
    return submitReview(args, context.sessionID)
  },
})
