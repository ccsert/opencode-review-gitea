import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { readJSON, stateDirectory, type Receipt } from "./lib/review-state"

export async function runReview(prompt: string) {
  const runID = crypto.randomUUID()
  const receiptPath = join(stateDirectory(), `receipt-${runID}.json`)
  await mkdir(stateDirectory(), { recursive: true, mode: 0o700 })
  const child = Bun.spawn(["opencode", "run", "--agent", "code-review", prompt], {
    stdin: "inherit", stdout: "inherit", stderr: "inherit",
    env: { ...process.env, OPENCODE_REVIEW_RUN_ID: runID, OPENCODE_REVIEW_RECEIPT_PATH: receiptPath },
  })
  const status = await child.exited
  if (status !== 0) return status
  const receipt = await readJSON<Receipt>(receiptPath)
  if (!receipt || !["submitted", "duplicate", "unchanged"].includes(receipt.status) ||
      !receipt.head || !Number.isInteger(receipt.reviewId) || receipt.reviewId <= 0 || !receipt.url) {
    console.error("REVIEW_NOT_CONFIRMED: OpenCode exited without a verified Gitea review receipt. The run is incomplete.")
    return 1
  }
  console.log(`Verified review: ${receipt.url} (${receipt.head}, ${receipt.status})`)
  await rm(receiptPath, { force: true })
  return 0
}

if (import.meta.main) {
  try { process.exit(await runReview(process.argv.slice(2).join(" "))) }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1) }
}
