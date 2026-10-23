import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { GiteaClient, GiteaError, PRChangedError, prPath, requireOpen, type PullRequest, type RepositoryPR, type Review } from "./gitea"
import { parseDiff } from "./diff"
import { formatCommentBody } from "./review-format"
import { loadSnapshot, reviewMarker, stateDirectory, writeJSON, writeReceipt } from "./review-state"
import { isCompletedReview, submissionKey } from "./reviews"

export interface ReviewComment { path: string; line?: number; old_line?: number; body: string; suggestion?: string }
export interface ReviewInput extends RepositoryPR {
  summary: string; comments?: ReviewComment[]; approval?: "comment" | "approve" | "request_changes"
}

export async function submitReview(args: ReviewInput, sessionID: string) {
  const api = new GiteaClient()
  const path = prPath(args)
  const snapshot = await loadSnapshot(api.baseURL, args, sessionID)
  if (!snapshot) throw new Error("SNAPSHOT_REQUIRED: Fetch the PR diff in this run before submitting a review")
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
      body: formatCommentBody(comment.body.replace(/\\n/g, "\n").replace(/\\t/g, "\t"), comment.suggestion?.replace(/\\n/g, "\n").replace(/\\t/g, "\t")),
      new_position: old ? 0 : line, old_position: old ? line : 0 }
  })
  const user = await api.json<{ id: number }>("/user")
  const key = submissionKey(api.baseURL, args.owner, args.repo, args.pull_number, user.id, snapshot.head, snapshot.base, snapshot.scope)
  const marker = { head: snapshot.head, base: snapshot.base, scope: snapshot.scope, key }
  const intent = join(stateDirectory(), `submission-${key}.json`)

  async function checkCurrent() {
    const latest = await api.json<PullRequest>(path)
    requireOpen(latest)
    if (latest.head.sha !== snapshot!.head || latest.base.sha !== snapshot!.base) {
      throw new PRChangedError("The PR changed during publication. Start a new review run.")
    }
  }

  async function confirm(review: Review, duplicate: boolean) {
    const result = await api.json<Review>(`${path}/reviews/${review.id}`)
    if (!isCompletedReview(result, user.id, marker)) throw new Error("Review read-back does not match the submitted snapshot")
    const published = await api.list<{ path: string; body: string }>(`${path}/reviews/${review.id}/comments`)
    if ((result.comments_count !== undefined && published.length !== result.comments_count) ||
        (!duplicate && comments.some(comment => !published.some(item => item.path === comment.path && item.body === comment.body)))) {
      throw new Error("Review line comments could not be confirmed")
    }
    // Read the server's review object, rather than trusting a successful POST status.
    const receipt = { status: duplicate ? "duplicate" as const : "submitted" as const,
      head: snapshot!.head, reviewId: result.id,
      url: `${api.baseURL}/${args.owner}/${args.repo}/pulls/${args.pull_number}#pullreview-${result.id}` }
    await writeJSON(intent, receipt)
    // A push may race the final preflight GET. The review stays attached to its
    // original commit, but it cannot certify the current PR or complete this run.
    await checkCurrent()
    await writeReceipt(receipt)
    return `${duplicate ? "Review already submitted" : "Review submitted and confirmed"}: ${receipt.url}\nCommit: ${receipt.head}`
  }
  const existing = (await api.list<Review>(`${path}/reviews`)).find(review => isCompletedReview(review, user.id, marker))
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
        body: `${args.summary.replace(/\\n/g, "\n").replace(/\\t/g, "\t")}\n\n${reviewMarker(marker)}`,
        event: { comment: "COMMENT", approve: "APPROVED", request_changes: "REQUEST_CHANGES" }[args.approval ?? "comment"],
        commit_id: snapshot.head, comments: comments.length ? comments : undefined,
      }) })
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
      const recovered = (await api.list<Review>(`${path}/reviews`)).find(review => isCompletedReview(review, user.id, marker))
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
