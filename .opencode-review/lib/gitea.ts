export class GiteaError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}
export class PRChangedError extends Error {
  constructor(detail: string) { super(`PR_CHANGED: ${detail}`) }
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
    this.baseURL = url.replace(/\/+$/, "").replace(/\/api\/v1$/, "")
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
export const prPath = ({ owner, repo, pull_number }: RepositoryPR) =>
  `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pull_number}`

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
