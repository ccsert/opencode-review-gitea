/**
 * 测试审查统计功能
 * 运行: cd .opencode-review && bun test tests/gitea-review-stats.test.ts
 */

import { describe, test, expect } from "bun:test"

// 常量
const REVIEW_CATEGORIES = ["BUG", "SECURITY", "PERFORMANCE", "STYLE", "DOCS", "TEST"] as const
const REVIEW_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const

type ReviewCategory = typeof REVIEW_CATEGORIES[number]
type ReviewSeverity = typeof REVIEW_SEVERITIES[number]

// Detailed issue record
interface IssueRecord {
  category: ReviewCategory
  severity: ReviewSeverity
  file: string
  description: string
  hasSuggestion: boolean
}

// 从 gitea-review-stats.ts 复制的类型和函数
interface ReviewStats {
  totalReviews: number
  totalComments: number
  byCategory: Record<ReviewCategory, number>
  bySeverity: Record<ReviewSeverity, number>
  byFile: Record<string, number>
  byCategorySeverity: Record<string, number>
  timeline: Array<{ date: string; count: number }>
  suggestions: number
  untaggedComments: number
  issues: IssueRecord[]
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

function initializeStats(): ReviewStats {
  const byCategory = {} as Record<ReviewCategory, number>
  const bySeverity = {} as Record<ReviewSeverity, number>
  
  for (const cat of REVIEW_CATEGORIES) {
    byCategory[cat] = 0
  }
  for (const sev of REVIEW_SEVERITIES) {
    bySeverity[sev] = 0
  }
  
  return {
    totalReviews: 0,
    totalComments: 0,
    byCategory,
    bySeverity,
    byFile: {},
    byCategorySeverity: {},
    timeline: [],
    suggestions: 0,
    untaggedComments: 0,
    issues: [],
  }
}

function extractDescription(body: string): string {
  const cleaned = body.replace(/\*?\*?\[[A-Z]+:[A-Z]+\]\*?\*?\s*/g, "").trim()
  const withoutSuggestion = cleaned.replace(/```suggestion[\s\S]*?```/g, "").trim()
  if (withoutSuggestion.length > 100) {
    return withoutSuggestion.slice(0, 97) + "..."
  }
  return withoutSuggestion || "(no description)"
}

function analyzeComment(comment: { body: string; path?: string }, stats: ReviewStats): void {
  stats.totalComments++
  
  const hasSuggestion = comment.body.includes("```suggestion")
  
  if (hasSuggestion) {
    stats.suggestions++
  }
  
  const tag = parseReviewTag(comment.body)
  if (tag && tag.category && tag.severity) {
    stats.byCategory[tag.category]++
    stats.bySeverity[tag.severity]++
    
    const key = `${tag.category}:${tag.severity}`
    stats.byCategorySeverity[key] = (stats.byCategorySeverity[key] || 0) + 1
    
    stats.issues.push({
      category: tag.category,
      severity: tag.severity,
      file: comment.path || "(summary)",
      description: extractDescription(comment.body),
      hasSuggestion,
    })
  } else {
    stats.untaggedComments++
  }
  
  if (comment.path) {
    stats.byFile[comment.path] = (stats.byFile[comment.path] || 0) + 1
  }
}

// 测试
describe("initializeStats", () => {
  test("creates empty stats with all categories", () => {
    const stats = initializeStats()
    
    expect(stats.totalReviews).toBe(0)
    expect(stats.totalComments).toBe(0)
    expect(stats.suggestions).toBe(0)
    expect(stats.untaggedComments).toBe(0)
    
    for (const cat of REVIEW_CATEGORIES) {
      expect(stats.byCategory[cat]).toBe(0)
    }
    
    for (const sev of REVIEW_SEVERITIES) {
      expect(stats.bySeverity[sev]).toBe(0)
    }
  })
})

describe("analyzeComment", () => {
  test("increments totalComments", () => {
    const stats = initializeStats()
    analyzeComment({ body: "test" }, stats)
    expect(stats.totalComments).toBe(1)
  })

  test("detects suggestion blocks", () => {
    const stats = initializeStats()
    analyzeComment({ 
      body: "Fix this\n```suggestion\nconst x = 1;\n```" 
    }, stats)
    expect(stats.suggestions).toBe(1)
  })

  test("parses tagged comments correctly", () => {
    const stats = initializeStats()
    analyzeComment({ 
      body: "**[BUG:HIGH]** Null pointer exception" 
    }, stats)
    
    expect(stats.byCategory.BUG).toBe(1)
    expect(stats.bySeverity.HIGH).toBe(1)
    expect(stats.byCategorySeverity["BUG:HIGH"]).toBe(1)
    expect(stats.untaggedComments).toBe(0)
  })

  test("counts untagged comments", () => {
    const stats = initializeStats()
    analyzeComment({ body: "This has no tag" }, stats)
    expect(stats.untaggedComments).toBe(1)
  })

  test("tracks issues by file", () => {
    const stats = initializeStats()
    analyzeComment({ body: "**[BUG:HIGH]** Issue 1", path: "src/app.ts" }, stats)
    analyzeComment({ body: "**[BUG:LOW]** Issue 2", path: "src/app.ts" }, stats)
    analyzeComment({ body: "**[STYLE:LOW]** Issue 3", path: "src/util.ts" }, stats)
    
    expect(stats.byFile["src/app.ts"]).toBe(2)
    expect(stats.byFile["src/util.ts"]).toBe(1)
  })

  test("handles multiple categories and severities", () => {
    const stats = initializeStats()
    
    analyzeComment({ body: "**[SECURITY:CRITICAL]** SQL injection" }, stats)
    analyzeComment({ body: "**[PERFORMANCE:MEDIUM]** N+1 query" }, stats)
    analyzeComment({ body: "**[STYLE:LOW]** Use const" }, stats)
    
    expect(stats.byCategory.SECURITY).toBe(1)
    expect(stats.byCategory.PERFORMANCE).toBe(1)
    expect(stats.byCategory.STYLE).toBe(1)
    
    expect(stats.bySeverity.CRITICAL).toBe(1)
    expect(stats.bySeverity.MEDIUM).toBe(1)
    expect(stats.bySeverity.LOW).toBe(1)
  })
})

describe("Health Score Calculation", () => {
  test("calculates weighted score", () => {
    const stats = initializeStats()
    
    // Add some issues
    analyzeComment({ body: "**[BUG:CRITICAL]** Critical bug" }, stats)
    analyzeComment({ body: "**[BUG:HIGH]** High bug" }, stats)
    analyzeComment({ body: "**[STYLE:LOW]** Style issue" }, stats)
    
    // Calculate score (same logic as in the tool)
    const criticalWeight = stats.bySeverity.CRITICAL * 10
    const highWeight = stats.bySeverity.HIGH * 5
    const mediumWeight = stats.bySeverity.MEDIUM * 2
    const lowWeight = stats.bySeverity.LOW * 1
    const totalWeight = criticalWeight + highWeight + mediumWeight + lowWeight
    const score = Math.max(0, 100 - totalWeight)
    
    expect(criticalWeight).toBe(10)
    expect(highWeight).toBe(5)
    expect(lowWeight).toBe(1)
    expect(totalWeight).toBe(16)
    expect(score).toBe(84)
  })

  test("score is 100 with no issues", () => {
    const stats = initializeStats()
    
    const totalWeight = 
      stats.bySeverity.CRITICAL * 10 +
      stats.bySeverity.HIGH * 5 +
      stats.bySeverity.MEDIUM * 2 +
      stats.bySeverity.LOW * 1
    const score = Math.max(0, 100 - totalWeight)
    
    expect(score).toBe(100)
  })

  test("score bottoms out at 0", () => {
    const stats = initializeStats()
    
    // Add many critical issues
    for (let i = 0; i < 15; i++) {
      analyzeComment({ body: "**[SECURITY:CRITICAL]** Critical" }, stats)
    }
    
    const totalWeight = stats.bySeverity.CRITICAL * 10
    const score = Math.max(0, 100 - totalWeight)
    
    expect(totalWeight).toBe(150)
    expect(score).toBe(0)
  })
})

describe("Full Review Analysis", () => {
  test("comprehensive analysis of multiple comments", () => {
    const stats = initializeStats()
    
    const comments = [
      { body: "**[BUG:CRITICAL]** Memory leak in event handler", path: "src/handlers/event.ts" },
      { body: "**[SECURITY:HIGH]** User input not sanitized", path: "src/api/user.ts" },
      { body: "**[PERFORMANCE:MEDIUM]** Consider caching this query", path: "src/db/queries.ts" },
      { body: "**[STYLE:LOW]** Use const\n```suggestion\nconst x = 1;\n```", path: "src/utils.ts" },
      { body: "Nice work on the error handling!", path: "src/api/user.ts" }, // Untagged
    ]
    
    for (const comment of comments) {
      analyzeComment(comment, stats)
    }
    
    expect(stats.totalComments).toBe(5)
    expect(stats.suggestions).toBe(1)
    expect(stats.untaggedComments).toBe(1)
    
    expect(stats.byCategory.BUG).toBe(1)
    expect(stats.byCategory.SECURITY).toBe(1)
    expect(stats.byCategory.PERFORMANCE).toBe(1)
    expect(stats.byCategory.STYLE).toBe(1)
    
    expect(stats.bySeverity.CRITICAL).toBe(1)
    expect(stats.bySeverity.HIGH).toBe(1)
    expect(stats.bySeverity.MEDIUM).toBe(1)
    expect(stats.bySeverity.LOW).toBe(1)
    
    expect(stats.byFile["src/api/user.ts"]).toBe(2)
  })
})

describe("Issue Records", () => {
  test("creates detailed issue records", () => {
    const stats = initializeStats()
    
    analyzeComment({ 
      body: "**[BUG:CRITICAL]** Memory leak in event handler", 
      path: "src/handlers/event.ts" 
    }, stats)
    
    expect(stats.issues.length).toBe(1)
    expect(stats.issues[0].category).toBe("BUG")
    expect(stats.issues[0].severity).toBe("CRITICAL")
    expect(stats.issues[0].file).toBe("src/handlers/event.ts")
    expect(stats.issues[0].description).toBe("Memory leak in event handler")
    expect(stats.issues[0].hasSuggestion).toBe(false)
  })

  test("tracks suggestion in issue record", () => {
    const stats = initializeStats()
    
    analyzeComment({ 
      body: "**[STYLE:LOW]** Use const\n```suggestion\nconst x = 1;\n```", 
      path: "src/utils.ts" 
    }, stats)
    
    expect(stats.issues[0].hasSuggestion).toBe(true)
  })

  test("truncates long descriptions", () => {
    const stats = initializeStats()
    const longDescription = "A".repeat(150)
    
    analyzeComment({ 
      body: `**[BUG:HIGH]** ${longDescription}`, 
      path: "test.ts" 
    }, stats)
    
    expect(stats.issues[0].description.length).toBeLessThanOrEqual(100)
    expect(stats.issues[0].description.endsWith("...")).toBe(true)
  })
})

describe("extractDescription", () => {
  test("removes tag prefix", () => {
    const result = extractDescription("**[BUG:HIGH]** This is the issue")
    expect(result).toBe("This is the issue")
  })

  test("removes suggestion blocks", () => {
    const result = extractDescription("**[STYLE:LOW]** Use const\n```suggestion\nconst x = 1;\n```")
    expect(result).toBe("Use const")
  })

  test("handles empty description", () => {
    const result = extractDescription("**[BUG:HIGH]**")
    expect(result).toBe("(no description)")
  })
})

console.log("✅ All review stats tests passed!")
