import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
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
  receipt?: boolean
  env?: Record<string, string | undefined>
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "review-startup-"))
  temporaryDirectories.push(directory)
  const calls = join(directory, "calls.jsonl")
  writeFileSync(join(directory, "opencode"), `#!/usr/bin/env bun
import { appendFileSync, writeFileSync } from "node:fs"
const args = process.argv.slice(2)
appendFileSync(process.env.TEST_CALLS, JSON.stringify({ args, config: process.env.OPENCODE_CONFIG_DIR }) + "\\n")
if (args[0] === "models") process.exit(Number(process.env.TEST_REFRESH_STATUS))
if (args[0] === "run") {
  if (process.env.TEST_WRITE_RECEIPT === "true" && process.env.OPENCODE_REVIEW_RECEIPT_PATH) {
    writeFileSync(process.env.OPENCODE_REVIEW_RECEIPT_PATH, JSON.stringify({status:"submitted",head:"test-head",reviewId:1,url:"http://localhost/reviews/1"}))
  }
  process.exit(Number(process.env.TEST_RUN_STATUS))
}
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
      TEST_WRITE_RECEIPT: String(options.receipt ?? true),
      OPENCODE_REVIEW_STATE_DIR: directory,
      ...options.env,
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

    test("does not report success when OpenCode omits the review", () => {
      const result = runReview(script, { receipt: false })
      expect(result.status).toBe(1)
      expect(result.stdout + result.stderr).toContain("REVIEW_NOT_CONFIRMED")
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

describe("workspace configuration", () => {
  function workspace() {
    const directory = mkdtempSync(join(tmpdir(), "review-workspace-"))
    temporaryDirectories.push(directory)
    mkdirSync(join(directory, ".opencode-review", "tools"), { recursive: true })
    writeFileSync(join(directory, ".opencode-review", "tools", "added-by-pr.ts"), "throw new Error('PR code ran')\n")
    return directory
  }
  const entrypoint = [join(root, "entrypoint.sh"), "review"]

  test("ignores .opencode-review from the workspace by default", () => {
    const ws = workspace()
    const result = runReview(entrypoint, { env: { OPENCODE_CONFIG_DIR: undefined, OPENCODE_REVIEW_WORKSPACE: ws } })
    expect(result.status).toBe(0)
    expect(result.invocations.every(call => call.config === "/app/.opencode-review")).toBe(true)
    expect(result.stdout + result.stderr).toContain(`Ignoring ${ws}/.opencode-review`)
  })

  test("finds the Actions checkout through GITHUB_WORKSPACE and still ignores it", () => {
    const ws = workspace()
    const result = runReview(entrypoint, { env: { OPENCODE_CONFIG_DIR: undefined, GITHUB_WORKSPACE: ws } })
    expect(result.invocations.every(call => call.config === "/app/.opencode-review")).toBe(true)
    expect(result.stdout + result.stderr).toContain(`Ignoring ${ws}/.opencode-review`)
  })

  test("an explicit config directory inside the workspace needs the trust opt-in, even via a symlink", () => {
    const ws = workspace()
    const link = join(mkdtempSync(join(tmpdir(), "review-link-")), "config")
    temporaryDirectories.push(join(link, ".."))
    symlinkSync(join(ws, ".opencode-review"), link)
    for (const configDir of [join(ws, ".opencode-review"), link]) {
      const result = runReview(entrypoint, { env: { OPENCODE_CONFIG_DIR: configDir, OPENCODE_REVIEW_WORKSPACE: ws } })
      expect(result.invocations.every(call => call.config === "/app/.opencode-review")).toBe(true)
      expect(result.stdout + result.stderr).toContain("Ignoring OPENCODE_CONFIG_DIR")
    }
  })

  test("uses workspace configuration only when explicitly trusted", () => {
    const ws = workspace()
    const result = runReview(entrypoint, { env: { OPENCODE_CONFIG_DIR: undefined, OPENCODE_REVIEW_WORKSPACE: ws,
      OPENCODE_REVIEW_TRUST_WORKSPACE_CONFIG: "true" } })
    expect(result.status).toBe(0)
    expect(result.invocations.every(call => call.config === join(ws, ".opencode-review"))).toBe(true)
  })
})

describe("workflow templates keep PR code out of the review job", () => {
  type Steps = { jobs: { "opencode-review": { steps: { name: string; uses?: string; with?: Record<string, string> }[] } } }
  const steps = (path: string) => (Bun.YAML.parse(readFileSync(join(root, path), "utf8")) as Steps).jobs["opencode-review"].steps

  test("the Docker workflow does not check out the repository", () => {
    expect(steps("templates/workflow-docker.yaml").some(step => step.uses?.includes("actions/checkout"))).toBe(false)
  })

  test.each(["templates/workflow-source.yaml", ".gitea/workflows/opencode-review.yaml"])("%s checks out configuration from the base commit only", path => {
    const checkouts = steps(path).filter(step => step.uses?.includes("actions/checkout"))
    expect(checkouts).toHaveLength(1)
    expect(checkouts[0].with?.ref).toBe("${{ github.event.pull_request.base.sha || github.event.repository.default_branch }}")
    expect(checkouts[0].with?.["sparse-checkout"]).toBe(".opencode-review")
  })
})
