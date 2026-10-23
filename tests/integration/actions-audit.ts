// Copied into the local fixture repository, not the production tool directory.
// A unique run marker plus the server's native Actions status proves which
// event actually completed; an old green status on the same SHA is insufficient.
const env = process.env
const root = `${env.GITEA_SERVER_URL}/api/v1`
const path = `/repos/${env.REPO_OWNER}/${env.REPO_NAME}`
const pull = `${path}/pulls/${env.PR_NUMBER}`
async function request(endpoint: string, body?: unknown) {
  const response = await fetch(root + endpoint, { method: body ? "POST" : "GET",
    headers: { Authorization: `token ${env.GITEA_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Audit API ${response.status}: ${endpoint}`)
  return response.json() as Promise<any>
}
const file = "/tmp/review-lab-head.json"
const pr = await request(pull)
if (process.argv[2] === "capture") {
  await Bun.write(file, JSON.stringify({ head: pr.head.sha, base: pr.base.sha }))
} else if (process.argv[2] === "success") {
  const captured = await Bun.file(file).json()
  const refs = await request(`${path}/git/refs/pull/${env.PR_NUMBER}/head`)
  if (pr.head.sha !== captured.head || pr.base.sha !== captured.base ||
      refs.find((ref: any) => ref.ref === `refs/pull/${env.PR_NUMBER}/head`)?.object.sha !== captured.head) {
    throw new Error("PR changed during the Actions acceptance run")
  }
  const user = await request("/user")
  const reviews = await request(`${pull}/reviews?limit=100`)
  if (reviews.length >= 100) throw new Error("Audit review pagination limit exceeded")
  const completed = reviews.filter((review: any) => {
    const match = review.body.match(/<!-- opencode-review:v1 (.*?) -->/)
    if (!match || review.dismissed || review.user.id !== user.id || !["COMMENT", "APPROVED", "REQUEST_CHANGES"].includes(review.state)) return false
    const marker = JSON.parse(match[1])
    return marker.head === captured.head && marker.base === captured.base && marker.scope === "all" && review.commit_id === captured.head &&
      [marker.summaryDigest, marker.commentsDigest].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value))
  })
  if (completed.length !== 1) throw new Error("Expected exactly one completed review on the captured head")
  await request(`${path}/statuses/${captured.head}`, { state: "success", context: `review-lab/run-${env.LAB_RUN_NUMBER}`,
    target_url: env.LAB_RUN_URL, description: `event=${env.LAB_EVENT} comment=${env.LAB_COMMENT_ID || "none"} review=${completed[0].id}` })
  console.log(`Actions acceptance marker: run=${env.LAB_RUN_NUMBER} event=${env.LAB_EVENT} comment=${env.LAB_COMMENT_ID || "none"} review=${completed[0].id}`)
} else throw new Error("Use capture or success")
