import type { Review } from "./gitea"
import { digest, parseReviewMarker, type ReviewMarker } from "./review-state"

export function isCompletedReview(review: Review, userId: number, expected?: Partial<ReviewMarker>) {
  const marker = parseReviewMarker(review.body || "")
  return Boolean(marker && review.user?.id === userId && !review.dismissed &&
    ["APPROVED", "REQUEST_CHANGES", "COMMENT"].includes(review.state) &&
    marker.head === review.commit_id &&
    Object.entries(expected || {}).every(([key, value]) => marker[key as keyof ReviewMarker] === value))
}

export interface Commit { sha: string; parents?: { sha: string }[] }

export function orderCommits(commits: Commit[], head: string) {
  if (commits[0]?.sha === head) return [...commits].reverse()
  if (commits.at(-1)?.sha === head) return commits
  throw new Error("PR_CHANGED: Commit list does not contain the captured PR head at either end")
}

export function findLastReviewedCommit(reviews: Review[], commits: Commit[], userId: number, base: string) {
  const reviewed = new Set(reviews.filter(r => isCompletedReview(r, userId, { base, scope: "all" })).map(r => r.commit_id))
  return [...commits].reverse().find(c => reviewed.has(c.sha))?.sha ?? null
}

export function findCommitsAfter(commits: Commit[], after: string | null) {
  if (after && commits.every(commit => Array.isArray(commit.parents))) {
    const bySha = new Map(commits.map(commit => [commit.sha, commit]))
    const covered = new Set<string>()
    const visit = (sha: string) => {
      if (covered.has(sha)) return
      covered.add(sha)
      for (const parent of bySha.get(sha)?.parents ?? []) visit(parent.sha)
    }
    visit(after)
    return commits.filter(commit => !covered.has(commit.sha))
  }
  const index = after ? commits.findIndex(c => c.sha === after) : -1
  return commits.slice(index + 1)
}

export function submissionKey(server: string, owner: string, repo: string, number: number, userId: number, head: string, base: string, scope: string) {
  return digest(JSON.stringify(["content-integrity-v1", server, owner, repo, number, userId, head, base, scope]))
}
