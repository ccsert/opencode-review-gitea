export const REVIEW_CATEGORIES = ["BUG", "SECURITY", "PERFORMANCE", "STYLE", "DOCS", "TEST"] as const
export const REVIEW_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const

export type ReviewCategory = typeof REVIEW_CATEGORIES[number]
export type ReviewSeverity = typeof REVIEW_SEVERITIES[number]

/**
 * Format a structured review tag
 */
export function formatReviewTag(category: ReviewCategory, severity: ReviewSeverity): string {
  return `**[${category}:${severity}]**`
}

/**
 * Parse a review comment to extract category and severity
 */
export function parseReviewTag(body: string): { category?: ReviewCategory; severity?: ReviewSeverity } | null {
  const match = body.match(/\*?\*?\[([A-Z]+):([A-Z]+)\]\*?\*?/)
  if (!match) return null
  
  const category = match[1] as ReviewCategory
  const severity = match[2] as ReviewSeverity
  
  if (REVIEW_CATEGORIES.includes(category) && REVIEW_SEVERITIES.includes(severity)) {
    return { category, severity }
  }
  return null
}

/**
 * Format a comment with optional suggestion block
 */
export function formatCommentBody(body: string, suggestion?: string): string {
  if (!suggestion) return body
  
  const trimmedBody = body.trimEnd()
  
  return `${trimmedBody}

\`\`\`suggestion
${suggestion}
\`\`\`
`
}

