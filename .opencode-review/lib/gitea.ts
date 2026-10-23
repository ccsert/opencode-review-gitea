export class GiteaError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}
export class PRChangedError extends Error {
  constructor(detail: string) { super(`PR_CHANGED: ${detail}`) }
}

export interface ReviewTarget extends RepositoryPR { server: string }
export const normalizeServerURL = (url: string) => url.replace(/\/+$/, "").replace(/\/api\/v1$/, "")

function validTarget(value: unknown): value is ReviewTarget {
  const target = value as ReviewTarget | undefined
  return Boolean(target && typeof target.server === "string" && target.server &&
    typeof target.owner === "string" && target.owner && typeof target.repo === "string" && target.repo &&
    Number.isSafeInteger(target.pull_number) && target.pull_number > 0)
}

export function configuredReviewTarget(required = false): ReviewTarget | undefined {
  const { REPO_OWNER: owner, REPO_NAME: repo, PR_NUMBER: number } = process.env
  if (!owner && !repo && !number && !required) return undefined
  const target = { owner, repo, pull_number: Number(number),
    server: normalizeServerURL(process.env.GITEA_SERVER_URL || process.env.GITHUB_SERVER_URL || "") }
  if (!validTarget(target)) throw new Error("REVIEW_TARGET_REQUIRED: Configure server, REPO_OWNER, REPO_NAME and a positive PR_NUMBER before reviewing")
  return target
}

function activeReviewTarget() {
  if (!process.env.OPENCODE_REVIEW_TARGET) return configuredReviewTarget(Boolean(process.env.OPENCODE_REVIEW_RUN_ID))
  let target: unknown
  try { target = JSON.parse(process.env.OPENCODE_REVIEW_TARGET) } catch { /* Reject malformed frozen targets. */ }
  if (!validTarget(target)) throw new Error("REVIEW_TARGET_REQUIRED: Invalid frozen review target")
  return target
}

export function matchesReviewTarget(actual: unknown, expected: ReviewTarget): actual is ReviewTarget {
  return validTarget(actual) && actual.server === expected.server && actual.owner === expected.owner &&
    actual.repo === expected.repo && actual.pull_number === expected.pull_number
}

export function requireReviewTarget(pr: RepositoryPR) {
  const target = activeReviewTarget()
  if (target && (target.owner !== pr.owner || target.repo !== pr.repo || target.pull_number !== pr.pull_number)) {
    throw new Error("REVIEW_TARGET_MISMATCH: Tool arguments do not match this run's fixed repository and PR")
  }
}

export function receiptTarget(server: string, pr: RepositoryPR): ReviewTarget {
  return { server, owner: pr.owner, repo: pr.repo, pull_number: pr.pull_number }
}

export function reviewURL(target: ReviewTarget, reviewId: number) {
  return `${target.server}/${target.owner}/${target.repo}/pulls/${target.pull_number}#pullreview-${reviewId}`
}

export function timeoutMs() {
  const value = Number(process.env.GITEA_API_TIMEOUT_MS ?? 30000)
  if (!Number.isInteger(value) || value < 1) throw new Error("GITEA_API_TIMEOUT_MS must be a positive integer")
  return value
}

export class GiteaClient {
  readonly baseURL: string
  private readonly token: string

  constructor() {
    const url = process.env.GITEA_SERVER_URL || process.env.GITHUB_SERVER_URL
    const token = process.env.GITEA_TOKEN || process.env.GITHUB_TOKEN
    if (!url) throw new Error("GITEA_SERVER_URL environment variable is required")
    if (!token) throw new Error("GITEA_TOKEN environment variable is required")
    this.baseURL = normalizeServerURL(url)
    const target = activeReviewTarget()
    if (target && target.server !== this.baseURL) throw new Error("REVIEW_TARGET_MISMATCH: API server does not match this run's fixed target")
    this.token = token
  }

  async request(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers)
    headers.set("Authorization", `token ${this.token}`)
    if (!headers.has("Accept")) headers.set("Accept", "application/json")
    if (options.body) headers.set("Content-Type", "application/json")
    // Never automatically retry a write: a lost response does not imply a failed write.
    const response = await fetch(`${this.baseURL}/api/v1${endpoint}`, {
      ...options, headers, signal: options.signal ?? AbortSignal.timeout(timeoutMs()),
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000)
      throw new GiteaError(`Gitea API ${response.status} for ${endpoint}: ${detail}`, response.status)
    }
    return response
  }

  async json<T>(endpoint: string, options?: RequestInit): Promise<T> {
    return (await this.request(endpoint, options)).json() as Promise<T>
  }

  async text(endpoint: string): Promise<string> {
    return (await this.request(endpoint, { headers: { Accept: "text/plain" } })).text()
  }

  // Fetch a document by URL; the token is sent only to this Gitea origin.
  async fetchURL(url: string): Promise<string> {
    const headers = new Headers({ Accept: "text/markdown, text/plain;q=0.9, */*;q=0.1" })
    if (new URL(url).origin === new URL(this.baseURL).origin) headers.set("Authorization", `token ${this.token}`)
    const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs()) })
    if (!response.ok) throw new GiteaError(`HTTP ${response.status} for ${url}`, response.status)
    return response.text()
  }

  async list<T>(endpoint: string): Promise<T[]> {
    const result: T[] = []
    for (let page = 1; page <= 1000; page++) {
      const response = await this.request(`${endpoint}${endpoint.includes("?") ? "&" : "?"}limit=50&page=${page}`)
      const rows = await response.json() as T[]
      if (!Array.isArray(rows)) throw new Error(`Expected a list from ${endpoint}`)
      result.push(...rows)
      const total = response.headers.get("x-total-count")
      if (!rows.length || (total !== null && result.length >= Number(total)) ||
          (!response.headers.get("link")?.includes('rel="next"') && rows.length < 50)) return result
    }
    throw new Error(`Pagination limit exceeded for ${endpoint}; refusing a partial result`)
  }
}

export interface PullRequest {
  head: { sha: string }
  base: { sha: string }
  state: string
  merged: boolean
}
export interface Review {
  id: number
  user: { id: number; login: string }
  body: string
  state: string
  commit_id: string
  html_url?: string
  dismissed?: boolean
  comments_count?: number
}
export interface RepositoryPR { owner: string; repo: string; pull_number: number }
export function prPath(pr: RepositoryPR) {
  requireReviewTarget(pr)
  return `/repos/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/pulls/${pr.pull_number}`
}

export async function pullRefHead(api: GiteaClient, args: RepositoryPR): Promise<string | undefined> {
  const path = prPath(args)
  const refs = await api.json<{ ref: string; object: { sha: string } }[]>(
    `${path.slice(0, path.lastIndexOf("/pulls/"))}/git/refs/pull/${args.pull_number}/head`)
  return refs.find(ref => ref.ref === `refs/pull/${args.pull_number}/head`)?.object.sha
}

export function requireOpen(pr: PullRequest) {
  if (pr.state !== "open" || pr.merged) throw new Error("PR_CLOSED: Only open, unmerged pull requests can be reviewed")
  if (!pr.head?.sha || !pr.base?.sha) throw new Error("PR response is missing head/base commit SHA")
}
