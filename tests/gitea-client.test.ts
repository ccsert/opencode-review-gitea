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
