import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { readJSON, stateDirectory, type Receipt } from "./lib/review-state"
import { configuredReviewTarget, matchesReviewTarget, reviewURL } from "./lib/gitea"
import { reviewMode } from "./lib/review-mode"

export async function runReview(prompt: string) {
  const mode = reviewMode()
  const target = configuredReviewTarget(true)!
  const runID = crypto.randomUUID()
  const state = resolve(stateDirectory())
  const receiptPath = join(state, `receipt-${runID}.json`)
  await mkdir(stateDirectory(), { recursive: true, mode: 0o700 })
  // OpenCode also discovers opencode.json/.opencode/AGENTS.md from cwd. Review
  // tools use the API, so run outside PR files and keep explicit trusted config.
  const directory = await mkdtemp(join(tmpdir(), "opencode-review-run-"))
  try {
    const instruction = mode === "draft" ? `${prompt}\nDelivery mode: draft. gitea-review saves a PENDING review only. Do not publish. After it confirms draft_saved, draft_reused or draft_submitted, stop and report the native page and exported summary path.` : prompt
    const child = Bun.spawn(["opencode", "run", "--agent", "code-review", instruction], {
      cwd: directory, stdin: "inherit", stdout: "inherit", stderr: "inherit",
      env: { ...process.env, OPENCODE_REVIEW_RUN_ID: runID, OPENCODE_REVIEW_RECEIPT_PATH: receiptPath,
        OPENCODE_REVIEW_MODE: mode,
        OPENCODE_DISABLE_PROJECT_CONFIG: "true",
        OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR ? resolve(process.env.OPENCODE_CONFIG_DIR) : undefined,
        OPENCODE_CONFIG: process.env.OPENCODE_CONFIG ? resolve(process.env.OPENCODE_CONFIG) : undefined,
        OPENCODE_REVIEW_STATE_DIR: state,
        REVIEW_OUTPUT_DIR: process.env.REVIEW_OUTPUT_DIR ? resolve(process.env.REVIEW_OUTPUT_DIR) : undefined,
        OPENCODE_REVIEW_TARGET: JSON.stringify(target) },
    })
    const status = await child.exited
    if (status !== 0) return status
    const receipt = await readJSON<Receipt>(receiptPath)
    const statuses = mode === "draft" ? ["draft_saved", "draft_reused", "draft_submitted"] : ["submitted", "duplicate", "unchanged"]
    if (!receipt || !statuses.includes(receipt.status) ||
        !receipt.head || !Number.isInteger(receipt.reviewId) || receipt.reviewId <= 0 || !receipt.url) {
      console.error("REVIEW_NOT_CONFIRMED: OpenCode exited without a verified Gitea review receipt. The run is incomplete.")
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
      console.log(`Copy the summary from: ${receipt.artifacts!.markdown}`)
      for (const warning of receipt.warnings ?? []) console.warn(warning)
    }
    await rm(receiptPath, { force: true })
    return 0
  } finally { await rm(directory, { recursive: true, force: true }) }
}

if (import.meta.main) {
  try { process.exit(await runReview(process.argv.slice(2).join(" "))) }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1) }
}
