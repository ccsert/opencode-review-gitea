import { GiteaClient, prPath, pullRefHead, requireOpen, type PullRequest, type RepositoryPR, type Review } from "./gitea"
import { filterFilesByPatterns, formatAsRawDiff, paginate, parseDiff, rawStream, reviewStream } from "./diff"
import { digest, markPageRead, saveSnapshot, writeReceipt } from "./review-state"
import { formatReviewContext, loadReviewContext } from "./review-context"
import { findCommitsAfter, findLastReviewedCommit, isCompletedReview, orderCommits, type Commit } from "./reviews"
import { confirmReviewContent } from "./review-confirmation"

export async function fetchReviewDiff(args: RepositoryPR & {
  format?: "raw" | "parsed"; file_patterns?: string[]; incremental?: boolean; page?: number
}, sessionID: string) {
  const api = new GiteaClient()
  const path = prPath(args)
  const before = await api.json<PullRequest>(path)
  requireOpen(before)
  // Gitea/Forgejo download .diff from refs/pull/N/head, which can lag the PR
  // metadata after a push. Checking only PR.head.sha can certify an old diff.
  for (let attempt = 0; await pullRefHead(api, args) !== before.head.sha; attempt++) {
    const latest = await api.json<PullRequest>(path)
    requireOpen(latest)
    if (latest.head.sha !== before.head.sha || latest.base.sha !== before.base.sha) {
      throw new Error("PR_CHANGED: The PR changed while waiting for its Git ref. Start a new review run.")
    }
    if (attempt >= 9) throw new Error("PR_DIFF_NOT_READY: The Git pull ref has not caught up with the PR head. Retry in a new run.")
    await Bun.sleep(100)
  }
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
    let reviews = await api.list<Review>(`${path}/reviews`)
    while ((previous = findLastReviewedCommit(reviews, commits, user.id, before.base.sha))) {
      const candidate = reviews.find(r => isCompletedReview(r, user.id, { head: previous!, base: before.base.sha, scope: "all" }))!
      try {
        const confirmed = await confirmReviewContent(api, path, candidate, user.id, { head: previous, base: before.base.sha, scope: "all" })
        if (previous === before.head.sha) unchanged = confirmed
        break
      } catch {
        // An accepted POST is not a completed baseline until its actual content
        // can be read back. Try an older review, or safely review the full PR.
        reviews = reviews.filter(review => review.id !== candidate.id)
      }
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
  // Standards follow the base commit, so they are covered by the base check below.
  const context = unchanged ? [] : formatReviewContext(await loadReviewContext(api, args, before.base.sha, files.map(file => file.path)), before.base.sha)
  const after = await api.json<PullRequest>(path)
  if (before.head.sha !== after.head.sha || before.base.sha !== after.base.sha || await pullRefHead(api, args) !== before.head.sha) {
    throw new Error("PR_CHANGED: The pull request changed while fetching the diff. Start a new review run.")
  }
  requireOpen(after)
  const reviewDiff = formatAsRawDiff(files)
  const body = args.format === "raw"
    ? rawStream(patterns.length || previous ? reviewDiff : fullDiff)
    : [...files.map(file => ({ text: `- ${file.path} (${file.status})` })), ...reviewStream(files)]
  const pages = paginate([...context.map(text => ({ text })), ...body], pageLimits())
  await saveSnapshot(api.baseURL, args, {
    head: before.head.sha, base: before.base.sha,
    scope: patterns.length ? digest(JSON.stringify([...patterns].sort())) : "all",
    diff: fullDiff, reviewDiff, pages: unchanged ? 0 : pages.length, context: digest(context.join("\n")),
  }, sessionID)

  if (unchanged) {
    const confirmed = await confirmReviewContent(api, path, unchanged, userId!, { head: before.head.sha, base: before.base.sha, scope: "all" })
    const latest = await api.json<PullRequest>(path)
    requireOpen(latest)
    if (latest.head.sha !== before.head.sha || latest.base.sha !== before.base.sha || await pullRefHead(api, args) !== before.head.sha) {
      throw new Error("PR_CHANGED: The PR changed while confirming the previous review. Start a new run.")
    }
    await writeReceipt({ status: "unchanged", head: before.head.sha, reviewId: confirmed.id,
      url: `${api.baseURL}/${args.owner}/${args.repo}/pulls/${args.pull_number}#pullreview-${confirmed.id}` })
    return `No New Changes: ${before.head.sha} already has a confirmed bot review. No new review needed.`
  }
  const page = args.page ?? 1
  if (!Number.isInteger(page) || page < 1 || page > pages.length) {
    throw new Error(`PAGE_OUT_OF_RANGE: page must be between 1 and ${pages.length}`)
  }
  await markPageRead(api.baseURL, args, page, sessionID)
  const tool = args.incremental ? "gitea-incremental-diff" : "gitea-pr-diff"
  const header = [`# PR #${args.pull_number} Diff (page ${page}/${pages.length})`, "",
    `Head: ${before.head.sha}`, `Base: ${before.base.sha}`, note, ""]
  const footer = page < pages.length
    ? ["", `--- Page ${page}/${pages.length}. Call ${tool} again with the same arguments and page=${page + 1}. A review is refused until every page has been read. ---`]
    : []
  return [...header, ...pages[page - 1], ...footer].join("\n")
}

function pageLimits() {
  const bytes = Number(process.env.REVIEW_DIFF_PAGE_BYTES ?? 40000)
  if (!Number.isInteger(bytes) || bytes < 4000) throw new Error("REVIEW_DIFF_PAGE_BYTES must be an integer of at least 4000")
  // Leave room under OpenCode's 2000-line/50 KiB limit for the page header and footer.
  return { bytes, lines: 1500 }
}
