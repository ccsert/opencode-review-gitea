import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import diffTool from "../.opencode-review/tools/gitea-pr-diff"
import reviewTool from "../.opencode-review/tools/gitea-review"
import incrementalTool from "../.opencode-review/tools/gitea-incremental-diff"
import type { Review } from "../.opencode-review/lib/gitea"
import { loadSnapshot, saveSnapshot } from "../.opencode-review/lib/review-state"

const args = { owner: "owner", repo: "repo", pull_number: 1 }
const diff = "diff --git a/app.ts b/app.ts\nindex a..b 100644\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1,2 @@\n const a = 1\n+const b = 2\n"
let server: ReturnType<typeof Bun.serve>
let directory: string
let head: string
let reviews: Review[]
let posts: number
let loseResponse: boolean
let rejectPost: boolean
let rejectStatus: number
let failReadback: boolean
let pushDuringDiff: boolean
let pushDuringReviewList: boolean
let pushDuringPost: boolean
let gitRefHead: string | undefined
let refDelay: number
let refReads: number
let diffReads: number
let pushRefDuringDiff: boolean
let pushRefDuringPost: boolean
let corruptComment: boolean
let corruptSummary: boolean
let dropComments: boolean
let wrongPosition: boolean
let lastPostWasASCII: boolean
let hideComments: boolean
let base: string
let publishedComments: { path: string; body: string }[]
let savedEnv: NodeJS.ProcessEnv
let timeline: { id: number; type: string; review_id: number; user: { id: number }; body: string }[]
let retainTimeline: boolean
let session = 0
const context = () => ({ sessionID: `session-${++session}`, messageID: "message", agent: "code-review",
  abort: new AbortController().signal, metadata() {}, async ask() {} })

beforeEach(() => {
  savedEnv = { ...process.env }
  directory = mkdtempSync(join(tmpdir(), "review-consistency-"))
  head = "head-a"; reviews = []; posts = 0
  base = "base"
  publishedComments = []
  timeline = []; retainTimeline = false
  loseResponse = false; rejectPost = false; failReadback = false; pushDuringDiff = false
  rejectStatus = 503
  pushDuringReviewList = false; hideComments = false; pushDuringPost = false
  gitRefHead = undefined; refDelay = 0; refReads = 0; diffReads = 0; pushRefDuringDiff = false; pushRefDuringPost = false
  corruptComment = false; corruptSummary = false; dropComments = false; wrongPosition = false; lastPostWasASCII = false
  server = Bun.serve({ port: 0, fetch: async request => {
    const path = new URL(request.url).pathname
    if (path === "/api/v1/user") return Response.json({ id: 7, login: "review-bot" })
    if (path.endsWith("/issues/1/timeline")) return Response.json(timeline)
    if (request.method === "DELETE" && /\/issues\/comments\/\d+$/.test(path)) {
      if (!retainTimeline) timeline = timeline.filter(entry => entry.id !== Number(path.split("/").at(-1)))
      return new Response(null, { status: 204 })
    }
    if (path.endsWith("/pulls/1")) return Response.json({ head: { sha: head }, base: { sha: base }, state: "open", merged: false })
    if (path.endsWith("/pulls/1/commits")) return Response.json([{ sha: head }])
    if (path.endsWith("/git/refs/pull/1/head")) {
      refReads++
      return Response.json([{ ref: "refs/pull/1/head", object: { sha: refDelay-- > 0 ? "stale-head" : gitRefHead ?? head } }])
    }
    if (path.endsWith(".diff")) {
      diffReads++
      if (pushDuringDiff) head = "head-b"
      if (pushRefDuringDiff) gitRefHead = "head-b"
      return new Response(diff)
    }
    if (/\/reviews\/\d+\/comments$/.test(path)) return Response.json(hideComments ? [] : publishedComments)
    if (/\/reviews\/\d+$/.test(path)) {
      if (failReadback) return new Response("unavailable", { status: 503 })
      return Response.json(reviews.find(r => r.id === Number(path.split("/").at(-1))))
    }
    if (path.endsWith("/reviews")) {
      if (request.method === "POST") {
        posts++
        const wire = await request.text()
        lastPostWasASCII = !/[^\x00-\x7f]/.test(wire)
        const payload = JSON.parse(wire) as { body: string; event: string; commit_id: string; comments: { path: string; body: string; new_position: number; old_position: number }[] }
        publishedComments = dropComments ? [] : (payload.comments ?? []).map(comment => ({ path: comment.path,
          body: corruptComment ? `${comment.body} CORRUPTED` : comment.body,
          position: wrongPosition ? 99 : comment.new_position, original_position: comment.old_position }))
        const result: Review = { id: reviews.length + 1, body: corruptSummary ? payload.body.replace("Review result", "Corrupted summary") : payload.body, state: payload.event,
          commit_id: payload.commit_id, user: { id: 7, login: "review-bot" }, comments_count: publishedComments.length }
        if (!rejectPost) {
          reviews.push(result)
          timeline.push({ id: result.id, type: "review", review_id: result.id, user: result.user, body: payload.body })
        }
        if (pushDuringPost) head = "head-b"
        if (pushRefDuringPost) gitRefHead = "head-b"
        if (loseResponse || rejectPost) return new Response("lost response", { status: rejectStatus })
        return Response.json(result)
      }
      if (pushDuringReviewList) head = "head-b"
      return Response.json(reviews)
    }
    return new Response(`Unexpected request ${request.method} ${path}`, { status: 404 })
  } })
  process.env.GITEA_SERVER_URL = server.url.origin
  process.env.GITEA_TOKEN = "test-token"
  process.env.REPO_OWNER = args.owner
  process.env.REPO_NAME = args.repo
  process.env.PR_NUMBER = String(args.pull_number)
  delete process.env.OPENCODE_REVIEW_TARGET
  process.env.OPENCODE_REVIEW_STATE_DIR = directory
  delete process.env.OPENCODE_REVIEW_RUN_ID
  delete process.env.OPENCODE_REVIEW_RECEIPT_PATH
  delete process.env.REVIEW_MODE
  delete process.env.OPENCODE_REVIEW_MODE
  process.env.REVIEW_OUTPUT_DIR = join(directory, "output")
})
afterEach(() => {
  server.stop(true)
  rmSync(directory, { recursive: true, force: true })
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]
  Object.assign(process.env, savedEnv)
})

