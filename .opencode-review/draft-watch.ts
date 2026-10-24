import { configuredReviewTarget, GiteaClient } from "./lib/gitea"
import { watchDraftSummary } from "./lib/draft-summary"

export async function runDraftWatcher(key: string) {
  const controller = new AbortController()
  const stop = () => controller.abort(new Error("DRAFT_WAIT_INTERRUPTED: Waiting stopped; resume with the same output mount and draft key"))
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  try {
    return await watchDraftSummary(new GiteaClient(), configuredReviewTarget(true)!, key, { signal: controller.signal })
  } finally {
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
  }
}

if (import.meta.main) {
  try { await runDraftWatcher(process.argv[2] ?? "") }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
