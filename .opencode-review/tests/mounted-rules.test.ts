import { afterEach, beforeEach, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GiteaClient, GiteaError } from "../lib/gitea"
import { loadRules, parseSource } from "../lib/review-context"
import { MOUNTED_RULE_SOURCE, readMountedRules } from "../lib/mounted-rules"

let directory: string
let file: string
let saved: NodeJS.ProcessEnv
const pr = { owner: "o", repo: "r", pull_number: 1 }
const missingAPI = { json: async () => { throw new GiteaError("missing", 404) } } as unknown as GiteaClient
beforeEach(() => {
  saved = { ...process.env }
  for (const key of ["REVIEW_RULES", "REVIEW_RULES_FILE", "REVIEW_RULES_MAX_BYTES", "GITHUB_WORKSPACE", "OPENCODE_REVIEW_WORKSPACE"]) delete process.env[key]
  directory = mkdtempSync(join(tmpdir(), "mounted-rules-"))
  file = join(directory, "review 规范.md")
  writeFileSync(file, "# Trusted rules\nKeep the public API stable.\n")
  process.env.REVIEW_RULES_FILE = file
})
afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})

test("explicit local file reuses frontmatter/filtering and hides its path", async () => {
  writeFileSync(file, '\uFEFF---\ntitle: API 规范\npaths: ["src/**"]\n---\n保持兼容。\n')
  const applied = await loadRules(missingAPI, pr, "base", ["src/api.ts"])
  expect(applied.rules).toEqual([{ source: MOUNTED_RULE_SOURCE, title: "API 规范", paths: ["src/**"], body: "保持兼容。" }])
  expect(JSON.stringify(applied)).not.toContain(directory)
  expect(await loadRules(missingAPI, pr, "base", ["README.md"])).toEqual({ rules: [], skipped: [MOUNTED_RULE_SOURCE] })
})
test("mounted rules append to explicit repository rules and keep PR-base semantics", async () => {
  const requests: string[] = []
  process.env.REVIEW_RULES = "/docs/rules.md"
  const api = { json: async (path: string) => { requests.push(path); return { type: "file" } },
    text: async (path: string) => { requests.push(path); return "Base rule." } } as unknown as GiteaClient
  const result = await loadRules(api, pr, "trusted-base", ["app.ts"])
  expect(result.rules.map(rule => rule.source)).toEqual(["docs/rules.md", MOUNTED_RULE_SOURCE])
  expect(requests.every(path => path.endsWith("?ref=trusted-base"))).toBe(true)
  expect(parseSource(file)).toEqual({ kind: "local", path: file.replace(/^\/+/, "") })
  expect(() => parseSource(`file://${file}`)).toThrow("RULES_INVALID")
})
test("unset file leaves source selection unchanged; defaults still load alongside a mount", async () => {
  let defaults = 0
  const api = { json: async () => { defaults++; throw new GiteaError("missing", 404) } } as unknown as GiteaClient
  expect((await loadRules(api, pr, "base", [])).rules).toHaveLength(1)
  expect(defaults).toBe(4)
  delete process.env.REVIEW_RULES_FILE
  process.env.REVIEW_RULES = "none"
  expect(await readMountedRules()).toBeUndefined()
  expect((await loadRules(api, pr, "base", [])).rules).toEqual([])
})
test.each(["none", "false"])("rejects a mount combined with REVIEW_RULES=%s", async value => {
  process.env.REVIEW_RULES = value
  await expect(readMountedRules()).rejects.toThrow("cannot be combined")
})
test.each(["relative.md", "file:///rules.md", "https://example.com/rules.md", "/tmp/a.json"])("rejects unsupported file selector %s", async value => {
  process.env.REVIEW_RULES_FILE = value
  await expect(readMountedRules()).rejects.toThrow("RULES_INVALID")
})
test("missing required file fails with no private path or API fallback", async () => {
  process.env.REVIEW_RULES_FILE = join(directory, "missing.md")
  try { await loadRules({} as GiteaClient, pr, "base", []); throw new Error("expected failure") }
  catch (error) {
    expect(String(error)).toContain("RULES_UNAVAILABLE")
    expect(String(error)).toContain("ENOENT")
    expect(String(error)).not.toContain(directory)
  }
})
test("rejects directory, symbolic link and FIFO without waiting for a writer", async () => {
  const folder = join(directory, "directory.md"); mkdirSync(folder)
  const link = join(directory, "link.md"); symlinkSync(file, link)
  const fifo = join(directory, "pipe.md")
  expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0)
  for (const path of [folder, link, fifo]) {
    process.env.REVIEW_RULES_FILE = path
    await expect(readMountedRules()).rejects.toThrow("RULES_INVALID")
  }
})
test("unreadable required file fails without exposing the path", async () => {
  if (process.getuid?.() === 0) return // root can read mode 000; tested as the caller on non-root hosts.
  chmodSync(file, 0)
  try { await expect(readMountedRules()).rejects.toThrow("RULES_UNAVAILABLE") }
  finally { chmodSync(file, 0o600) }
})
test.each(["GITHUB_WORKSPACE", "OPENCODE_REVIEW_WORKSPACE"])("rejects %s and parent symlink aliases despite trust opt-in", async key => {
  process.env[key] = directory
  process.env.OPENCODE_REVIEW_TRUST_WORKSPACE_CONFIG = "true"
  await expect(readMountedRules()).rejects.toThrow("outside the PR workspace")
  const alias = join(directory, "alias"); symlinkSync(directory, alias)
  process.env.REVIEW_RULES_FILE = join(alias, "review 规范.md")
  await expect(readMountedRules()).rejects.toThrow("outside the PR workspace")
  process.env[key] = alias
  process.env.REVIEW_RULES_FILE = file
  await expect(readMountedRules()).rejects.toThrow("outside the PR workspace")
})
test("bounds raw mounted bytes even when frontmatter excludes the changed files", async () => {
  process.env.REVIEW_RULES_MAX_BYTES = "10"
  await expect(loadRules(missingAPI, pr, "base", [])).rejects.toThrow("RULES_TOO_LARGE")
  writeFileSync(file, "0123456789")
  expect(await readMountedRules()).toBe("0123456789")
  writeFileSync(file, "0123456789x")
  await expect(readMountedRules()).rejects.toThrow("RULES_TOO_LARGE")
})
test("combined applicable bytes retain the existing total cap", async () => {
  process.env.REVIEW_RULES_MAX_BYTES = "8"; process.env.REVIEW_RULES = "rules.md"
  writeFileSync(file, "local")
  const api = { json: async () => ({ type: "file" }), text: async () => "base" } as unknown as GiteaClient
  await expect(loadRules(api, pr, "base", [])).rejects.toThrow("RULES_TOO_LARGE")
})
test.each([Buffer.from([0xff, 0xfe]), Buffer.from("a\0b"), Buffer.from(" \n")])("rejects invalid UTF-8/binary/empty rules", async content => {
  writeFileSync(file, content)
  await expect(readMountedRules()).rejects.toThrow("RULES_INVALID")
})
