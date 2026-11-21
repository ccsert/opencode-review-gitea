import { z } from "zod"
import DESCRIPTION from "./gitea-review.txt"
import { submitReview } from "../lib/submit-review"
import { giteaTool } from "../lib/tool"

export { REVIEW_CATEGORIES, REVIEW_SEVERITIES, formatReviewTag, parseReviewTag, formatCommentBody } from "../lib/review-format"

export default giteaTool({
  name: "gitea-review",
  description: DESCRIPTION,
  input: z.object({
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    pull_number: z.number().describe("Pull request number"),
    summary: z.string().describe("Review summary/report content. This is the main review body that will be displayed. AI should generate a complete, well-formatted summary including overview, key findings, file table, etc."),
    comments: z
      .array(
        z.object({
          path: z.string().describe("File path"),
          line: z.number().optional().describe("Line number in the NEW file (for added/context lines). Use this OR old_line, not both."),
          old_line: z.number().optional().describe("Line number in the OLD file (for deleted lines). Use this OR line, not both."),
          body: z.string().describe("Comment content. Use structured tags like **[BUG:HIGH]** or **[SECURITY:CRITICAL]** for categorization."),
          suggestion: z.string().optional().describe("Optional: Suggested replacement code. Will create a one-click applicable suggestion block in Gitea."),
        }),
      )
      .optional()
      .describe("Line-level review comments. Use 'line' for new/context lines, 'old_line' for deleted lines. Include 'suggestion' for auto-fix proposals."),
    approval: z
      .enum(["comment", "approve", "request_changes"])
      .optional()
      .default("comment")
      .describe("Review decision"),
  }),
  async execute(args, context) {
    return submitReview(args, context.sessionID)
  },
})
