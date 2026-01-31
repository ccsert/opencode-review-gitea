/**
 * 测试增量审查功能的辅助函数
 * 运行: cd .opencode-review && bun test tests/gitea-incremental-diff.test.ts
 */

import { describe, test, expect } from "bun:test"

// 模拟的数据结构
interface Commit {
  sha: string
  created: string
  commit: {
    message: string
    author: {
      date: string
    }
  }
}

interface Review {
  id: number
  user: {
    login: string
  }
  commit_id: string
  submitted_at: string
  state: string
}

// 从 gitea-incremental-diff.ts 复制的函数
function findLastReviewedCommit(reviews: Review[], commits: Commit[]): string | null {
  if (!reviews || reviews.length === 0) return null
  
  const commitShas = new Set(commits.map(c => c.sha))
  
  const validReviews = reviews
    .filter(r => r.commit_id && commitShas.has(r.commit_id))
    .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())
  
  return validReviews.length > 0 ? validReviews[0].commit_id : null
}

function findCommitsAfter(commits: Commit[], afterSha: string | null): Commit[] {
  if (!afterSha) return commits
  
  const afterIndex = commits.findIndex(c => c.sha === afterSha)
  if (afterIndex === -1) {
    return commits
  }
  
  return commits.slice(afterIndex + 1)
}

// 测试数据
const mockCommits: Commit[] = [
  {
    sha: "abc123",
    created: "2024-01-01T10:00:00Z",
    commit: { message: "First commit", author: { date: "2024-01-01T10:00:00Z" } }
  },
  {
    sha: "def456",
    created: "2024-01-02T10:00:00Z",
    commit: { message: "Second commit", author: { date: "2024-01-02T10:00:00Z" } }
  },
  {
    sha: "ghi789",
    created: "2024-01-03T10:00:00Z",
    commit: { message: "Third commit", author: { date: "2024-01-03T10:00:00Z" } }
  },
]

const mockReviews: Review[] = [
  {
    id: 1,
    user: { login: "bot" },
    commit_id: "abc123",
    submitted_at: "2024-01-01T12:00:00Z",
    state: "COMMENT"
  },
  {
    id: 2,
    user: { login: "bot" },
    commit_id: "def456",
    submitted_at: "2024-01-02T12:00:00Z",
    state: "APPROVED"
  },
]

describe("findLastReviewedCommit", () => {
  test("returns null when no reviews", () => {
    expect(findLastReviewedCommit([], mockCommits)).toBeNull()
  })

  test("returns null when reviews is undefined", () => {
    expect(findLastReviewedCommit(undefined as any, mockCommits)).toBeNull()
  })

  test("finds the most recent reviewed commit", () => {
    const result = findLastReviewedCommit(mockReviews, mockCommits)
    expect(result).toBe("def456")
  })

  test("ignores reviews with commit_id not in commits", () => {
    const reviewsWithInvalid: Review[] = [
      ...mockReviews,
      {
        id: 3,
        user: { login: "bot" },
        commit_id: "invalid_sha",
        submitted_at: "2024-01-04T12:00:00Z",
        state: "COMMENT"
      }
    ]
    const result = findLastReviewedCommit(reviewsWithInvalid, mockCommits)
    expect(result).toBe("def456") // Should ignore invalid sha
  })

  test("handles reviews without commit_id", () => {
    const reviewsWithEmpty: Review[] = [
      {
        id: 1,
        user: { login: "bot" },
        commit_id: "",
        submitted_at: "2024-01-05T12:00:00Z",
        state: "COMMENT"
      }
    ]
    const result = findLastReviewedCommit(reviewsWithEmpty, mockCommits)
    expect(result).toBeNull()
  })
})

describe("findCommitsAfter", () => {
  test("returns all commits when afterSha is null", () => {
    const result = findCommitsAfter(mockCommits, null)
    expect(result.length).toBe(3)
  })

  test("returns commits after the specified sha", () => {
    const result = findCommitsAfter(mockCommits, "abc123")
    expect(result.length).toBe(2)
    expect(result[0].sha).toBe("def456")
    expect(result[1].sha).toBe("ghi789")
  })

  test("returns empty array when afterSha is the last commit", () => {
    const result = findCommitsAfter(mockCommits, "ghi789")
    expect(result.length).toBe(0)
  })

  test("returns all commits when afterSha not found (rebase scenario)", () => {
    const result = findCommitsAfter(mockCommits, "nonexistent")
    expect(result.length).toBe(3) // All commits returned (rebase detected)
  })

  test("returns one commit when second-to-last is specified", () => {
    const result = findCommitsAfter(mockCommits, "def456")
    expect(result.length).toBe(1)
    expect(result[0].sha).toBe("ghi789")
  })
})

describe("Integration: Incremental Review Logic", () => {
  test("first review: no previous reviews", () => {
    const lastReviewed = findLastReviewedCommit([], mockCommits)
    const newCommits = findCommitsAfter(mockCommits, lastReviewed)
    
    expect(lastReviewed).toBeNull()
    expect(newCommits.length).toBe(3) // All commits
  })

  test("incremental review: one new commit", () => {
    const lastReviewed = findLastReviewedCommit(mockReviews, mockCommits)
    const newCommits = findCommitsAfter(mockCommits, lastReviewed)
    
    expect(lastReviewed).toBe("def456")
    expect(newCommits.length).toBe(1)
    expect(newCommits[0].sha).toBe("ghi789")
  })

  test("no new commits: fully reviewed", () => {
    const fullyReviewedReviews: Review[] = [
      ...mockReviews,
      {
        id: 3,
        user: { login: "bot" },
        commit_id: "ghi789",
        submitted_at: "2024-01-03T12:00:00Z",
        state: "APPROVED"
      }
    ]
    
    const lastReviewed = findLastReviewedCommit(fullyReviewedReviews, mockCommits)
    const newCommits = findCommitsAfter(mockCommits, lastReviewed)
    
    expect(lastReviewed).toBe("ghi789")
    expect(newCommits.length).toBe(0)
  })

  test("rebase scenario: all commits are new", () => {
    // After rebase, all commit SHAs changed
    const rebasedCommits: Commit[] = [
      { sha: "new1", created: "2024-01-01T10:00:00Z", commit: { message: "First", author: { date: "2024-01-01T10:00:00Z" } } },
      { sha: "new2", created: "2024-01-02T10:00:00Z", commit: { message: "Second", author: { date: "2024-01-02T10:00:00Z" } } },
    ]
    
    // Old reviews reference old commit SHAs
    const lastReviewed = findLastReviewedCommit(mockReviews, rebasedCommits)
    const newCommits = findCommitsAfter(rebasedCommits, lastReviewed)
    
    expect(lastReviewed).toBeNull() // Old SHA not found in new commits
    expect(newCommits.length).toBe(2) // All commits (full re-review needed)
  })
})

console.log("✅ All incremental diff tests passed!")
