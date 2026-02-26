/**
 * Structured output schemas for AI code review
 * Replaces brittle regex parsing with Zod schema validation
 */

import { z } from "zod";

export const reviewCommentSchema = z.object({
  path: z.string().describe("File path"),
  line: z.number().describe("Line number in new file"),
  body: z.string().describe("Comment content in [Category:Severity] format"),
  category: z.enum([
    "BUG",
    "SECURITY",
    "PERFORMANCE",
    "STYLE",
    "LOGIC",
    "TEST",
    "DOCS",
    "REFACTOR",
  ]),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
});

export const reviewResultSchema = z.object({
  decision: z.enum(["APPROVED", "REQUEST_CHANGES", "COMMENT"]),
  summary: z.string().describe("1-3 sentence summary"),
  comments: z.array(reviewCommentSchema),
  score: z.number().min(0).max(100).optional(),
});

export type ReviewOutput = z.infer<typeof reviewResultSchema>;
export type ReviewComment = z.infer<typeof reviewCommentSchema>;
