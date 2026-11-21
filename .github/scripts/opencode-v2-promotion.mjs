import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { compareVersion, MINIMUM_V2, stableV2 } from "./resolve-opencode-v2.mjs"

export const ALIAS = "opencode-v2"
export const INDEX_MEDIA_TYPE = "application/vnd.oci.image.index.v1+json"
export const ANNOTATION = {
  version: "org.opencontainers.image.version",
  revision: "org.opencontainers.image.revision",
  run: "io.github.ccsert.opencode-review.run-number",
  id: "io.github.ccsert.opencode-review.run-id",
  attempt: "io.github.ccsert.opencode-review.run-attempt",
}
const childMediaTypes = new Set(["application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"])
const digestOf = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`
const DIGEST = /^sha256:[a-f0-9]{64}$/
const INTEGER = /^[1-9][0-9]*$/
const is = (pattern, value) => typeof value === "string" && pattern.test(value)

function validateMetadata(value) {
  if (!is(stableV2, value.version) || compareVersion(value.version, MINIMUM_V2) < 0 || !is(/^[a-f0-9]{40}$/, value.revision) ||
      !is(INTEGER, value.run) || !is(INTEGER, value.id) || !is(INTEGER, value.attempt)) {
    throw new Error("Missing or invalid OpenCode v2 promotion metadata; alias left unchanged")
  }
  return value
}

export function metadataFromEnv(env) {
  return validateMetadata({ version: env.OPENCODE_VERSION, revision: env.GITHUB_SHA,
    run: env.GITHUB_RUN_NUMBER, id: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT })
}

export function annotationsFor(metadata) {
  validateMetadata(metadata)
  return Object.fromEntries(Object.entries(ANNOTATION).map(([field, key]) => [key, metadata[field]]))
}

export function readMetadata(index) {
  return validateMetadata(Object.fromEntries(Object.entries(ANNOTATION).map(([field, key]) => [field, index.annotations?.[key]])))
}

export function decidePromotion(current, next) {
  validateMetadata(next)
  if (current === null) return "promote"
  validateMetadata(current)
  if ((current.run === next.run) !== (current.id === next.id)) {
    throw new Error("Release run number and run ID disagree; alias left unchanged")
  }
  if (current.run === next.run) {
    if (current.version !== next.version || current.revision !== next.revision) {
      throw new Error("This workflow run already promoted a different candidate; start a new run")
    }
    // Artifacts can be rebuilt on rerun. Never replace an already verified alias
    // for the same run just because it was attempted again.
    return "already-active"
  }
  if (BigInt(next.run) < BigInt(current.run) || compareVersion(next.version, current.version) < 0) {
    throw new Error(`Refusing rollback from run ${current.run} / OpenCode ${current.version} to run ${next.run} / OpenCode ${next.version}`)
  }
  return "promote"
}

// Read by authenticated OCI API instead of guessing from Buildx stderr. Only a
// definite MANIFEST_UNKNOWN for the alias permits first publication.
export async function readIndex(registry, repository, reference, token, fetcher = fetch) {
  const url = new URL(`/v2/${repository}/manifests/${encodeURIComponent(reference)}`, registry)
  const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { Accept: INDEX_MEDIA_TYPE, ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
  if (response.status === 404 && reference === ALIAS) {
    const body = await response.json().catch(() => null)
    if (Array.isArray(body?.errors) && body.errors.length > 0 && body.errors.every(error => error?.code === "MANIFEST_UNKNOWN")) return null
  }
  if (response.status !== 200) throw new Error(`Cannot verify ${reference}: registry HTTP ${response.status}; alias not advanced`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const digest = digestOf(bytes)
  if (response.headers.get("docker-content-digest") !== digest) {
    throw new Error(`Cannot verify ${reference}: missing or mismatched registry digest`)
  }
  let index
  try { index = JSON.parse(bytes.toString("utf8")) }
  catch { throw new Error(`Cannot verify ${reference}: invalid registry JSON`) }
  if (index?.schemaVersion !== 2 || index.mediaType !== INDEX_MEDIA_TYPE || !Array.isArray(index.manifests) || index.manifests.length !== 2 ||
      !["amd64", "arm64"].every(arch => index.manifests.filter(child => child?.platform?.os === "linux" && child.platform.architecture === arch && is(DIGEST, child.digest)).length === 1)) {
    throw new Error(`Cannot verify ${reference}: expected an OCI index with two tested Linux architectures`)
  }
  return { digest, index, metadata: readMetadata(index) }
}

export function assertCandidate(record, metadata, children) {
  if (!record || Object.keys(ANNOTATION).some(field => record.metadata[field] !== metadata[field]) ||
      (children && !["amd64", "arm64"].every(arch => record.index.manifests.find(child => child.platform.architecture === arch)?.digest === children[arch]))) {
    throw new Error("The registry did not return this run's tested image index")
  }
}

// Buildx can emit a Docker list (and drop index annotations) when both child
// manifests use Docker Schema 2. Set the parent format explicitly, without
// changing either tested descriptor's bytes, media type or digest.
export function makeIndex(resolved, metadata, children) {
  if (resolved?.schemaVersion !== 2 || !Array.isArray(resolved.manifests) || resolved.manifests.length !== 2) {
    throw new Error("Expected exactly two resolved image descriptors")
  }
  const manifests = ["amd64", "arm64"].map(arch => {
    const child = resolved.manifests.find(item => item?.platform?.architecture === arch)
    if (!child || child.platform.os !== "linux" || !childMediaTypes.has(child.mediaType) ||
        !is(DIGEST, child.digest) || child.digest !== children[arch] || !Number.isSafeInteger(child.size) || child.size < 1) {
      throw new Error(`Invalid tested Linux ${arch} image descriptor`)
    }
    return { mediaType: child.mediaType, digest: child.digest, size: child.size, platform: child.platform }
  })
  return { schemaVersion: 2, mediaType: INDEX_MEDIA_TYPE, manifests, annotations: annotationsFor(metadata) }
}

export async function stageIndex(registry, repository, token, metadata, children, resolved, fetcher = fetch) {
  const imageIndex = makeIndex(resolved, metadata, children)
  const reference = `${ALIAS}-${metadata.version}-${metadata.id}-${metadata.attempt}`
  const bytes = Buffer.from(JSON.stringify(imageIndex))
  const digest = digestOf(bytes)
  const url = new URL(`/v2/${repository}/manifests/${reference}`, registry)
  const response = await fetcher(url, { method: "PUT", body: bytes, redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { "Content-Type": INDEX_MEDIA_TYPE, Authorization: `Bearer ${token}` } })
  if (response.status !== 201 || response.headers.get("docker-content-digest") !== digest) {
    throw new Error(`Could not stage verified OpenCode v2 index: registry HTTP ${response.status}; alias not advanced`)
  }
  const stored = await readIndex(registry, repository, reference, token, fetcher)
  assertCandidate(stored, metadata, children)
  if (stored.digest !== digest) throw new Error("Staged image index digest changed; alias not advanced")
  return digest
}

async function registryToken(env, push) {
  if (!env.GHCR_USER || !env.GHCR_TOKEN) throw new Error("Authenticated registry readback is required")
  const endpoint = new URL("https://ghcr.io/token")
  endpoint.search = new URLSearchParams({ service: "ghcr.io", scope: `repository:ccsert/opencode-review:${push ? "pull,push" : "pull"}` }).toString()
  const response = await fetch(endpoint, { redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Basic ${Buffer.from(`${env.GHCR_USER}:${env.GHCR_TOKEN}`).toString("base64")}` } })
  if (!response.ok) throw new Error(`Registry authorization failed: HTTP ${response.status}`)
  const result = await response.json()
  if (typeof result?.token !== "string" || !result.token) throw new Error("Registry returned no pull token")
  return result.token
}

async function main([command, reference, amd64, arm64]) {
  const metadata = metadataFromEnv(process.env)
  const registry = "https://ghcr.io", repository = "ccsert/opencode-review"
  const token = await registryToken(process.env, command === "stage")
  const read = ref => readIndex(registry, repository, ref, token)
  if (command === "check") {
    const current = await read(ALIAS)
    console.log(decidePromotion(current?.metadata ?? null, metadata))
  } else if (command === "stage") {
    if (reference !== `${ALIAS}-${metadata.version}-${metadata.id}-${metadata.attempt}` ||
        !is(DIGEST, amd64) || !is(DIGEST, arm64)) throw new Error("Invalid candidate index reference")
    const resolved = JSON.parse(readFileSync(0, "utf8"))
    console.log(await stageIndex(registry, repository, token, metadata, { amd64, arm64 }, resolved))
  } else if (command === "confirm") {
    const current = await read(ALIAS)
    assertCandidate(current, metadata)
    if (current.digest !== reference) throw new Error("The v2 alias does not point to the verified index digest")
  } else throw new Error("Unknown v2 promotion command")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(process.argv.slice(2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
