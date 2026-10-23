import { GiteaClient, prPath, requireOpen, type PullRequest, type RepositoryPR, type Review } from "./gitea"
import { filterFilesByPatterns, formatAsRawDiff, formatDiffForReview, parseDiff } from "./diff"
import { digest, saveSnapshot, writeReceipt } from "./review-state"
import { findCommitsAfter, findLastReviewedCommit, isCompletedReview, orderCommits, type Commit } from "./reviews"

export async function fetchReviewDiff(args: RepositoryPR & {
  format?: "raw" | "parsed"; file_patterns?: string[]; incremental?: boolean
}, sessionID: string) {
  const api = new GiteaClient()
  const path = prPath(args)
  const before = await api.json<PullRequest>(path)
  requireOpen(before)
  let previous: string | null = null
  let unchanged: Review | undefined
  let userId: number | undefined
  let commits: Commit[] = []
  if (args.incremental) {
    const user = await api.json<{ id: number }>("/user")
    userId = user.id
    // Gitea and Forgejo versions disagree on the default commit order.
    for (let attempt = 0; attempt < 5; attempt++) {
      commits = await api.list<Commit>(`${path}/commits`)
      if (commits.some(commit => commit.sha === before.head.sha)) break
      if (attempt < 4) await Bun.sleep(300)
    }
    commits = orderCommits(commits, before.head.sha)
    const reviews = await api.list<Review>(`${path}/reviews`)
    previous = findLastReviewedCommit(reviews, commits, user.id, before.base.sha)
    if (previous === before.head.sha) {
      unchanged = reviews.find(r => isCompletedReview(r, user.id, { head: previous!, base: before.base.sha, scope: "all" }))
    }
  }

  const fullDiff = await api.text(`${path}.diff`)
  let files = parseDiff(fullDiff)
  let note = "Full PR review"
  if (previous && !unchanged) {
    try {
      const paths = new Set<string>()
      for (const commit of findCommitsAfter(commits, previous)) {
        const detail = await api.json<{ files?: { filename: string; previous_filename?: string }[] }>(
          `/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/git/commits/${commit.sha}?stat=false&verification=false&files=true`)
        if (!Array.isArray(detail.files)) throw new Error("Commit file list is unavailable")
        for (const file of detail.files) {
          paths.add(file.filename)
          if (file.previous_filename) paths.add(file.previous_filename)
        }
      }
      files = files.filter(file => paths.has(file.path))
      note = `Files changed since completed bot review ${previous}. Hunks use the original PR base/head line numbers.`
    } catch {
      // A full diff is safe; concatenating individual commit diffs is not.
      note = "Full PR review (incremental file list unavailable)"
    }
  }
  const patterns = args.file_patterns?.filter(Boolean) ?? []
  files = filterFilesByPatterns(files, patterns)
  const after = await api.json<PullRequest>(path)
  if (before.head.sha !== after.head.sha || before.base.sha !== after.base.sha) {
    throw new Error("PR_CHANGED: The pull request changed while fetching the diff. Start a new review run.")
  }
  requireOpen(after)
  await saveSnapshot(api.baseURL, args, {
    head: before.head.sha, base: before.base.sha,
    scope: patterns.length ? digest(JSON.stringify([...patterns].sort())) : "all",
    diff: fullDiff, reviewDiff: formatAsRawDiff(files),
  }, sessionID)

  if (unchanged) {
    const confirmed = await api.json<Review>(`${path}/reviews/${unchanged.id}`)
    if (!isCompletedReview(confirmed, userId!, { head: before.head.sha, base: before.base.sha, scope: "all" })) {
      throw new Error("REVIEW_NOT_CONFIRMED: Previous review is no longer valid")
    }
    const latest = await api.json<PullRequest>(path)
    requireOpen(latest)
    if (latest.head.sha !== before.head.sha || latest.base.sha !== before.base.sha) {
      throw new Error("PR_CHANGED: The PR changed while confirming the previous review. Start a new run.")
    }
    await writeReceipt({ status: "unchanged", head: before.head.sha, reviewId: confirmed.id,
      url: `${api.baseURL}/${args.owner}/${args.repo}/pulls/${args.pull_number}#pullreview-${confirmed.id}` })
    return `No New Changes: ${before.head.sha} already has a confirmed bot review. No new review needed.`
  }
  if (args.format === "raw") return patterns.length || previous ? formatAsRawDiff(files) : fullDiff
  const summary = files.map(file => `- ${file.path} (${file.status})`).join("\n")
  return `# PR #${args.pull_number} Diff\n\nHead: ${before.head.sha}\nBase: ${before.base.sha}\n${note}\n\n${summary}\n\n${formatDiffForReview(files)}`
}
