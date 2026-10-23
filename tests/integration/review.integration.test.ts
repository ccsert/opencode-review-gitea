import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { api, labs, type Lab } from "./lab"
import { fixture } from "./fixtures"
import diffTool from "../../.opencode-review/tools/gitea-pr-diff"
import incrementalTool from "../../.opencode-review/tools/gitea-incremental-diff"
import reviewTool from "../../.opencode-review/tools/gitea-review"
import filesTool from "../../.opencode-review/tools/gitea-pr-files"

const context = () => ({ sessionID: crypto.randomUUID(), messageID: "integration", agent: "code-review",
  abort: new AbortController().signal, metadata() {}, async ask() {} })
let previousEnv: NodeJS.ProcessEnv | undefined
let state: string | undefined
const proxies: ReturnType<typeof Bun.serve>[] = []
afterEach(() => {
  for (const proxy of proxies.splice(0)) proxy.stop(true)
  if (state) rmSync(state, { recursive: true, force: true })
  if (previousEnv) {
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key]
    Object.assign(process.env, previousEnv)
  }
})

function configure(lab: Lab, url = lab.url) {
  previousEnv = { ...process.env }
  state = mkdtempSync(join(tmpdir(), "review-integration-"))
  process.env.GITEA_SERVER_URL = url
  process.env.GITEA_TOKEN = lab.botToken
  process.env.OPENCODE_REVIEW_STATE_DIR = state
  delete process.env.OPENCODE_REVIEW_RUN_ID
  delete process.env.OPENCODE_REVIEW_RECEIPT_PATH
}
const fetchDiff = (args: Awaited<ReturnType<typeof fixture>>["args"], ctx: ReturnType<typeof context>) =>
  diffTool.execute({ ...args, format: "parsed", file_patterns: undefined }, ctx)
const submit = (args: Awaited<ReturnType<typeof fixture>>["args"], ctx: ReturnType<typeof context>, line = 2) =>
  reviewTool.execute({ ...args, summary: "Local integration review", approval: "comment",
    comments: [{ path: "app.ts", line, body: "**[BUG:HIGH]** Integration finding" }] }, ctx)

function proxyFor(lab: Lab, fault: (request: Request, response: Response) => Promise<Response>) {
  const proxy = Bun.serve({ port: 0, idleTimeout: 60, fetch: async request => {
    const url = new URL(request.url)
    const headers = new Headers(request.headers)
    headers.delete("host")
    headers.delete("connection")
    headers.set("accept-encoding", "identity")
    const response = await fetch(`${lab.url}${url.pathname}${url.search}`, {
      method: request.method, headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
    })
    const result = await fault(request, response)
    const responseHeaders = new Headers(result.headers)
    responseHeaders.delete("content-encoding")
    responseHeaders.delete("content-length")
    responseHeaders.delete("transfer-encoding")
    return new Response(await result.arrayBuffer(), { status: result.status, headers: responseHeaders })
  } })
  proxies.push(proxy)
  return proxy.url.origin
}

