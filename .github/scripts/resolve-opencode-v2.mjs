import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

export const MINIMUM_V2 = "2.3.2"
const stableV2 = /^2\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/
function compare(a, b) {
  const left = a.split(".").map(BigInt), right = b.split(".").map(BigInt)
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1
  }
  return 0
}

export function resolveVersion(input) {
  const candidates = (Array.isArray(input) ? input : [input])
    .filter(version => typeof version === "string" && stableV2.test(version) && compare(version, MINIMUM_V2) >= 0)
    .sort(compare)
  if (!candidates.length) throw new Error(`No stable OpenCode 2.x release at or above ${MINIMUM_V2} was returned by npm`)
  return candidates.at(-1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${resolveVersion(JSON.parse(readFileSync(0, "utf8")))}\n`)
}
