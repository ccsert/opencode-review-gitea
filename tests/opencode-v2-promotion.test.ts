import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { ALIAS, INDEX_MEDIA_TYPE, annotationsFor, assertCandidate, decidePromotion, makeIndex, metadataFromEnv, readIndex, stageIndex } from "../.github/scripts/opencode-v2-promotion.mjs"

const current = { version: "2.3.3", revision: "a".repeat(40), run: "20", id: "100", attempt: "1" }
const later = { ...current, run: "21", id: "101" }
const children = { amd64: `sha256:${"a".repeat(64)}`, arm64: `sha256:${"b".repeat(64)}` }
const index = {
  schemaVersion: 2, mediaType: INDEX_MEDIA_TYPE,
  manifests: Object.entries(children).map(([architecture, digest]) => ({ platform: { os: "linux", architecture }, digest })),
  annotations: annotationsFor(current),
}
const payload = (value: unknown, advertisedDigest?: string) => {
  const bytes = JSON.stringify(value)
  return new Response(bytes, { headers: { "Docker-Content-Digest": advertisedDigest ?? `sha256:${createHash("sha256").update(bytes).digest("hex")}` } })
}
const read = (response: Response, reference = ALIAS) => readIndex("http://localhost", "fixture", reference, "local-token", async () => response)

test("a first or newer run can advance an equal or newer stable version", () => {
  expect(decidePromotion(null, current)).toBe("promote")
  expect(decidePromotion(current, later)).toBe("promote")
  expect(decidePromotion(current, { ...later, version: "2.10.0" })).toBe("promote")
})

test("neither an older run with an upgraded version nor a newer run with a downgraded version may replace the alias", () => {
  expect(() => decidePromotion(current, { ...current, run: "19", id: "99", version: "2.3.4" })).toThrow("Refusing rollback")
  expect(() => decidePromotion(current, { ...later, version: "2.3.2" })).toThrow("Refusing rollback")
  expect(() => decidePromotion(current, { ...current, run: "19", id: "99" })).toThrow("Refusing rollback")
})

test("the same run can be repeated without touching the alias, not republished with new inputs", () => {
  expect(decidePromotion(current, current)).toBe("already-active")
  expect(decidePromotion(current, { ...current, attempt: "2" })).toBe("already-active")
  expect(() => decidePromotion(current, { ...current, version: "2.3.4" })).toThrow("start a new run")
  expect(() => decidePromotion(current, { ...current, revision: "b".repeat(40) })).toThrow("start a new run")
  expect(() => decidePromotion(current, { ...current, id: "99" })).toThrow("run number and run ID disagree")
  expect(() => metadataFromEnv({ OPENCODE_VERSION: "2.3.3" })).toThrow("promotion metadata")
})

test("only a definite missing alias allows bootstrap", async () => {
  const absent = () => Response.json({ errors: [{ code: "MANIFEST_UNKNOWN" }] }, { status: 404 })
  expect(await read(absent())).toBeNull()
  await expect(read(absent(), "opencode-v2-2.3.3-100-1")).rejects.toThrow("registry HTTP 404")
  await expect(read(Response.json({ errors: [{ code: "NAME_UNKNOWN" }] }, { status: 404 }))).rejects.toThrow("registry HTTP 404")
  for (const status of [401, 403, 429, 500]) {
    await expect(read(new Response(null, { status }))).rejects.toThrow(`registry HTTP ${status}`)
  }
  await expect(readIndex("http://localhost", "fixture", ALIAS, "local-token", async () => { throw new Error("network unreachable") })).rejects.toThrow("network unreachable")
})

test("readback validates the exact digest, metadata and both tested architecture descriptors", async () => {
  const result = await read(payload(index))
  expect(result?.metadata).toEqual(current)
  expect(() => assertCandidate(result, current, children)).not.toThrow()
  expect(() => assertCandidate(result, later, children)).toThrow("did not return this run's tested image index")
  expect(() => assertCandidate(result, current, { ...children, arm64: children.amd64 })).toThrow("did not return this run's tested image index")
  await expect(read(payload({ ...index, annotations: {} }))).rejects.toThrow("promotion metadata")
  await expect(read(payload({ ...index, manifests: index.manifests.slice(0, 1) }))).rejects.toThrow("two tested Linux architectures")
  await expect(read(payload(index, children.amd64))).rejects.toThrow("mismatched registry digest")
})

const dockerList = {
  schemaVersion: 2,
  mediaType: "application/vnd.docker.distribution.manifest.list.v2+json",
  manifests: index.manifests.map((child, size) => ({ ...child, size: 512 + size, mediaType: "application/vnd.docker.distribution.manifest.v2+json" })),
}

test("OCI staging preserves both tested Docker child descriptors and only writes the immutable v2 tag", async () => {
  let staged: string | undefined
  const indexDigest = await stageIndex("http://localhost", "fixture", "token", current, children, dockerList, async (url, init) => {
    expect(url.pathname).toBe("/v2/fixture/manifests/opencode-v2-2.3.3-100-1")
    expect(init.redirect).toBe("error")
    expect(init.headers.Authorization).toBe("Bearer token")
    if (init.method === "PUT") {
      expect(init.headers["Content-Type"]).toBe(INDEX_MEDIA_TYPE)
      staged = String(init.body)
      expect(JSON.parse(staged)).toEqual({ ...index, manifests: dockerList.manifests })
      const digest = `sha256:${createHash("sha256").update(staged).digest("hex")}`
      return new Response(null, { status: 201, headers: { "Docker-Content-Digest": digest } })
    }
    expect(staged).toBeDefined()
    return payload(JSON.parse(staged!))
  })
  expect(indexDigest).toBe(`sha256:${createHash("sha256").update(staged!).digest("hex")}`)
  expect(() => makeIndex(dockerList, current, { ...children, amd64: children.arm64 })).toThrow("Invalid tested Linux amd64")
  await expect(stageIndex("http://localhost", "fixture", "token", current, children, dockerList,
    async () => new Response(null, { status: 401 }))).rejects.toThrow("alias not advanced")
})