for (const lab of await labs()) {
  describe(lab.name, () => {
    test("publishes a real review and line comment on the captured commit", async () => {
      const f = await fixture(lab); configure(lab); const ctx = context()
      expect(await fetchDiff(f.args, ctx)).toContain(`[NEW:2] +export const b = 2`)
      expect(await submit(f.args, ctx)).toContain("confirmed")
      const reviews = await api(lab, `${f.path}/reviews`)
      expect(reviews).toHaveLength(1)
      expect(reviews[0].commit_id).toBe(f.head)
      const comments = await api(lab, `${f.path}/reviews/${reviews[0].id}/comments`)
      expect(comments).toHaveLength(1)
      expect(comments[0].path).toBe("app.ts")
      expect(comments[0].body).toContain("Integration finding")
    }, 30000)

    test("ignores a human review when selecting the incremental baseline", async () => {
      const f = await fixture(lab); configure(lab); const first = context()
      await fetchDiff(f.args, first); await submit(f.args, first)
      await f.push("export const a = 1\nexport const b = 2\nexport const c = 3\n")
      const latest = await api(lab, f.path)
      await api({ ...lab, adminToken: lab.humanToken }, `${f.path}/reviews`, {
        event: "COMMENT", commit_id: latest.head.sha, body: "Human review must not advance the bot baseline",
      })
      const second = context()
      const diff = await incrementalTool.execute({ ...f.args, format: "parsed" }, second)
      expect(diff).toContain(`since completed bot review ${f.head}`)
      expect(diff).toContain("[NEW:3] +export const c = 3")
      await submit(f.args, second, 3)
      const reviews = await api(lab, `${f.path}/reviews`)
      expect(reviews.filter((r: any) => r.user.login === "review-bot")).toHaveLength(2)
    }, 30000)

    test("rejects a push between diff retrieval and submission", async () => {
      const f = await fixture(lab); configure(lab); const ctx = context()
      await fetchDiff(f.args, ctx)
      await f.push("export const a = 1\nexport const b = 200\n")
      await expect(submit(f.args, ctx)).rejects.toThrow("PR_CHANGED")
      expect(await api(lab, `${f.path}/reviews`)).toHaveLength(0)
    }, 30000)

    test("incremental review retains lib paths and valid PR line anchors", async () => {
      const f = await fixture(lab); configure(lab); const first = context()
      await fetchDiff(f.args, first); await submit(f.args, first)
      const repoPath = f.path.slice(0, f.path.indexOf("/pulls/"))
      await api(lab, `${repoPath}/contents/lib/foo.ts`, { branch: "feature", message: "Add lib module",
        content: Buffer.from("export const library = 1\n").toString("base64") })
      const next = context()
      const diff = await incrementalTool.execute({ ...f.args, format: "parsed" }, next)
      expect(diff).toContain("## lib/foo.ts")
      expect(diff).toContain("[NEW:1] +export const library = 1")
      expect(await reviewTool.execute({ ...f.args, summary: "New module checked", approval: "comment",
        comments: [{ path: "lib/foo.ts", line: 1, body: "**[TEST:LOW]** Library fixture" }] }, next)).toContain("confirmed")
    }, 30000)

    test("space and Unicode paths exclude Git's tab delimiter and reject phantom paths", async () => {
      const f = await fixture(lab); configure(lab); const ctx = context()
      const repoPath = f.path.slice(0, f.path.indexOf("/pulls/"))
      const filename = "docs/接入 说明.md"
      const created = await api(lab, `${repoPath}/contents/${encodeURI(filename)}`, { branch: "feature", message: "Add Unicode path fixture",
        content: Buffer.from("# 本地接入\n配置机器人 token。\n").toString("base64") })
      // Forgejo updates PR metadata asynchronously after a contents API commit.
      for (let attempt = 0; attempt < 30; attempt++) {
        if ((await api(lab, f.path)).head.sha === created.commit.sha) break
        await Bun.sleep(100)
      }
      expect((await api(lab, f.path)).head.sha).toBe(created.commit.sha)
      expect(await fetchDiff(f.args, ctx)).toContain(`## ${filename} (added)`)
      await expect(reviewTool.execute({ ...f.args, summary: "Must reject a phantom tab-suffixed path", approval: "comment",
        comments: [{ path: `${filename}\t`, line: 2, body: "Invalid path" }] }, ctx)).rejects.toThrow("INVALID_REVIEW_COMMENT")
      expect(await api(lab, `${f.path}/reviews`)).toHaveLength(0)
      expect(await reviewTool.execute({ ...f.args, summary: "Unicode path verified", approval: "comment",
        comments: [{ path: filename, line: 2, body: "**[TEST:LOW]** Real filename anchor verified" }] }, ctx)).toContain("confirmed")
      const reviews = await api(lab, `${f.path}/reviews`)
      const comments = await api(lab, `${f.path}/reviews/${reviews[0].id}/comments`)
      expect(comments[0].path).toBe(filename)
      expect(await api(lab, `${repoPath}/contents/${encodeURI(comments[0].path)}?ref=feature`)).toHaveProperty("sha")
    }, 30000)

    test("large Chinese summaries and suggestions survive publication byte-for-byte", async () => {
      const f = await fixture(lab); configure(lab); const ctx = context(); await fetchDiff(f.args, ctx)
      const summary = "本次审查来自真实集成测试。".repeat(1500)
      const body = "**[TEST:LOW]** 中文注释来自用户输入。".repeat(1500)
      const suggestion = "export const b = 3"
      expect(await reviewTool.execute({ ...f.args, summary, approval: "comment",
        comments: [{ path: "app.ts", line: 2, body, suggestion }] }, ctx)).toContain("confirmed")
      const reviews = await api(lab, `${f.path}/reviews`)
      expect(reviews[0].body.startsWith(summary + "\n\n")).toBe(true)
      const comments = await api(lab, `${f.path}/reviews/${reviews[0].id}/comments`)
      expect(comments[0].body).toBe(`${body}\n\n\`\`\`suggestion\n${suggestion}\n\`\`\`\n`)
      expect(await incrementalTool.execute({ ...f.args, format: "parsed" }, context())).toContain("No New Changes")
    }, 30000)

    test("lists every file of a paginated PR, filters nested paths and keeps code escapes", async () => {
      const f = await fixture(lab)
      const repoPath = f.path.slice(0, f.path.lastIndexOf("/pulls/"))
      const files = Array.from({ length: 60 }, (_, i) => ({ operation: "create", path: `gen/f${String(i).padStart(2, "0")}.txt`,
        content: Buffer.from(`${i}\n`).toString("base64") }))
      files.push({ operation: "create", path: "src/fmt.c", content: Buffer.from('#include <stdio.h>\nvoid f(void) { printf("a"); }\n').toString("base64") })
      await api(lab, `${repoPath}/contents`, { branch: "feature", message: "Many files", files })
      configure(lab)
      // The diff tool waits for refs/pull/N/head; the file list is served from that ref.
      const ctx = context()
      const diff = await diffTool.execute({ ...f.args, format: "parsed", file_patterns: ["*.c"] }, ctx)
      expect(diff).toContain("src/fmt.c")
      expect(diff).not.toContain("gen/f00.txt")
      const listing = await filesTool.execute({ ...f.args, file_patterns: undefined }, context())
      expect(listing).toContain("**Total:** 62 file(s)")
      expect(listing).toContain("`gen/f59.txt`")
      expect(await filesTool.execute({ ...f.args, file_patterns: ["*.c"] }, context())).toContain("**Matched:** 1 of 62 files")
      const body = "**[BUG:LOW]** Missing `\\n` in the output."
      const suggestion = 'void f(void) { printf("a\\n"); }'
      expect(await reviewTool.execute({ ...f.args, summary: "Escapes\n\nKeep `\\n` literal.", approval: "comment",
        comments: [{ path: "src/fmt.c", line: 2, body, suggestion }] }, ctx)).toContain("confirmed")
      const reviews = await api(lab, `${f.path}/reviews`)
      expect(reviews[0].body.startsWith("Escapes\n\nKeep `\\n` literal.\n\n")).toBe(true)
      const comments = await api(lab, `${f.path}/reviews/${reviews[0].id}/comments`)
      expect(comments[0].body).toBe(`${body}\n\n\`\`\`suggestion\n${suggestion}\n\`\`\`\n`)
    }, 60000)

    test("deleted-line comments retain their old-side positions", async () => {
      const f = await fixture(lab); configure(lab)
      await f.push("export const b = 2\n")
      const ctx = context()
      expect(await fetchDiff(f.args, ctx)).toContain("[OLD:1] -export const a = 1")
      expect(await reviewTool.execute({ ...f.args, summary: "Deleted line anchor verified", approval: "comment",
        comments: [{ path: "app.ts", old_line: 1, body: "**[TEST:LOW]** Deleted-line regression" }] }, ctx)).toContain("confirmed")
      const reviews = await api(lab, `${f.path}/reviews`)
      const comments = await api(lab, `${f.path}/reviews/${reviews[0].id}/comments`)
      expect(comments[0].original_position).toBe(1)
      expect(comments[0].position).toBe(0)
    }, 30000)

    test("a push racing the POST does not generate a success receipt", async () => {
      const f = await fixture(lab); let pushed = false
      const url = proxyFor(lab, async (request, response) => {
        if (!pushed && request.method === "POST" && new URL(request.url).pathname.endsWith("/reviews")) {
          pushed = true; await f.push("export const a = 1\nexport const b = 999\n")
        }
        return response
      })
      configure(lab, url)
      process.env.OPENCODE_REVIEW_RECEIPT_PATH = join(state!, "receipt.json")
      const ctx = context(); await fetchDiff(f.args, ctx)
      await expect(submit(f.args, ctx)).rejects.toThrow("PR_CHANGED")
      expect(await Bun.file(process.env.OPENCODE_REVIEW_RECEIPT_PATH).exists()).toBe(false)
      const reviews = await api(lab, `${f.path}/reviews`)
      expect(reviews[0].commit_id).toBe(f.head)
    }, 30000)

    test("concurrent local submissions and repeated triggers create one review", async () => {
      const f = await fixture(lab); configure(lab); const a = context(); const b = context()
      await fetchDiff(f.args, a); await fetchDiff(f.args, b)
      await Promise.all([submit(f.args, a), submit(f.args, b)])
      const next = context(); await fetchDiff(f.args, next); await submit(f.args, next)
      expect(await api(lab, `${f.path}/reviews`)).toHaveLength(1)
    }, 30000)

    test("recovers a timed-out POST after the real server accepted the review", async () => {
      const f = await fixture(lab)
      let posts = 0
      const url = proxyFor(lab, async (request, response) => {
        if (request.method === "POST" && new URL(request.url).pathname.endsWith("/reviews")) {
          posts++; const body = await response.text(); await Bun.sleep(1200)
          return new Response(body, { status: response.status })
        }
        return response
      })
      configure(lab, url); process.env.GITEA_API_TIMEOUT_MS = "300"
      const ctx = context(); await fetchDiff(f.args, ctx)
      expect(await submit(f.args, ctx)).toContain("confirmed")
      await submit(f.args, ctx)
      expect(posts).toBe(1)
      expect(await api(lab, `${f.path}/reviews`)).toHaveLength(1)
    }, 30000)

    test("requires read-back and can recover without creating another review", async () => {
      const f = await fixture(lab); let blockRead = true
      const url = proxyFor(lab, async (request, response) => {
        if (blockRead && /\/reviews\/\d+$/.test(new URL(request.url).pathname)) return new Response("Unavailable", { status: 503 })
        return response
      })
      configure(lab, url); const ctx = context(); await fetchDiff(f.args, ctx)
      await expect(submit(f.args, ctx)).rejects.toThrow("SUBMISSION_UNKNOWN")
      blockRead = false
      expect(await submit(f.args, ctx)).toContain("already submitted")
      expect(await api(lab, `${f.path}/reviews`)).toHaveLength(1)
    }, 30000)
  })
}
