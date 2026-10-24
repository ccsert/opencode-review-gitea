import { mkdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { GiteaClient, PRChangedError, prPath, pullRefHead, receiptTarget, requireOpen, type PullRequest, type RepositoryPR, type Review } from "./gitea"
import { commentsDigest } from "./review-confirmation"
import { digest, readJSON, stateDirectory, writeJSON, writeReceipt, type Snapshot } from "./review-state"

export interface DraftComment { path: string; body: string; new_position: number; old_position: number }
interface DraftRecord {
  key: string
  target: ReturnType<typeof receiptTarget>
  userId: number
  head: string
  base: string
  context?: string
  summary: string
  comments: DraftComment[]
  commentsDigest: string
  recommendation: string
  nativeBody: string
  reviewId?: number
}
interface TimelineEntry { id: number; type: string; review_id?: number; user?: { id: number }; body?: string }

async function checkCurrent(api: GiteaClient, args: RepositoryPR, snapshot: Snapshot) {
  const current = await api.json<PullRequest>(prPath(args))
  requireOpen(current)
  if (current.head.sha !== snapshot.head || current.base.sha !== snapshot.base || await pullRefHead(api, args) !== snapshot.head) {
    throw new PRChangedError("The PR changed while preparing the draft. Start a new run.")
  }
}

async function exportDraft(record: DraftRecord) {
  const directory = resolve(process.env.REVIEW_OUTPUT_DIR || join(stateDirectory(), "drafts"))
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const paths = { json: join(directory, `review-${record.key}.json`), markdown: join(directory, `review-${record.key}.md`) }
  // Never overwrite a file that the human may already have edited.
  for (const [path, content] of [[paths.json, JSON.stringify({ target: record.target, head: record.head, base: record.base,
    recommendation: record.recommendation, summary: record.summary, comments: record.comments }, null, 2)], [paths.markdown, record.summary + "\n"]]) {
    try { await writeFile(path, content, { flag: "wx", mode: 0o600 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error }
  }
  return paths
}

async function removeTransportEntry(api: GiteaClient, args: RepositoryPR, record: DraftRecord) {
  const path = prPath(args)
  const timeline = `${path.replace(/\/pulls\//, "/issues/")}/timeline`
  const ownEntries = (entries: TimelineEntry[]) => entries.filter(entry => entry.type === "review" &&
    entry.review_id === record.reviewId && entry.user?.id === record.userId && entry.body === record.nativeBody)
  // Gitea 1.24 creates a timeline comment even for PENDING. It may be visible via
  // the timeline API. Only a non-sensitive placeholder ever goes into that body.
  // Remove only this run's exact placeholder, never human-written comments.
  for (const entry of ownEntries(await api.list<TimelineEntry>(timeline))) {
    const current = await api.json<Review>(`${path}/reviews/${record.reviewId}`)
    if (current.state !== "PENDING" || current.user.id !== record.userId || current.body !== record.nativeBody) {
      throw new Error("DRAFT_CHANGED: The reviewer changed or submitted the draft during handoff")
    }
    try {
      await api.request(`${path.slice(0, path.lastIndexOf("/pulls/"))}/issues/comments/${entry.id}`, { method: "DELETE" })
    } catch { /* The read-back below determines whether this API supports cleanup. */ }
  }
  return ownEntries(await api.list<TimelineEntry>(timeline)).length
    ? ["PENDING_TIMELINE_RETAINED: This server retains the non-sensitive placeholder; the native timeline may repeat the review after manual submission."] : []
}

export async function saveDraft(api: GiteaClient, args: RepositoryPR, snapshot: Snapshot, summary: string,
  comments: DraftComment[], userId: number, recommendation: string) {
  const path = prPath(args)
  const target = receiptTarget(api.baseURL, args)
  const key = digest(JSON.stringify(["draft-v1", target, userId, snapshot.head, snapshot.base, snapshot.scope, snapshot.context]))
  const directory = stateDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const recordPath = join(directory, `draft-${key}.json`)
  const lock = join(directory, `draft-lock-${digest(JSON.stringify([target, userId]))}`)
  try { await mkdir(lock, { mode: 0o700 }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("DRAFT_BUSY: Another draft run owns this PR lock; do not run the same account/PR concurrently")
    throw error
  }
  try {
    let record = await readJSON<DraftRecord>(recordPath)
    const reused = Boolean(record)
    let reviews = await api.list<Review>(`${path}/reviews`)
    const pending = reviews.filter(review => review.user.id === userId && review.state === "PENDING")
    if (pending.some(review => review.id !== record?.reviewId && review.body !== record?.nativeBody)) {
      throw new Error("DRAFT_CONFLICT: This account already has a pending review, possibly for an older PR version. Finish or discard it in the native UI before starting another draft; nothing was overwritten")
    }
    await checkCurrent(api, args, snapshot)
    if (!record) {
      record = { key, target, userId, head: snapshot.head, base: snapshot.base, context: snapshot.context,
        summary, comments, commentsDigest: commentsDigest(comments), recommendation,
        nativeBody: `OpenCode draft: copy the locally exported Markdown summary into the review form before submitting.\n\n<!-- opencode-review-draft:v1 ${key} -->` }
      await exportDraft(record)
      // Persist before POST: an ambiguous response must never cause another POST.
      await writeJSON(recordPath, record)
      await checkCurrent(api, args, snapshot)
      try {
        const result = await api.json<Review>(`${path}/reviews`, { method: "POST", body: JSON.stringify({ event: "PENDING",
          body: record.nativeBody, commit_id: snapshot.head, comments: comments.length ? comments : undefined,
        }).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`) })
        record.reviewId = result.id
        await writeJSON(recordPath, record)
      } catch (error) {
        // A server may accept the review before the connection fails. Reconcile
        // this exact opaque marker below, without retrying the write.
        if (error instanceof PRChangedError) throw error
      }
    }
    if (!record.reviewId) {
      for (let attempt = 0; attempt < 3 && !record.reviewId; attempt++) {
        if (attempt) await Bun.sleep(200)
        reviews = await api.list<Review>(`${path}/reviews`)
        const found = reviews.find(review => review.user.id === userId && review.commit_id === record!.head && review.body === record!.nativeBody)
        if (found) { record.reviewId = found.id; await writeJSON(recordPath, record) }
      }
    }
    if (!record.reviewId) throw new Error(`DRAFT_UNKNOWN: Creation could not be confirmed. POST was not retried; preserve state at ${recordPath}`)
    const current = await api.json<Review>(`${path}/reviews/${record.reviewId}`)
    if (current.user.id !== userId || current.commit_id !== record.head || current.dismissed) {
      throw new Error("DRAFT_CHANGED: Draft owner, reviewed commit or dismissal state changed; no new draft was created")
    }
    let status: "draft_saved" | "draft_reused" | "draft_submitted"
    let warnings: string[] = []
    if (current.state === "PENDING") {
      const savedComments = await api.list<DraftComment>(`${path}/reviews/${current.id}/comments`)
      if (current.body !== record.nativeBody || commentsDigest(savedComments) !== record.commentsDigest ||
          (current.comments_count !== undefined && current.comments_count !== savedComments.length)) {
        throw new Error("DRAFT_EDITED: The reviewer has edited the draft. Existing edits were preserved; finish the review in the native UI")
      }
      warnings = await removeTransportEntry(api, args, record)
      const confirmed = await api.json<Review>(`${path}/reviews/${current.id}`)
      if (confirmed.state !== "PENDING") throw new Error("DRAFT_CHANGED: Draft was submitted during handoff; start a new run to reconcile its status")
      if (confirmed.body !== record.nativeBody || commentsDigest(await api.list<DraftComment>(`${path}/reviews/${current.id}/comments`)) !== record.commentsDigest) {
        throw new Error("DRAFT_EDITED: Draft changed during handoff; existing edits were preserved")
      }
      status = reused ? "draft_reused" : "draft_saved"
    } else if (["COMMENT", "APPROVED", "REQUEST_CHANGES"].includes(current.state)) {
      // Human edits are expected here. This acknowledges the lifecycle only;
      // the draft marker never becomes a completed bot-review baseline.
      status = "draft_submitted"
    } else throw new Error("DRAFT_CHANGED: Unsupported review state")
    await checkCurrent(api, args, snapshot)
    const artifacts = await exportDraft(record)
    const url = `${api.baseURL}/${args.owner}/${args.repo}/pulls/${args.pull_number}/files`
    await writeReceipt({ mode: "draft", status, target, head: record.head, reviewId: current.id, url, artifacts, warnings })
    return `${status === "draft_submitted" ? "Draft already submitted by reviewer; no new review created" : "Draft saved and verified; not published"}: ${url}\nCommit: ${record.head}\nSummary: ${artifacts.markdown}\nData: ${artifacts.json}\n${warnings.join("\n")}\nUse the same account in the native UI. Copy the Markdown summary, edit the pending comments, then manually submit.`
  } finally { await rm(lock, { recursive: true, force: true }) }
}
