import type { GiteaClient, Review } from "./gitea"
import { digest, parseReviewMarker, reviewMarker, type ReviewMarker } from "./review-state"
import { isCompletedReview } from "./reviews"

interface CommentContent {
  path: string; body: string; new_position?: number; old_position?: number; position?: number; original_position?: number
}
export function commentsDigest(comments: CommentContent[]) {
  const rows = comments.map(comment => JSON.stringify([comment.path, comment.body,
    comment.new_position ?? comment.position ?? 0, comment.old_position ?? comment.original_position ?? 0])).sort()
  return digest(JSON.stringify(rows))
}

export async function confirmReviewContent(api: GiteaClient, path: string, review: Review, userId: number, expected: Partial<ReviewMarker>) {
  const result = await api.json<Review>(`${path}/reviews/${review.id}`)
  if (!isCompletedReview(result, userId, expected)) throw new Error("REVIEW_NOT_CONFIRMED: Published review identity does not match")
  const marker = parseReviewMarker(result.body)!
  const suffix = `\n\n${reviewMarker(marker)}`
  if (!result.body.endsWith(suffix) || digest(result.body.slice(0, -suffix.length)) !== marker.summaryDigest) {
    throw new Error("REVIEW_NOT_CONFIRMED: Published summary content does not match")
  }
  const published = await api.list<CommentContent>(`${path}/reviews/${review.id}/comments`)
  if ((result.comments_count !== undefined && published.length !== result.comments_count) || commentsDigest(published) !== marker.commentsDigest) {
    throw new Error("REVIEW_NOT_CONFIRMED: Published line comment content or positions do not match")
  }
  return result
}
