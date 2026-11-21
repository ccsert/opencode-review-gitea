import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { readJSON, stateDirectory, type Receipt } from "./lib/review-state"
import { configuredReviewTarget, matchesReviewTarget, reviewURL } from "./lib/gitea"
import { reviewMode } from "./lib/review-mode"
import { draftWaitSeconds } from "./lib/draft-summary"
import { runDraftWatcher } from "./draft-watch"
import { readMountedRules } from "./lib/mounted-rules"

function reviewRunTimeoutSeconds() {
  const raw = process.env.REVIEW_RUN_TIMEOUT_SECONDS ?? "900"
  const seconds = Number(raw)
  if (!/^[0-9]+$/.test(raw) || !Number.isInteger(seconds) || seconds < 1 || seconds > 86400) {
    throw new Error("INVALID_REVIEW_RUN_TIMEOUT: REVIEW_RUN_TIMEOUT_SECONDS must be an integer from 1 to 86400.")
  }
  return seconds
}

export async function runReview(prompt: string) {
  const mode = reviewMode()
  const wait = mode === "draft" ? draftWaitSeconds() : 0
  const runTimeout = reviewRunTimeoutSeconds()
  const target = configuredReviewTarget(true)!
  // Fail before the model (and before any draft/write) for an invalid explicit
  // mount. Tool loading reads it again and binds its content to the snapshot.
  await readMountedRules()
  const runID = crypto.randomUUID()
  const state = resolve(stateDirectory())
  const receiptPath = join(state, `receipt-${runID}.json`)
  await mkdir(stateDirectory(), { recursive: true, mode: 0o700 })
  // OpenCode also discovers opencode.json/.opencode/AGENTS.md from cwd. Review
  // tools use the API, so run outside PR files and keep explicit trusted config.
  const directory = await mkdtemp(join(tmpdir(), "opencode-review-run-"))
  try {
    const instruction = mode === "draft" ? `${prompt}\nDelivery mode: draft. gitea-review saves a PENDING review only. Do not publish. After it confirms draft_saved, draft_reused or draft_submitted, stop and report the native page and exported summary path.` : prompt
    // A private server per run: the tools read this run's environment, which a shared
    // background service started by an earlier run would not have.
    const child = Bun.spawn(["opencode", "run", "--standalone", "--agent", "code-review", instruction], {
      cwd: directory, stdin: "inherit", stdout: "inherit", stderr: "inherit",
      env: { ...process.env, OPENCODE_REVIEW_RUN_ID: runID, OPENCODE_REVIEW_RECEIPT_PATH: receiptPath,
        OPENCODE_REVIEW_MODE: mode,
        OPENCODE_DISABLE_PROJECT_CONFIG: "true",
        // OpenCode refreshes the model catalog itself; this keeps the offline switch.
        ...(process.env.OPENCODE_REFRESH_MODELS === "false" ? { OPENCODE_DISABLE_MODELS_FETCH: "true" } : {}),
        OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR ? resolve(process.env.OPENCODE_CONFIG_DIR) : undefined,
        OPENCODE_CONFIG: process.env.OPENCODE_CONFIG ? resolve(process.env.OPENCODE_CONFIG) : undefined,
        OPENCODE_REVIEW_STATE_DIR: state,
        REVIEW_OUTPUT_DIR: process.env.REVIEW_OUTPUT_DIR ? resolve(process.env.REVIEW_OUTPUT_DIR) : undefined,
        OPENCODE_REVIEW_TARGET: JSON.stringify(target) },
    })
    let timedOut = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const runTimer = setTimeout(() => {
      timedOut = true
      console.error(`REVIEW_RUN_TIMEOUT: OpenCode did not finish within ${runTimeout}s. Check gateway reachability from the review environment, stream completion and tool-call support. Check the native PR and persisted state before rerunning; this attempt may already have written a review.`)
      child.kill("SIGTERM")
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2000)
    }, runTimeout * 1000)
    let status: number
    try { status = await child.exited }
    finally { clearTimeout(runTimer); clearTimeout(killTimer) }
    if (timedOut) return 124
    if (status !== 0) {
      console.error(`REVIEW_RUN_FAILED: OpenCode exited with status ${status}. Check its output above and the gateway response; no automatic retry was made.`)
      return status
    }
    const receipt = await readJSON<Receipt>(receiptPath)
    const statuses = mode === "draft" ? ["draft_saved", "draft_reused", "draft_submitted"] : ["submitted", "duplicate", "unchanged"]
    if (!receipt || !statuses.includes(receipt.status) ||
        !receipt.head || !Number.isInteger(receipt.reviewId) || receipt.reviewId <= 0 || !receipt.url) {
      console.error("REVIEW_NOT_CONFIRMED: OpenCode exited without a verified Gitea review receipt. Check whether the model emitted a supported gitea-review tool call, and inspect the native PR and persisted state before rerunning.")
      return 1
    }
    const expectedURL = mode === "draft" ? `${target.server}/${target.owner}/${target.repo}/pulls/${target.pull_number}/files` : reviewURL(target, receipt.reviewId)
    if (!matchesReviewTarget(receipt.target, target) || receipt.url !== expectedURL ||
        (mode === "draft" && (receipt.mode !== "draft" || !receipt.artifacts?.markdown || !receipt.artifacts?.json)) ||
        (mode === "submit" && receipt.mode === "draft")) {
      console.error("REVIEW_TARGET_MISMATCH: The verified receipt does not belong to this run's fixed server, repository and PR")
      return 1
    }
    console.log(`Verified ${mode === "draft" ? "draft" : "review"}: ${receipt.url} (${receipt.head}, ${receipt.status})`)
    if (mode === "draft") {
      console.log(`Local summary preview: ${receipt.artifacts!.markdown}`)
      for (const warning of receipt.warnings ?? []) console.warn(warning)
      if (wait > 0) await runDraftWatcher(receipt.draftKey ?? "")
      else console.log(`Draft saved without waiting (DRAFT_WAIT_TIMEOUT_SECONDS=0). To attach the summary after submission, resume: draft-watch ${receipt.draftKey ?? "<draft-key>"}`)
    }
    await rm(receiptPath, { force: true })
    return 0
  } finally { await rm(directory, { recursive: true, force: true }) }
}

if (import.meta.main) {
  try { process.exit(await runReview(process.argv.slice(2).join(" "))) }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1) }
}
