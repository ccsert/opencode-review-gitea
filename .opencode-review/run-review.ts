import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { readJSON, stateDirectory, type Receipt } from "./lib/review-state"
import { configuredReviewTarget, matchesReviewTarget, reviewURL } from "./lib/gitea"

export async function runReview(prompt: string) {
  const target = configuredReviewTarget(true)!
  const runID = crypto.randomUUID()
  const state = resolve(stateDirectory())
  const receiptPath = join(state, `receipt-${runID}.json`)
  await mkdir(stateDirectory(), { recursive: true, mode: 0o700 })
  // OpenCode also discovers opencode.json/.opencode/AGENTS.md from cwd. Review
  // tools use the API, so run outside PR files and keep explicit trusted config.
  const directory = await mkdtemp(join(tmpdir(), "opencode-review-run-"))
  try {
    const child = Bun.spawn(["opencode", "run", "--agent", "code-review", prompt], {
      cwd: directory, stdin: "inherit", stdout: "inherit", stderr: "inherit",
      env: { ...process.env, OPENCODE_REVIEW_RUN_ID: runID, OPENCODE_REVIEW_RECEIPT_PATH: receiptPath,
        OPENCODE_DISABLE_PROJECT_CONFIG: "true",
        OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR ? resolve(process.env.OPENCODE_CONFIG_DIR) : undefined,
        OPENCODE_CONFIG: process.env.OPENCODE_CONFIG ? resolve(process.env.OPENCODE_CONFIG) : undefined,
        OPENCODE_REVIEW_STATE_DIR: state,
        OPENCODE_REVIEW_TARGET: JSON.stringify(target) },
    })
    const status = await child.exited
    if (status !== 0) return status
    const receipt = await readJSON<Receipt>(receiptPath)
    if (!receipt || !["submitted", "duplicate", "unchanged"].includes(receipt.status) ||
        !receipt.head || !Number.isInteger(receipt.reviewId) || receipt.reviewId <= 0 || !receipt.url) {
      console.error("REVIEW_NOT_CONFIRMED: OpenCode exited without a verified Gitea review receipt. The run is incomplete.")
      return 1
    }
    if (!matchesReviewTarget(receipt.target, target) || receipt.url !== reviewURL(target, receipt.reviewId)) {
      console.error("REVIEW_TARGET_MISMATCH: The verified receipt does not belong to this run's fixed server, repository and PR")
      return 1
    }
    console.log(`Verified review: ${receipt.url} (${receipt.head}, ${receipt.status})`)
    await rm(receiptPath, { force: true })
    return 0
  } finally { await rm(directory, { recursive: true, force: true }) }
}

if (import.meta.main) {
  try { process.exit(await runReview(process.argv.slice(2).join(" "))) }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1) }
}