const fetchDiff = (ctx: ReturnType<typeof context>) => diffTool.execute({ ...args, format: "parsed", file_patterns: undefined }, ctx)
const submit = (ctx: ReturnType<typeof context>, line = 2) => reviewTool.execute({ ...args, summary: "Review result",
  approval: "comment", comments: [{ path: "app.ts", line, body: "**[BUG:HIGH]** Example finding" }] }, ctx)

test("draft saves PENDING regardless of recommended approval and exports summary without exposing it in timeline", async () => {
  process.env.REVIEW_MODE = "draft"
  process.env.REVIEW_OUTPUT_DIR = join(directory, "output")
  const ctx = context(); await fetchDiff(ctx)
  const receiptPath = join(directory, "receipt.json"); process.env.OPENCODE_REVIEW_RECEIPT_PATH = receiptPath
  expect(await reviewTool.execute({ ...args, summary: "Private AI summary", approval: "approve", comments: [] }, ctx)).toContain("not published")
  expect(reviews[0].state).toBe("PENDING")
  expect(reviews[0].body).not.toContain("Private AI summary")
  expect(timeline).toHaveLength(0)
  const receipt = await Bun.file(receiptPath).json()
  expect(receipt.status).toBe("draft_saved")
  expect(receipt.url).toBe(`${server.url.origin}/owner/repo/pulls/1/files`)
  expect(await Bun.file(receipt.artifacts.markdown).text()).toBe("Private AI summary\n")
  expect((await Bun.file(receipt.artifacts.json).json()).recommendation).toBe("approve")
})
for (const target of [{ ...args, owner: "pulls" }, { ...args, repo: "pulls" }]) {
  test(`draft handoff succeeds when the target is ${target.owner}/${target.repo}`, async () => {
    process.env.REVIEW_MODE = "draft"
    process.env.REPO_OWNER = target.owner; process.env.REPO_NAME = target.repo
    const receiptPath = join(directory, "receipt.json"); process.env.OPENCODE_REVIEW_RECEIPT_PATH = receiptPath
    const input = { ...target, summary: "Private AI summary", approval: "comment" as const,
      comments: [{ path: "app.ts", line: 2, body: "Draft finding" }] }
    for (const expected of ["draft_saved", "draft_reused"]) {
      const ctx = context()
      await diffTool.execute({ ...target, format: "parsed", file_patterns: undefined }, ctx)
      await reviewTool.execute(input, ctx)
      const receipt = await Bun.file(receiptPath).json()
      expect(receipt.status).toBe(expected)
      expect(receipt.url).toBe(`${server.url.origin}/${target.owner}/${target.repo}/pulls/1/files`)
      expect(timeline).toHaveLength(0)
    }
    expect(posts).toBe(1)
    expect(reviews[0].state).toBe("PENDING")
    expect(publishedComments).toHaveLength(1)
  })
}
test("draft repeat reuses existing content and does not become an incremental completed baseline", async () => {
  process.env.REVIEW_MODE = "draft"
  const ctx = context(); await fetchDiff(ctx); await submit(ctx)
  const next = context()
  expect(await incrementalTool.execute({ ...args, format: "parsed" }, next)).not.toContain("No New Changes")
  expect(await submit(next)).toContain("not published")
  expect(posts).toBe(1)
})
test("draft preserves manually edited comments and does not create or overwrite reviews", async () => {
  process.env.REVIEW_MODE = "draft"
  const ctx = context(); await fetchDiff(ctx); await submit(ctx)
  publishedComments[0].body = "Human revision"
  await expect(submit(ctx)).rejects.toThrow("DRAFT_EDITED")
  expect(publishedComments[0].body).toBe("Human revision")
  expect(posts).toBe(1)
})
test("draft recognizes manual submission after editing the summary", async () => {
  process.env.REVIEW_MODE = "draft"
  const ctx = context(); await fetchDiff(ctx); await submit(ctx)
  reviews[0].state = "COMMENT"; reviews[0].body = "Human revised summary"
  expect(await submit(ctx)).toContain("already submitted by reviewer")
  expect(posts).toBe(1)
})
test("draft rejects an existing manual pending review and an older pending draft", async () => {
  process.env.REVIEW_MODE = "draft"
  reviews.push({ id: 99, user: { id: 7, login: "review-bot" }, state: "PENDING", commit_id: "old-head", body: "Human pending work" })
  const ctx = context(); await fetchDiff(ctx)
  await expect(submit(ctx)).rejects.toThrow("DRAFT_CONFLICT")
  expect(posts).toBe(0)
})
test("submit mode refuses to accidentally publish a pending human review", async () => {
  reviews.push({ id: 99, user: { id: 7, login: "review-bot" }, state: "PENDING", commit_id: head, body: "Human pending work" })
  const ctx = context(); await fetchDiff(ctx)
  await expect(submit(ctx)).rejects.toThrow("PENDING_REVIEW_EXISTS")
  expect(posts).toBe(0)
})
test("draft reconciles an accepted POST with a lost response without another POST", async () => {
  process.env.REVIEW_MODE = "draft"; loseResponse = true
  const ctx = context(); await fetchDiff(ctx)
  expect(await submit(ctx)).toContain("not published")
  expect(posts).toBe(1)
  expect(reviews).toHaveLength(1)
})
test("draft cannot retry a rejected or ambiguous POST automatically", async () => {
  process.env.REVIEW_MODE = "draft"; rejectPost = true
  const ctx = context(); await fetchDiff(ctx)
  await expect(submit(ctx)).rejects.toThrow("DRAFT_UNKNOWN")
  await expect(submit(ctx)).rejects.toThrow("DRAFT_UNKNOWN")
  expect(posts).toBe(1)
})
test("retained native timeline entry contains only an opaque placeholder and emits a compatibility warning", async () => {
  process.env.REVIEW_MODE = "draft"; retainTimeline = true
  const ctx = context(); await fetchDiff(ctx)
  expect(await submit(ctx)).toContain("PENDING_TIMELINE_RETAINED")
  expect(timeline).toHaveLength(1)
  expect(timeline[0].body).not.toContain("Review result")
  expect(timeline[0].body).not.toContain("Example finding")
})
test("invalid mode fails before writing a review", async () => {
  process.env.REVIEW_MODE = "invalid"
  const ctx = context(); await fetchDiff(ctx)
  await expect(submit(ctx)).rejects.toThrow("REVIEW_MODE_INVALID")
  expect(posts).toBe(0)
})
test("draft requires persistent output configuration before any review write", async () => {
  process.env.REVIEW_MODE = "draft"; delete process.env.REVIEW_OUTPUT_DIR
  await expect(submit(context())).rejects.toThrow("DRAFT_OUTPUT_REQUIRED")
  expect(posts).toBe(0)
})
test("concurrent draft calls create only one native review", async () => {
  process.env.REVIEW_MODE = "draft"
  const ctx = context(); await fetchDiff(ctx)
  const results = await Promise.allSettled([submit(ctx), submit(ctx)])
  expect(results.some(result => result.status === "fulfilled")).toBe(true)
  expect(posts).toBe(1)
  expect(reviews).toHaveLength(1)
})
test("draft exports do not overwrite a locally edited summary", async () => {
  process.env.REVIEW_MODE = "draft"
  const receiptPath = join(directory, "receipt.json"); process.env.OPENCODE_REVIEW_RECEIPT_PATH = receiptPath
  const ctx = context(); await fetchDiff(ctx); await submit(ctx)
  const receipt = await Bun.file(receiptPath).json()
  await Bun.write(receipt.artifacts.markdown, "Human edited local summary")
  await submit(ctx)
  expect(await Bun.file(receipt.artifacts.markdown).text()).toBe("Human edited local summary")
  expect(posts).toBe(1)
})

