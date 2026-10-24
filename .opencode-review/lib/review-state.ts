import { createHash } from "node:crypto"
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { RepositoryPR, ReviewTarget } from "./gitea"

export const digest = (value: string) => createHash("sha256").update(value).digest("hex")
export const stateDirectory = () => process.env.OPENCODE_REVIEW_STATE_DIR || (process.env.REVIEW_OUTPUT_DIR
  ? join(process.env.REVIEW_OUTPUT_DIR, ".state") : join(tmpdir(), "opencode-review-state"))

export interface Snapshot {
  head: string
  base: string
  scope: string
  diff: string
  reviewDiff: string
  // Output pages the model must read before submitting, and the digest of the
  // template/standards delivered with them. Absent in snapshots without pages.
  pages?: number
  context?: string
  pageDigest?: string
}
export interface Receipt {
  mode?: "submit" | "draft"
  target: ReviewTarget
  status: "submitted" | "duplicate" | "unchanged" | "draft_saved" | "draft_reused" | "draft_submitted"
  head: string
  reviewId: number
  url: string
  artifacts?: { json: string; markdown: string }
  draftKey?: string
  warnings?: string[]
}

export function stateKey(server: string, pr: RepositoryPR) {
  return digest(JSON.stringify([server, pr.owner, pr.repo, pr.pull_number]))
}

function snapshotPath(server: string, pr: RepositoryPR, sessionID?: string) {
  const run = process.env.OPENCODE_REVIEW_RUN_ID || sessionID
  if (!run) throw new Error("Review tools require a session ID or OPENCODE_REVIEW_RUN_ID")
  return join(stateDirectory(), `snapshot-${digest(run)}-${stateKey(server, pr)}.json`)
}

export async function readJSON<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as T }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

export async function writeJSON(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
  await rename(temporary, path)
}

export async function loadSnapshot(server: string, pr: RepositoryPR, sessionID?: string) {
  return readJSON<Snapshot>(snapshotPath(server, pr, sessionID))
}

export async function saveSnapshot(server: string, pr: RepositoryPR, snapshot: Snapshot, sessionID?: string) {
  const path = snapshotPath(server, pr, sessionID)
  await mkdir(stateDirectory(), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 })
  try {
    // Publish a fully written file only if no snapshot exists. A read-then-rename
    // would let parallel diff tools overwrite each other's captured versions.
    await link(temporary, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const previous = await readJSON<Snapshot>(path)
    if (!previous || previous.head !== snapshot.head || previous.base !== snapshot.base) {
      throw new Error("PR_CHANGED: The pull request changed during this run. Start a new review run.")
    }
    if (previous.scope !== snapshot.scope || previous.reviewDiff !== snapshot.reviewDiff) {
      throw new Error("SNAPSHOT_SCOPE_CHANGED: Use one diff scope per review run; start a new run for another scope")
    }
    if (previous.pages !== snapshot.pages || previous.context !== snapshot.context) {
      throw new Error("REVIEW_CONTEXT_CHANGED: The review template or standards changed during this run. Start a new review run.")
    }
    if (previous.pageDigest !== snapshot.pageDigest) {
      throw new Error("REVIEW_PAGES_CHANGED: Diff format or page boundaries changed during this run. Start a new review run.")
    }
  } finally {
    await rm(temporary, { force: true })
  }
}

const pagePath = (server: string, pr: RepositoryPR, page: number, sessionID?: string) =>
  snapshotPath(server, pr, sessionID).replace(/\.json$/, `.page-${page}`)

export async function markPageRead(server: string, pr: RepositoryPR, page: number, sessionID?: string) {
  await writeFile(pagePath(server, pr, page, sessionID), "", { mode: 0o600 })
}

export async function unreadPages(server: string, pr: RepositoryPR, pages: number, sessionID?: string) {
  const unread: number[] = []
  for (let page = 1; page <= pages; page++) {
    try { await readFile(pagePath(server, pr, page, sessionID)) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      unread.push(page)
    }
  }
  return unread
}

export async function writeReceipt(receipt: Receipt) {
  const path = process.env.OPENCODE_REVIEW_RECEIPT_PATH
  if (path) await writeJSON(path, receipt)
}

export interface ReviewMarker { head: string; base: string; scope: string; key: string; context?: string; summaryDigest: string; commentsDigest: string }
export function reviewMarker(marker: ReviewMarker) {
  return `<!-- opencode-review:v1 ${JSON.stringify(marker)} -->`
}
export function parseReviewMarker(body: string): ReviewMarker | undefined {
  const matches = [...body.matchAll(/<!-- opencode-review:v1 (\{[^\n]*\}) -->/g)]
  try {
    const marker = JSON.parse(matches.at(-1)?.[1] || "null")
    if (marker && [marker.head, marker.base, marker.scope, marker.key].every(x => typeof x === "string" && x.length) &&
        [marker.summaryDigest, marker.commentsDigest].every(x => typeof x === "string" && /^[a-f0-9]{64}$/.test(x)) &&
        (marker.context === undefined || typeof marker.context === "string" && /^[a-f0-9]{64}$/.test(marker.context))) return marker
  } catch { /* Unrecognized user text is not a completed bot review. */ }
}
