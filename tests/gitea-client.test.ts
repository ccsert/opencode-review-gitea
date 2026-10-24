import { expect, test } from "bun:test"
import { GiteaClient } from "../.opencode-review/lib/gitea"

test("production API client reads every review page", async () => {
  const oldUrl = process.env.GITEA_SERVER_URL
  const oldToken = process.env.GITEA_TOKEN
  const pages: number[] = []
  const server = Bun.serve({ port: 0, fetch(request) {
    const page = Number(new URL(request.url).searchParams.get("page"))
    pages.push(page)
    return Response.json(page === 1 ? Array.from({ length: 50 }, (_, id) => ({ id })) : [{ id: 50 }],
      { headers: { "x-total-count": "51" } })
  } })
  try {
    process.env.GITEA_SERVER_URL = `${server.url.origin}/api/v1/`
    process.env.GITEA_TOKEN = "test-token"
    const values = await new GiteaClient().list<{ id: number }>("/reviews")
    expect(values).toHaveLength(51)
    expect(pages).toEqual([1, 2])
    expect(values.at(-1)?.id).toBe(50)
  } finally {
    server.stop(true)
    if (oldUrl === undefined) delete process.env.GITEA_SERVER_URL; else process.env.GITEA_SERVER_URL = oldUrl
    if (oldToken === undefined) delete process.env.GITEA_TOKEN; else process.env.GITEA_TOKEN = oldToken
  }
})

test("a caller cancellation signal does not disable the API request timeout", async () => {
  const previous = { ...process.env }
  const server = Bun.serve({ port: 0, async fetch() { await Bun.sleep(1000); return Response.json([]) } })
  try {
    process.env.GITEA_SERVER_URL = server.url.origin
    process.env.GITEA_TOKEN = "test-token"
    process.env.GITEA_API_TIMEOUT_MS = "20"
    delete process.env.OPENCODE_REVIEW_TARGET
    const request = new GiteaClient().list("/reviews", { signal: new AbortController().signal })
    await expect(Promise.race([request, Bun.sleep(250).then(() => { throw new Error("Timeout was disabled") })]))
      .rejects.toThrow(/timeout|timed out/i)
  } finally {
    server.stop(true)
    for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name]
    Object.assign(process.env, previous)
  }
})
