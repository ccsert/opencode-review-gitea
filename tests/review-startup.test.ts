import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const root = resolve(import.meta.dir, "..")
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function runReview(script: string[], options: {
  refresh?: string
  refreshStatus?: number
  runStatus?: number
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "review-startup-"))
  temporaryDirectories.push(directory)
  const calls = join(directory, "calls.jsonl")
  writeFileSync(join(directory, "opencode"), `#!/usr/bin/env bun
import { appendFileSync } from "node:fs"
const args = process.argv.slice(2)
appendFileSync(process.env.TEST_CALLS, JSON.stringify({ args, config: process.env.OPENCODE_CONFIG_DIR }) + "\\n")
if (args[0] === "models") process.exit(Number(process.env.TEST_REFRESH_STATUS))
if (args[0] === "run") process.exit(Number(process.env.TEST_RUN_STATUS))
`, { mode: 0o755 })
  // Avoid host architecture checks adding unrelated --version calls.
  writeFileSync(join(directory, "uname"), "#!/bin/sh\necho x86_64\n", { mode: 0o755 })

  const result = spawnSync("bash", script, {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: `${directory}:${process.env.PATH}`,
      OPENCODE_CONFIG_DIR: directory,
      ...(options.refresh === undefined ? {} : { OPENCODE_REFRESH_MODELS: options.refresh }),
      GITEA_TOKEN: "test-token",
      GITEA_SERVER_URL: "https://gitea.example.com",
      MODEL: "test/model",
      PR_NUMBER: "42",
      REPO_OWNER: "owner",
      REPO_NAME: "repo",
      TEST_CALLS: calls,
      TEST_REFRESH_STATUS: String(options.refreshStatus ?? 0),
      TEST_RUN_STATUS: String(options.runStatus ?? 0),
    },
  })
  const invocations = readFileSync(calls, "utf8").trim().split("\n").map(line => JSON.parse(line))
  return { ...result, invocations, directory }
}

type Workflow = { jobs: { "opencode-review": { steps: { name: string; run?: string }[] } } }
const scripts = [
  { name: "Docker entrypoint", script: [join(root, "entrypoint.sh"), "review"] },
  ...["templates/workflow-source.yaml", ".gitea/workflows/opencode-review.yaml"].map(path => {
    const workflow = Bun.YAML.parse(readFileSync(join(root, path), "utf8")) as Workflow
    const script = workflow.jobs["opencode-review"].steps.find(step => step.name === "Run code review")!.run!
    // Actions runs shell steps with errexit enabled.
    return { name: path, script: ["-e", "-c", script] }
  }),
]

for (const { name, script } of scripts) {
  describe(name, () => {
    test("refreshes models before review using the configured directory", () => {
      const result = runReview(script)
      expect(result.status).toBe(0)
      expect(result.invocations.map(call => call.args[0])).toEqual(["models", "run"])
      expect(result.invocations[0].args).toEqual(["models", "--refresh"])
      expect(result.invocations.every(call => call.config === result.directory)).toBe(true)
      expect(result.invocations[1].args).toContain("code-review")
      expect(result.invocations[1].args.at(-1)).toContain("PR #42")
    })

    test("warns and continues review when refreshing models fails", () => {
      const result = runReview(script, { refreshStatus: 7 })
      expect(result.status).toBe(0)
      expect(result.invocations.map(call => call.args[0])).toEqual(["models", "run"])
      expect(result.stdout + result.stderr).toContain("Failed to refresh models")
    })

    test("supports skipping refresh for offline or custom provider setups", () => {
      const result = runReview(script, { refresh: "false" })
      expect(result.status).toBe(0)
      expect(result.invocations.map(call => call.args[0])).toEqual(["run"])
    })

    test("preserves the review command failure status", () => {
      const result = runReview(script, { runStatus: 23 })
      expect(result.status).toBe(23)
    })
  })
}

test("Docker preserves a custom prompt after refreshing models", () => {
  const prompt = "Review PR #17 with spaces and 'quotes'."
  const result = runReview([join(root, "entrypoint.sh"), "review", prompt])
  expect(result.status).toBe(0)
  expect(result.invocations.at(-1).args).toEqual(["run", "--agent", "code-review", prompt])
})

test("Docker version does not refresh models", () => {
  const result = runReview([join(root, "entrypoint.sh"), "version"])
  expect(result.status).toBe(0)
  expect(result.invocations.map(call => call.args)).toEqual([["--version"]])
})