test("refuses to fetch a different PR from the configured target", async () => {
  process.env.PR_NUMBER = "99"
  await expect(fetchDiff(context())).rejects.toThrow("REVIEW_TARGET_MISMATCH")
  expect(diffReads).toBe(0)
  expect(posts).toBe(0)
})
test("refuses publishing a snapshot for another target", async () => {
  const ctx = context(); await fetchDiff(ctx)
  process.env.REPO_NAME = "other"
  await expect(submit(ctx)).rejects.toThrow("REVIEW_TARGET_MISMATCH")
  expect(posts).toBe(0)
})
test("refuses another server when the runner has frozen its target", async () => {
  process.env.OPENCODE_REVIEW_TARGET = JSON.stringify({ server: "https://other.example.com", ...args })
  await expect(fetchDiff(context())).rejects.toThrow("REVIEW_TARGET_MISMATCH")
  expect(diffReads).toBe(0)
})
test("a run cannot mix raw and parsed delivery pages", async () => {
  const ctx = context(); await fetchDiff(ctx)
  await expect(diffTool.execute({ ...args, format: "raw", file_patterns: undefined }, ctx)).rejects.toThrow("REVIEW_PAGES_CHANGED")
})
test("changing review requirements does not reuse the earlier verdict", async () => {
  const first = context(); await fetchDiff(first); await submit(first)
  process.env.REVIEW_TEMPLATE = "security"
  const next = context()
  expect(await incrementalTool.execute({ ...args, format: "parsed" }, next)).not.toContain("No New Changes")
  expect(await submit(next)).toContain("submitted and confirmed")
  expect(posts).toBe(2)
  expect(await incrementalTool.execute({ ...args, format: "parsed" }, context())).toContain("No New Changes")
})
test("newly configured unavailable requirements cannot be bypassed by an old review", async () => {
  const first = context(); await fetchDiff(first); await submit(first)
  process.env.REVIEW_RULES = "docs/unavailable.md"
  await expect(incrementalTool.execute({ ...args, format: "parsed" }, context())).rejects.toThrow("RULES_UNAVAILABLE")
  expect(posts).toBe(1)
})
test("submitted, duplicate and unchanged receipts carry the same target", async () => {
  const receiptPath = join(directory, "receipt.json")
  process.env.OPENCODE_REVIEW_RECEIPT_PATH = receiptPath
  const ctx = context(); await fetchDiff(ctx)
  for (const action of [() => submit(ctx), () => submit(ctx), () => incrementalTool.execute({ ...args, format: "parsed" }, context())]) {
    await action()
    expect((await Bun.file(receiptPath).json()).target).toEqual({ server: server.url.origin, ...args })
  }
})

