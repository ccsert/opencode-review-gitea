export function reviewMode(): "submit" | "draft" {
  const mode = process.env.OPENCODE_REVIEW_MODE ?? process.env.REVIEW_MODE ?? "submit"
  if (mode !== "submit" && mode !== "draft") throw new Error("REVIEW_MODE_INVALID: REVIEW_MODE must be submit or draft")
  if (mode === "draft" && !process.env.REVIEW_OUTPUT_DIR) throw new Error("DRAFT_OUTPUT_REQUIRED: Set REVIEW_OUTPUT_DIR to a persistent mounted directory before saving a draft")
  return mode
}
