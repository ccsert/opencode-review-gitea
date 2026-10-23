import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import diffTool from "../.opencode-review/tools/gitea-pr-diff"
import reviewTool from "../.opencode-review/tools/gitea-review"
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
let hideComments: boolean
let base: string
let publishedComments: { path: string; body: string }[]
let savedEnv: NodeJS.ProcessEnv
let session = 0
const context = () => ({ sessionID: `session-${++session}`, messageID: "message", agent: "code-review",
  abort: new AbortController().signal, metadata() {}, async ask() {} })

beforeEach(() => {
  savedEnv = { ...process.env }
  directory = mkdtempSync(join(tmpdir(), "review-consistency-"))
  head = "head-a"; reviews = []; posts = 0
  base = "base"
  publishedComments = []
  loseResponse = false; rejectPost = false; failReadback = false; pushDuringDiff = false
  rejectStatus = 503
  pushDuringReviewList = false; hideComments = false; pushDuringPost = false
  server = Bun.serve({ port: 0, fetch: async request => {
    const path = new URL(request.url).pathname
    if (path === "/api/v1/user") return Response.json({ id: 7, login: "review-bot" })
    if (path.endsWith("/pulls/1")) return Response.json({ head: { sha: head }, base: { sha: base }, state: "open", merged: false })
    if (path.endsWith(".diff")) {
      if (pushDuringDiff) head = "head-b"
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
        const payload = await request.json() as { body: string; event: string; commit_id: string; comments: { path: string; body: string }[] }
        publishedComments = payload.comments ?? []
        const result: Review = { id: reviews.length + 1, body: payload.body, state: payload.event,
          commit_id: payload.commit_id, user: { id: 7, login: "review-bot" }, comments_count: publishedComments.length }
        if (!rejectPost) reviews.push(result)
        if (pushDuringPost) head = "head-b"
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
  process.env.OPENCODE_REVIEW_STATE_DIR = directory
  delete process.env.OPENCODE_REVIEW_RUN_ID
  delete process.env.OPENCODE_REVIEW_RECEIPT_PATH
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
test("rechecks the head immediately before publication", async () => {
  const ctx = context(); await fetchDiff(ctx); pushDuringReviewList = true
  await expect(submit(ctx)).rejects.toThrow("PR_CHANGED")
  expect(posts).toBe(0)
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
