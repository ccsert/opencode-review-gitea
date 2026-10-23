import { describe, expect, test } from "bun:test"
import { findCommitsAfter, findLastReviewedCommit, orderCommits } from "../lib/reviews"
import { digest, reviewMarker } from "../lib/review-state"
import type { Review } from "../lib/gitea"

const commits = [{ sha: "a" }, { sha: "b" }, { sha: "c" }]
function review(id: number, head: string, userId = 7, base = "base", scope = "all"): Review {
  return { id, user: { id: userId, login: "bot" }, state: "COMMENT", commit_id: head,
    body: reviewMarker({ head, base, scope, key: String(id), summaryDigest: digest(""), commentsDigest: digest("[]") }) }
}
describe("incremental baseline", () => {
  test("normalizes either server's commit order", () => {
    expect(orderCommits(commits, "c")).toEqual(commits)
    expect(orderCommits([...commits].reverse(), "c")).toEqual(commits)
  })
  test("merge commits retain unreviewed side-branch changes", () => {
    const graph = [{ sha: "b", parents: [{ sha: "base" }] }, { sha: "a", parents: [{ sha: "base" }] },
      { sha: "merge", parents: [{ sha: "a" }, { sha: "b" }] }]
    expect(findCommitsAfter(graph, "a").map(commit => commit.sha)).toEqual(["b", "merge"])
  })
  test("ignores human reviews even if they copy the marker", () => {
    expect(findLastReviewedCommit([review(1, "a"), review(2, "c", 8)], commits, 7, "base")).toBe("a")
  })
  test("requires a completed, marked, current-base review", () => {
    expect(findLastReviewedCommit([
      { ...review(1, "a"), body: "ordinary comment" },
      { ...review(2, "b"), state: "PENDING" }, review(3, "c", 7, "old-base"),
    ], commits, 7, "base")).toBeNull()
  })
  test("legacy markers without content proofs cannot establish coverage", () => {
    expect(findLastReviewedCommit([{ ...review(1, "a"),
      body: '<!-- opencode-review:v1 {"head":"a","base":"base","scope":"all","key":"legacy"} -->' }], commits, 7, "base")).toBeNull()
  })
  test("filtered reviews cannot establish whole-PR coverage", () => {
    expect(findLastReviewedCommit([review(1, "a"), review(2, "c", 7, "base", "filtered")], commits, 7, "base")).toBe("a")
  })
  test("rebase falls back to full review and picks the furthest valid commit", () => {
    expect(findLastReviewedCommit([review(1, "old-head")], commits, 7, "base")).toBeNull()
    expect(findLastReviewedCommit([review(3, "c"), review(4, "b")], commits, 7, "base")).toBe("c")
  })
})