test("refuses submission without fetching a snapshot", async () => {
  await expect(submit(context())).rejects.toThrow("SNAPSHOT_REQUIRED")
  expect(posts).toBe(0)
})
test("parallel diff tools cannot overwrite the captured version", async () => {
  const snapshot = { head: "head-a", base: "base", scope: "all", diff, reviewDiff: diff }
  const results = await Promise.allSettled([
    saveSnapshot(server.url.origin, args, snapshot, "parallel-session"),
    saveSnapshot(server.url.origin, args, { ...snapshot, head: "head-b" }, "parallel-session"),
  ])
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1)
  expect(["head-a", "head-b"]).toContain((await loadSnapshot(server.url.origin, args, "parallel-session"))?.head)
})
test("refuses a changed head and cannot silently overwrite the run's snapshot", async () => {
  const ctx = context(); await fetchDiff(ctx); head = "head-b"
  await expect(submit(ctx)).rejects.toThrow("PR_CHANGED")
  await expect(fetchDiff(ctx)).rejects.toThrow("PR_CHANGED")
  expect(posts).toBe(0)
})
test("detects pushes while fetching the diff", async () => {
  pushDuringDiff = true
  await expect(fetchDiff(context())).rejects.toThrow("PR_CHANGED")
})
test("waits for the Git pull ref before accepting a metadata head", async () => {
  refDelay = 2
  expect(await fetchDiff(context())).toContain("Head: head-a")
  expect(refReads).toBeGreaterThanOrEqual(3)
  expect(diffReads).toBe(1)
})
test("a persistently stale pull ref cannot create a snapshot", async () => {
  gitRefHead = "stale-head"
  const ctx = context()
  await expect(fetchDiff(ctx)).rejects.toThrow("PR_DIFF_NOT_READY")
  expect(diffReads).toBe(0)
  expect(await loadSnapshot(server.url.origin, args, ctx.sessionID)).toBeUndefined()
})
test("detects a pull-ref push even when the PR metadata has not caught up", async () => {
  pushRefDuringDiff = true
  await expect(fetchDiff(context())).rejects.toThrow("PR_CHANGED")
})
test("rechecks the head immediately before publication", async () => {
  const ctx = context(); await fetchDiff(ctx); pushDuringReviewList = true
  await expect(submit(ctx)).rejects.toThrow("PR_CHANGED")
  expect(posts).toBe(0)
})
test("a Git ref ahead of PR metadata blocks publication", async () => {
  const ctx = context(); await fetchDiff(ctx); gitRefHead = "head-b"
  await expect(submit(ctx)).rejects.toThrow("PR_CHANGED")
  expect(posts).toBe(0)
})
test("a ref-only push racing POST cannot produce a success receipt", async () => {
  const ctx = context(); await fetchDiff(ctx); pushRefDuringPost = true
  process.env.OPENCODE_REVIEW_RECEIPT_PATH = join(directory, "receipt.json")
  await expect(submit(ctx)).rejects.toThrow("PR_CHANGED")
  expect(await Bun.file(process.env.OPENCODE_REVIEW_RECEIPT_PATH).exists()).toBe(false)
})
test("base branch changes invalidate the captured review", async () => {
  const ctx = context(); await fetchDiff(ctx); base = "new-base"
  await expect(submit(ctx)).rejects.toThrow("PR_CHANGED")
  expect(posts).toBe(0)
})
test("a push racing POST cannot produce a success receipt for the old head", async () => {
  const ctx = context(); await fetchDiff(ctx); pushDuringPost = true
  process.env.OPENCODE_REVIEW_RECEIPT_PATH = join(directory, "receipt.json")
  await expect(submit(ctx)).rejects.toThrow("PR_CHANGED")
  expect(posts).toBe(1)
  expect(reviews[0].commit_id).toBe("head-a")
  expect(await Bun.file(process.env.OPENCODE_REVIEW_RECEIPT_PATH).exists()).toBe(false)
})
test("validates line comments against the fetched diff", async () => {
  const ctx = context(); await fetchDiff(ctx)
  await expect(submit(ctx, 99)).rejects.toThrow("INVALID_REVIEW_COMMENT")
  expect(posts).toBe(0)
})
test("repeated triggers use the confirmed review instead of posting again", async () => {
  const first = context(); await fetchDiff(first); await submit(first)
  const second = context(); await fetchDiff(second)
  expect(await submit(second)).toContain("already submitted")
  expect(posts).toBe(1)
  expect(reviews[0].commit_id).toBe("head-a")
})
test("a lost POST response is recovered by reading the published review", async () => {
  const ctx = context(); await fetchDiff(ctx); loseResponse = true
  expect(await submit(ctx)).toContain("confirmed")
  await submit(ctx)
  expect(posts).toBe(1)
})
test("ambiguous writes are never blindly retried", async () => {
  const ctx = context(); await fetchDiff(ctx); rejectPost = true
  await expect(submit(ctx)).rejects.toThrow("SUBMISSION_UNKNOWN")
  await expect(submit(ctx)).rejects.toThrow("SUBMISSION_UNKNOWN")
  expect(posts).toBe(1)
})
test("HTTP 408 is also an ambiguous write, not a safe retry", async () => {
  const ctx = context(); await fetchDiff(ctx); rejectPost = true; rejectStatus = 408
  await expect(submit(ctx)).rejects.toThrow("SUBMISSION_UNKNOWN")
  await expect(submit(ctx)).rejects.toThrow("SUBMISSION_UNKNOWN")
  expect(posts).toBe(1)
})
test("success requires a readable review receipt", async () => {
  const ctx = context(); await fetchDiff(ctx); failReadback = true
  await expect(submit(ctx)).rejects.toThrow("SUBMISSION_UNKNOWN")
  failReadback = false
  expect(await submit(ctx)).toContain("already submitted")
  expect(posts).toBe(1)
})
test("missing line comments cannot produce a success receipt", async () => {
  const ctx = context(); await fetchDiff(ctx); hideComments = true
  await expect(submit(ctx)).rejects.toThrow("SUBMISSION_UNKNOWN")
  hideComments = false
  expect(await submit(ctx)).toContain("already submitted")
  expect(posts).toBe(1)
})
test("large Unicode review payloads use ASCII JSON on the wire", async () => {
  const ctx = context(); await fetchDiff(ctx)
  expect(await reviewTool.execute({ ...args, summary: "中文总结".repeat(2000), approval: "comment",
    comments: [{ path: "app.ts", line: 2, body: "注释来自用户输入。".repeat(2000) }] }, ctx)).toContain("confirmed")
  expect(lastPostWasASCII).toBe(true)
})
test("an unchanged-head check cannot bypass corrupted comment read-back", async () => {
  const ctx = context(); await fetchDiff(ctx); corruptComment = true
  process.env.OPENCODE_REVIEW_RECEIPT_PATH = join(directory, "receipt.json")
  await expect(submit(ctx)).rejects.toThrow("SUBMISSION_UNKNOWN")
  const next = await incrementalTool.execute({ ...args, format: "parsed" }, ctx)
  expect(next).not.toContain("No New Changes")
  expect(await Bun.file(process.env.OPENCODE_REVIEW_RECEIPT_PATH).exists()).toBe(false)
  await expect(submit(ctx)).rejects.toThrow("SUBMISSION_UNKNOWN")
  expect(posts).toBe(1)
})
test("dropped comments cannot be certified by a later duplicate check", async () => {
  const ctx = context(); await fetchDiff(ctx); dropComments = true
  await expect(submit(ctx)).rejects.toThrow("SUBMISSION_UNKNOWN")
  await expect(submit(ctx)).rejects.toThrow("SUBMISSION_UNKNOWN")
  expect(posts).toBe(1)
})
test("corrupted summaries cannot produce a success receipt", async () => {
  const ctx = context(); await fetchDiff(ctx); corruptSummary = true
  await expect(submit(ctx)).rejects.toThrow("SUBMISSION_UNKNOWN")
})
test("line positions must also match the published review", async () => {
  const ctx = context(); await fetchDiff(ctx); wrongPosition = true
  await expect(submit(ctx)).rejects.toThrow("SUBMISSION_UNKNOWN")
})
