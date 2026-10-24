import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { GiteaClient, GiteaError, PRChangedError, prPath, pullRefHead, receiptTarget, requireOpen, reviewURL, type PullRequest, type RepositoryPR, type Review } from "./gitea"
import { parseDiff } from "./diff"
import { formatCommentBody } from "./review-format"
import { digest, loadSnapshot, reviewMarker, stateDirectory, unreadPages, writeJSON, writeReceipt } from "./review-state"
import { isCompletedReview, submissionKey } from "./reviews"
import { commentsDigest, confirmReviewContent } from "./review-confirmation"
import { reviewMode } from "./review-mode"
import { saveDraft } from "./draft-review"

export interface ReviewComment { path: string; line?: number; old_line?: number; body: string; suggestion?: string }
export interface ReviewInput extends RepositoryPR {
  summary: string; comments?: ReviewComment[]; approval?: "comment" | "approve" | "request_changes"
}

// Some models send a multi-line report with every line break JSON-escaped twice.
// Only text without a single real line break is restored; otherwise "\n" is
// literal content, such as a C string in a comment or suggestion.
export function normalizeReviewText(text: string) {
  return text.includes("\n") || !text.includes("\\n") ? text : text.replace(/\\n/g, "\n").replace(/\\t/g, "\t")
}

export async function submitReview(args: ReviewInput, sessionID: string) {
  const mode = reviewMode()
  const api = new GiteaClient()
  const path = prPath(args)
  const snapshot = await loadSnapshot(api.baseURL, args, sessionID)
  if (!snapshot) throw new Error("SNAPSHOT_REQUIRED: Fetch the PR diff in this run before submitting a review")
  const unread = await unreadPages(api.baseURL, args, snapshot.pages ?? 0, sessionID)
  if (unread.length) {
    throw new Error(`REVIEW_INCOMPLETE: Read diff page(s) ${unread.join(", ")} of ${snapshot.pages} with the same diff tool before submitting`)
  }
  const current = await api.json<PullRequest>(path)
  requireOpen(current)
  if (snapshot.head !== current.head.sha || snapshot.base !== current.base.sha) {
    throw new PRChangedError("The PR no longer matches the reviewed snapshot. Start a new review run.")
  }
  const files = parseDiff(snapshot.reviewDiff)
  const comments = (args.comments ?? []).map(comment => {
    const old = comment.old_line !== undefined
    const line = old ? comment.old_line : comment.line
    const file = files.find(file => file.path === comment.path)
    if ((comment.line !== undefined && old) || !Number.isInteger(line) || line! <= 0 ||
        !file?.hunks.some(hunk => hunk.changes.some(change => (old ? change.oldLine : change.newLine) === line))) {
      throw new Error(`INVALID_REVIEW_COMMENT: ${comment.path}:${line} is not an unambiguous line in the reviewed diff`)
    }
    return { path: comment.path,
      body: formatCommentBody(comment.body, comment.suggestion),
      new_position: old ? 0 : line!, old_position: old ? line! : 0 }
  })
  const user = await api.json<{ id: number }>("/user")
  const summary = normalizeReviewText(args.summary)
  if (mode === "draft") return saveDraft(api, args, snapshot, summary, comments, user.id, args.approval ?? "comment")
  const key = submissionKey(api.baseURL, args.owner, args.repo, args.pull_number, user.id, snapshot.head, snapshot.base, snapshot.scope, snapshot.context)
  const identity = { head: snapshot.head, base: snapshot.base, scope: snapshot.scope, key, context: snapshot.context }
  const marker = { ...identity, summaryDigest: digest(summary), commentsDigest: commentsDigest(comments) }
  const intent = join(stateDirectory(), `submission-${key}.json`)

  async function checkCurrent() {
    const latest = await api.json<PullRequest>(path)
    requireOpen(latest)
    if (latest.head.sha !== snapshot!.head || latest.base.sha !== snapshot!.base || await pullRefHead(api, args) !== snapshot!.head) {
      throw new PRChangedError("The PR changed during publication. Start a new review run.")
    }
  }

  async function confirm(review: Review, duplicate: boolean) {
    const result = await confirmReviewContent(api, path, review, user.id, duplicate ? identity : marker)
    // Read the server's review object, rather than trusting a successful POST status.
    const receipt = { status: duplicate ? "duplicate" as const : "submitted" as const,
      target: receiptTarget(api.baseURL, args),
      head: snapshot!.head, reviewId: result.id,
      url: reviewURL(receiptTarget(api.baseURL, args), result.id) }
    await writeJSON(intent, receipt)
    // A push may race the final preflight GET. The review stays attached to its
    // original commit, but it cannot certify the current PR or complete this run.
    await checkCurrent()
    await writeReceipt(receipt)
    return `${duplicate ? "Review already submitted" : "Review submitted and confirmed"}: ${receipt.url}\nCommit: ${receipt.head}`
  }
  const reviews = await api.list<Review>(`${path}/reviews`)
  // The server merges all pending comments of this account into a submitted
  // review. Never publish a human's pending work through the automatic mode.
  if (reviews.some(review => review.user?.id === user.id && review.state === "PENDING")) {
    throw new Error("PENDING_REVIEW_EXISTS: This account has a pending review. Submit or discard it manually before using submit mode")
  }
  const existing = reviews.find(review => isCompletedReview(review, user.id, identity))
  await checkCurrent()
  if (existing) {
    try { return await confirm(existing, true) }
    catch (error) {
      if (error instanceof PRChangedError) throw error
      throw new Error(`SUBMISSION_UNKNOWN: Existing review ${existing.id} could not be read back; no new review was posted`)
    }
  }

  await mkdir(stateDirectory(), { recursive: true, mode: 0o700 })
  let claimed = false
  try {
    await writeFile(intent, JSON.stringify({ status: "submitting", ...marker }), { flag: "wx", mode: 0o600 })
    claimed = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  }
  let failure: unknown
  let postAccepted = false
  if (claimed) {
    try {
      const result = await api.json<Review>(`${path}/reviews`, { method: "POST", body: JSON.stringify({
        body: `${summary}\n\n${reviewMarker(marker)}`,
        event: { comment: "COMMENT", approve: "APPROVED", request_changes: "REQUEST_CHANGES" }[args.approval ?? "comment"],
        commit_id: snapshot.head, comments: comments.length ? comments : undefined,
      // ASCII JSON preserves Unicode across runtime/intermediary string encoders.
      }).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`) })
      postAccepted = true
      return await confirm(result, false)
    } catch (error) {
      if (error instanceof PRChangedError) throw error
      failure = error
    }
  }
  // A network timeout/5xx may have happened after the server committed the review.
  // Recover by its stable marker; never retry POST after an ambiguous outcome.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await Bun.sleep(200)
    try {
      const recovered = (await api.list<Review>(`${path}/reviews`)).find(review => isCompletedReview(review, user.id, identity))
      if (recovered) return await confirm(recovered, !claimed)
    } catch (error) {
      if (error instanceof PRChangedError) throw error
      // Keep the intent until a published result can be confirmed.
    }
  }
  if (!postAccepted && failure instanceof GiteaError && failure.status && failure.status !== 408 && failure.status >= 400 && failure.status < 500) {
    await rm(intent, { force: true })
    throw failure
  }
  throw new Error(`SUBMISSION_UNKNOWN: Unable to confirm review for ${snapshot.head}; POST was not retried. State: ${intent}`)
}
