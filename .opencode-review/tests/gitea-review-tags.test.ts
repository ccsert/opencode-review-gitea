/**
 * 测试 gitea-review 中的结构化标签和 suggestion 功能
 * 运行: cd .opencode-review && bun test tests/gitea-review-tags.test.ts
 */

import { describe, test, expect } from "bun:test"

// 复制自 gitea-review.ts 的常量和函数
const REVIEW_CATEGORIES = ["BUG", "SECURITY", "PERFORMANCE", "STYLE", "DOCS", "TEST"] as const
const REVIEW_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const

type ReviewCategory = typeof REVIEW_CATEGORIES[number]
type ReviewSeverity = typeof REVIEW_SEVERITIES[number]

function formatReviewTag(category: ReviewCategory, severity: ReviewSeverity): string {
  return `**[${category}:${severity}]**`
}

function parseReviewTag(body: string): { category?: ReviewCategory; severity?: ReviewSeverity } | null {
  const match = body.match(/\*?\*?\[([A-Z]+):([A-Z]+)\]\*?\*?/)
  if (!match) return null
  
  const category = match[1] as ReviewCategory
  const severity = match[2] as ReviewSeverity
  
  if (REVIEW_CATEGORIES.includes(category) && REVIEW_SEVERITIES.includes(severity)) {
    return { category, severity }
  }
  return null
}

function formatCommentBody(body: string, suggestion?: string): string {
  if (!suggestion) return body
  
  const trimmedBody = body.trimEnd()
  
  return `${trimmedBody}

\`\`\`suggestion
${suggestion}
\`\`\`
`
}

// 测试
describe("Review Tags", () => {
  test("formatReviewTag generates correct format", () => {
    expect(formatReviewTag("BUG", "HIGH")).toBe("**[BUG:HIGH]**")
    expect(formatReviewTag("SECURITY", "CRITICAL")).toBe("**[SECURITY:CRITICAL]**")
    expect(formatReviewTag("STYLE", "LOW")).toBe("**[STYLE:LOW]**")
  })

  test("parseReviewTag extracts category and severity", () => {
    const result1 = parseReviewTag("**[BUG:HIGH]** This is a bug")
    expect(result1).toEqual({ category: "BUG", severity: "HIGH" })

    const result2 = parseReviewTag("[SECURITY:CRITICAL] SQL injection risk")
    expect(result2).toEqual({ category: "SECURITY", severity: "CRITICAL" })

    const result3 = parseReviewTag("**[PERFORMANCE:MEDIUM]**")
    expect(result3).toEqual({ category: "PERFORMANCE", severity: "MEDIUM" })
  })

  test("parseReviewTag returns null for invalid tags", () => {
    expect(parseReviewTag("No tag here")).toBeNull()
    expect(parseReviewTag("[INVALID:HIGH]")).toBeNull()
    expect(parseReviewTag("[BUG:UNKNOWN]")).toBeNull()
    expect(parseReviewTag("")).toBeNull()
  })

  test("parseReviewTag handles all valid categories", () => {
    for (const cat of REVIEW_CATEGORIES) {
      const result = parseReviewTag(`**[${cat}:HIGH]** Test`)
      expect(result?.category).toBe(cat)
    }
  })

  test("parseReviewTag handles all valid severities", () => {
    for (const sev of REVIEW_SEVERITIES) {
      const result = parseReviewTag(`**[BUG:${sev}]** Test`)
      expect(result?.severity).toBe(sev)
    }
  })
})

describe("Suggestion Blocks", () => {
  test("formatCommentBody without suggestion returns body unchanged", () => {
    const body = "This is a comment"
    expect(formatCommentBody(body)).toBe(body)
  })

  test("formatCommentBody with suggestion adds suggestion block", () => {
    const body = "**[STYLE:LOW]** Use const here"
    const suggestion = "const x = 1;"
    const result = formatCommentBody(body, suggestion)
    
    expect(result).toContain(body)
    expect(result).toContain("```suggestion")
    expect(result).toContain(suggestion)
    expect(result).toContain("```")
  })

  test("formatCommentBody trims trailing whitespace before suggestion", () => {
    const body = "Comment with spaces   "
    const suggestion = "fixed code"
    const result = formatCommentBody(body, suggestion)
    
    expect(result.startsWith("Comment with spaces\n")).toBe(true)
    expect(result).not.toContain("Comment with spaces   \n")
  })

  test("formatCommentBody handles multi-line suggestions", () => {
    const body = "**[BUG:HIGH]** Fix this function"
    const suggestion = `function fixed() {
  return true;
}`
    const result = formatCommentBody(body, suggestion)
    
    expect(result).toContain("```suggestion")
    expect(result).toContain("function fixed() {")
    expect(result).toContain("  return true;")
    expect(result).toContain("}")
  })
})

describe("Integration", () => {
  test("Full review comment with tag and suggestion", () => {
    const tag = formatReviewTag("STYLE", "LOW")
    const body = `${tag} Variable should be const since it's never reassigned.`
    const suggestion = "const userId = getUserId();"
    
    const formatted = formatCommentBody(body, suggestion)
    
    // Parse the tag back
    const parsed = parseReviewTag(formatted)
    expect(parsed).toEqual({ category: "STYLE", severity: "LOW" })
    
    // Check suggestion block
    expect(formatted).toContain("```suggestion")
    expect(formatted).toContain("const userId = getUserId();")
  })
})

console.log("✅ All tests passed!")
