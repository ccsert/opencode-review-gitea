import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GiteaClient, type Review } from "../.opencode-review/lib/gitea"
import { watchDraftSummary } from "../.opencode-review/lib/draft-summary"
import { digest, readJSON, writeJSON } from "../.opencode-review/lib/review-state"
import type { DraftRecord } from "../.opencode-review/lib/draft-review"

const args = { owner: "owner", repo: "repo", pull_number: 1 }
const key = digest("test-draft")
let env: NodeJS.ProcessEnv
let directory: string
let server: ReturnType<typeof Bun.serve>
let record: DraftRecord
let review: Review
let head: string
let ref: string
let posts: number
let loseResponse: boolean
let rejectPost: boolean
let comments: { id: number; user: { id: number }; body: string }[]
let pendingReads: number

const watch = (options: Parameters<typeof watchDraftSummary>[3] = {}) =>
  watchDraftSummary(new GiteaClient(), args, key, { timeoutMs: 200, pollMs: 5, ...options })

beforeEach(async () => {
  env = { ...process.env }
  directory = await mkdtemp(join(tmpdir(), "draft-summary-"))
  head = ref = "head"; posts = 0; comments = []; loseResponse = rejectPost = false; pendingReads = 0
  review = { id: 42, user: { id: 7, login: "human" }, state: "PENDING", commit_id: "head", body: "Human edits" }
  server = Bun.serve({ port: 0, fetch: async request => {
    const path = new URL(request.url).pathname
    if (path === "/api/v1/user") return Response.json({ id: 7 })
    if (path.endsWith("/reviews/42")) { pendingReads++; return Response.json(review) }
    if (path.endsWith("/pulls/1")) return Response.json({ head: { sha: head }, base: { sha: "base" }, state: "open", merged: false })
    if (path.endsWith("/git/refs/pull/1/head")) return Response.json([{ ref: "refs/pull/1/head", object: { sha: ref } }])
    if (path.endsWith("/issues/1/comments")) {
      if (request.method === "POST") {
        posts++
        if (!rejectPost) comments.push({ id: 99, user: { id: 7 }, body: (await request.json() as any).body })
        if (loseResponse || rejectPost) return new Response("lost response", { status: 503 })
        return Response.json(comments.at(-1))
      }
      return Response.json(comments)
    }
    throw new Error(`Unexpected request: ${request.method} ${path}`)
  } })
  Object.assign(process.env, { GITEA_SERVER_URL: server.url.origin, GITEA_TOKEN: "test", REVIEW_OUTPUT_DIR: directory,
    OPENCODE_REVIEW_STATE_DIR: join(directory, ".state"), REPO_OWNER: args.owner, REPO_NAME: args.repo, PR_NUMBER: "1" })
  delete process.env.OPENCODE_REVIEW_TARGET
  record = { key, target: { server: server.url.origin, ...args }, userId: 7, head: "head", base: "base",
    summary: "Private AI summary", comments: [], commentsDigest: "", recommendation: "comment", nativeBody: "placeholder", reviewId: 42 }
  await writeJSON(join(directory, ".state", `draft-${key}.json`), record)
  await writeFile(join(directory, `review-${key}.md`), record.summary)
})
afterEach(async () => {
  server.stop(true)
  await rm(directory, { recursive: true, force: true })
  for (const name of Object.keys(process.env)) if (!(name in env)) delete process.env[name]
  Object.assign(process.env, env)
})

test("waits privately for native submission, then attaches exactly one summary without changing human content", async () => {
  const completed = watch()
  while (!pendingReads) await Bun.sleep(1)
  expect(posts).toBe(0)
  expect(comments).toHaveLength(0)
  review.state = "COMMENT"
  expect(await completed).toContain("#issuecomment-99")
  expect(comments[0].body).toContain(record.summary)
  expect(comments[0].body).toContain("review `42`")
  expect(review.body).toBe("Human edits")
  expect(posts).toBe(1)
  await watch()
  expect(posts).toBe(1)
})
test("reads the locally edited summary automatically after submission", async () => {
  await writeFile(join(directory, `review-${key}.md`), "Edited local summary")
  review.state = "APPROVED"
  await watch()
  expect(comments[0].body).toContain("Edited local summary")
  expect(comments[0].body).not.toContain("Private AI summary")
})
test("timeout preserves the draft and a later invocation resumes without a model call", async () => {
  await expect(watch({ timeoutMs: 5 })).rejects.toThrow("DRAFT_WAIT_TIMEOUT")
  expect(posts).toBe(0)
  review.state = "REQUEST_CHANGES"
  await watch()
  expect(posts).toBe(1)
})
test("lost POST response reconciles a successful comment without another POST", async () => {
  review.state = "COMMENT"; loseResponse = true
  await watch(); await watch()
  expect(posts).toBe(1)
})
test("ambiguous failed POST persists intent and never retries a write after restart", async () => {
  review.state = "COMMENT"; rejectPost = true
  await expect(watch()).rejects.toThrow("DRAFT_SUMMARY_UNKNOWN")
  rejectPost = false
  await expect(watch()).rejects.toThrow("DRAFT_SUMMARY_UNKNOWN")
  expect(posts).toBe(1)
  expect((await readJSON<DraftRecord>(join(directory, ".state", `draft-${key}.json`)))!.summaryPublication?.body).toContain(record.summary)
})
test("reconciles a crash after POST but before saving the comment ID", async () => {
  review.state = "COMMENT"; await watch()
  const statePath = join(directory, ".state", `draft-${key}.json`)
  const saved = (await readJSON<DraftRecord>(statePath))!
  delete saved.summaryPublication!.commentId
  await writeJSON(statePath, saved)
  await watch()
  expect(posts).toBe(1)
})
test("does not recreate or overwrite a summary the human edited or deleted after publication", async () => {
  review.state = "COMMENT"; await watch()
  comments[0].body = "Human revised the published summary"
  await watch()
  expect(comments[0].body).toBe("Human revised the published summary")
  comments = []; await watch()
  expect(posts).toBe(1)
})
for (const change of ["head", "ref", "owner", "review-commit", "dismissed", "state", "target", "account"]) {
  test(`blocks stale or mismatched ${change} before publication`, async () => {
    review.state = "COMMENT"
    if (change === "head") head = "new-head"
    if (change === "ref") ref = "new-head"
    if (change === "owner") review.user.id = 8
    if (change === "review-commit") review.commit_id = "new-head"
    if (change === "dismissed") review.dismissed = true
    if (change === "state") review.state = "INVALID"
    if (change === "target") record.target.repo = "other"
    if (change === "account") record.userId = 8
    await writeJSON(join(directory, ".state", `draft-${key}.json`), record)
    await expect(watch()).rejects.toThrow()
    expect(posts).toBe(0)
  })
}
test("empty summary is never published", async () => {
  review.state = "COMMENT"; await writeFile(join(directory, `review-${key}.md`), " ")
  await expect(watch()).rejects.toThrow("DRAFT_SUMMARY_EMPTY")
  expect(posts).toBe(0)
})
test("concurrent watchers serialize; cancellation releases the lock for resumption", async () => {
  const controller = new AbortController()
  const first = watch({ signal: controller.signal })
  while (!pendingReads) await Bun.sleep(1)
  await expect(watch()).rejects.toThrow("DRAFT_BUSY")
  controller.abort(new Error("Stopped"))
  await expect(first).rejects.toThrow("Stopped")
  review.state = "COMMENT"; await watch()
  expect(posts).toBe(1)
  expect(await readFile(join(directory, `review-${key}.md`), "utf8")).toBe(record.summary)
})
