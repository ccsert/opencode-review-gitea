import { mkdir, readFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { GiteaClient, matchesReviewTarget, PRChangedError, prPath, pullRefHead, receiptTarget, requireOpen, type PullRequest, type RepositoryPR, type Review } from "./gitea"
import { digest, readJSON, stateDirectory, writeJSON } from "./review-state"
import type { DraftRecord } from "./draft-review"

interface Comment { id: number; body: string; user: { id: number } }
export function draftWaitSeconds() {
  const seconds = Number(process.env.DRAFT_WAIT_TIMEOUT_SECONDS ?? 3600)
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error("DRAFT_WAIT_TIMEOUT_SECONDS must be a non-negative integer")
  return seconds
}

// This runs outside the model. It never submits a review or edits human content.
export async function watchDraftSummary(api: GiteaClient, args: RepositoryPR, key: string,
  options: { timeoutMs?: number; pollMs?: number; signal?: AbortSignal } = {}) {
  if (!process.env.REVIEW_OUTPUT_DIR) throw new Error("DRAFT_OUTPUT_REQUIRED: Mount the original REVIEW_OUTPUT_DIR to resume")
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("DRAFT_STATE_REQUIRED: A valid persisted draft key is required")
  const timeout = options.timeoutMs ?? draftWaitSeconds() * 1000
  const recordPath = join(stateDirectory(), `draft-${key}.json`)
  const target = receiptTarget(api.baseURL, args)
  const user = await api.json<{ id: number }>("/user")
  const lock = join(stateDirectory(), `draft-lock-${digest(JSON.stringify([target, user.id]))}`)
  await mkdir(stateDirectory(), { recursive: true, mode: 0o700 })
  try { await mkdir(lock, { mode: 0o700 }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("DRAFT_BUSY: Another run owns this account/PR lock")
    throw error
  }
  try {
    const record = await readJSON<DraftRecord>(recordPath)
    if (!record || record.key !== key || !matchesReviewTarget(record.target, target) || record.userId !== user.id ||
        !Number.isSafeInteger(record.reviewId) || record.reviewId! <= 0) {
      throw new Error("DRAFT_STATE_REQUIRED: Draft state does not match this account and target; no summary published")
    }
    const path = prPath(args)
    const commentsPath = `${path.slice(0, path.lastIndexOf("/pulls/"))}/issues/${args.pull_number}/comments`
    const marker = `<!-- opencode-review-draft-summary:v1 ${key} review=${record.reviewId} -->`
    async function currentReview() {
      const review = await api.json<Review>(`${path}/reviews/${record!.reviewId}`)
      if (review.user.id !== user.id || review.commit_id !== record!.head || review.dismissed ||
          !["PENDING", "COMMENT", "APPROVED", "REQUEST_CHANGES"].includes(review.state)) {
        throw new Error("DRAFT_CHANGED: Review owner, commit, dismissal or state changed; no summary published")
      }
      const pr = await api.json<PullRequest>(path)
      requireOpen(pr)
      if (pr.head.sha !== record!.head || pr.base.sha !== record!.base || await pullRefHead(api, args) !== record!.head) {
        throw new PRChangedError("The draft snapshot is stale; no summary published")
      }
      return review
    }
    const deadline = Date.now() + timeout
    console.log(`Waiting for reviewer to submit: ${api.baseURL}/${args.owner}/${args.repo}/pulls/${args.pull_number}/files`)
    console.log(`Keep this container running. The summary will appear automatically after submission. Resume key: ${key}`)
    while (true) {
      options.signal?.throwIfAborted()
      const review = await currentReview()
      if (review.state !== "PENDING") break
      if (Date.now() >= deadline) throw new Error(`DRAFT_WAIT_TIMEOUT: Review is still pending. Resume with the same output mount and target: draft-watch ${key}`)
      await new Promise<void>((resolve, reject) => {
        const signal = options.signal
        const abort = () => { clearTimeout(timer); reject(signal!.reason) }
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve() }, Math.min(options.pollMs ?? 3000, Math.max(0, deadline - Date.now())))
        signal?.addEventListener("abort", abort, { once: true })
        if (signal?.aborted) { signal.removeEventListener("abort", abort); abort() }
      })
    }
    const url = (id: number) => `${api.baseURL}/${args.owner}/${args.repo}/pulls/${args.pull_number}#issuecomment-${id}`
    if (record.summaryPublication?.commentId) {
      console.log(`AI summary already attached: ${url(record.summaryPublication.commentId)}`)
      return url(record.summaryPublication.commentId)
    }
    const findPublished = async () => {
      const matches = (await api.list<Comment>(commentsPath)).filter(comment => comment.user.id === user.id && comment.body.includes(marker))
      if (matches.length > 1) throw new Error("DRAFT_SUMMARY_AMBIGUOUS: Multiple matching summary comments; no further write")
      return matches[0]
    }
    let published = await findPublished()
    if (!published && !record.summaryPublication) {
      // Read the editable local export only after the human submits. Never put
      // confidential findings in a PENDING body, which some timeline APIs leak.
      const markdown = await readFile(join(resolve(process.env.REVIEW_OUTPUT_DIR!), `review-${key}.md`), "utf8")
      if (!markdown.trim()) throw new Error("DRAFT_SUMMARY_EMPTY: Local summary is empty; no comment published")
      record.summaryPublication = { body: `### AI review summary\n\nAutomatically attached after the reviewer submitted review \`${record.reviewId}\`. Reviewed commit: \`${record.head}\`.\n\n${markdown.trim()}\n\n${marker}` }
      const confirmed = await currentReview()
      if (confirmed.state === "PENDING") throw new Error("DRAFT_CHANGED: The review is pending again; no summary published")
      options.signal?.throwIfAborted()
      // Record intent before POST. An uncertain response or restart only reads
      // back this marker; it must never repeat a potentially successful write.
      await writeJSON(recordPath, record)
      try {
        await api.request(commentsPath, { method: "POST", body: JSON.stringify({ body: record.summaryPublication.body }) })
      } catch { /* Reconcile an accepted POST even if its response was lost. */ }
      published = await findPublished()
    }
    if (!published) throw new Error("DRAFT_SUMMARY_UNKNOWN: Publication could not be confirmed; preserve state. No automatic POST retry")
    // A new publication must read back exactly. Later human edits are preserved.
    if (record.summaryPublication && published.body !== record.summaryPublication.body) {
      throw new Error("DRAFT_SUMMARY_CHANGED: Published summary differs from the saved intent; no content overwritten")
    }
    record.summaryPublication = { body: published.body, commentId: published.id }
    await writeJSON(recordPath, record)
    console.log(`AI summary attached: ${url(published.id)}`)
    return url(published.id)
  } finally { await rm(lock, { recursive: true, force: true }) }
}
