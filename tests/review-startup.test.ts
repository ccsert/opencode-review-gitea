import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
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
  runStatus?: number
  receipt?: boolean
  cwd?: string
  env?: Record<string, string | undefined>
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "review-startup-"))
  temporaryDirectories.push(directory)
  const calls = join(directory, "calls.jsonl")
  writeFileSync(join(directory, "opencode"), `#!/usr/bin/env bun
import { appendFileSync, writeFileSync } from "node:fs"
const args = process.argv.slice(2)
appendFileSync(process.env.TEST_CALLS, JSON.stringify({ args, config: process.env.OPENCODE_CONFIG_DIR, cwd:process.cwd(), disableProjectConfig:process.env.OPENCODE_DISABLE_PROJECT_CONFIG,modelsFetch:process.env.OPENCODE_DISABLE_MODELS_FETCH,mode:process.env.OPENCODE_REVIEW_MODE,output:process.env.REVIEW_OUTPUT_DIR }) + "\\n")
if (args[0] === "run") {
  if (process.env.TEST_WRITE_RECEIPT === "true" && process.env.OPENCODE_REVIEW_RECEIPT_PATH) {
    const target = JSON.parse(process.env.TEST_RECEIPT_TARGET || process.env.OPENCODE_REVIEW_TARGET || JSON.stringify({server:process.env.GITEA_SERVER_URL,owner:process.env.REPO_OWNER,repo:process.env.REPO_NAME,pull_number:Number(process.env.PR_NUMBER)}))
    writeFileSync(process.env.OPENCODE_REVIEW_RECEIPT_PATH, JSON.stringify({
      ...(process.env.TEST_LEGACY_RECEIPT === "true" ? {} : {target}),status:process.env.TEST_RECEIPT_STATUS || "submitted",head:"test-head",reviewId:1,
      ...(process.env.TEST_DRAFT_RECEIPT === "true" ? {mode:"draft",artifacts:{json:"/out/review.json",markdown:"/out/review.md"}} : {}),
      url:process.env.TEST_RECEIPT_URL || target.server + "/" + target.owner + "/" + target.repo + "/pulls/" + target.pull_number + (process.env.TEST_DRAFT_RECEIPT === "true" ? "/files" : "#pullreview-1")}))
  }
  if (process.env.TEST_STALL === "true") await new Promise(() => setInterval(() => {}, 1000))
  process.exit(Number(process.env.TEST_RUN_STATUS))
}
`, { mode: 0o755 })
  // Avoid host architecture checks adding unrelated --version calls.
  writeFileSync(join(directory, "uname"), "#!/bin/sh\necho x86_64\n", { mode: 0o755 })

  const result = spawnSync("bash", script, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    timeout: 15_000,
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
      TEST_RUN_STATUS: String(options.runStatus ?? 0),
      TEST_WRITE_RECEIPT: String(options.receipt ?? true),
      OPENCODE_REVIEW_STATE_DIR: directory,
      REVIEW_OUTPUT_DIR: options.env?.REVIEW_MODE === "draft" ? directory : undefined,
      ...options.env,
    },
  })
  const invocations = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map(line => JSON.parse(line)) : []
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

test("invalid mounted rules fail before starting the model or creating a draft", () => {
  const missing = join(mkdtempSync(join(tmpdir(), "missing-rules-")), "not-there.md")
  temporaryDirectories.push(join(missing, ".."))
  const result = runReview([join(root, "entrypoint.sh"), "review"], { refresh: "false", env: {
    REVIEW_RULES_FILE: missing, REVIEW_MODE: "draft", DRAFT_WAIT_TIMEOUT_SECONDS: "0",
  } })
  expect(result.status).toBe(1)
  expect(result.invocations).toEqual([])
  expect(result.stdout + result.stderr).toContain("RULES_UNAVAILABLE")
  expect(result.stdout + result.stderr).not.toContain(missing)
})

test("Docker launcher ignores untrusted workspace dotenv configuration", () => {
  const workspace = mkdtempSync(join(tmpdir(), "review-dotenv-"))
  temporaryDirectories.push(workspace)
  writeFileSync(join(workspace, ".env"), "REVIEW_RULES_FILE=/workspace/attacker.md\nREVIEW_RULES=none\n")
  const result = runReview([join(root, "entrypoint.sh"), "review"], { cwd: workspace, refresh: "false", env: {
    OPENCODE_REVIEW_WORKSPACE: workspace,
  } })
  expect(result.status).toBe(0)
  expect(result.invocations.map(call => call.args[0])).toEqual(["run"])
})

for (const { name, script } of scripts) {
  describe(name, () => {
    test("runs the review on a private OpenCode server with the configured directory", () => {
      const result = runReview(script)
      expect(result.status).toBe(0)
      expect(result.invocations.map(call => call.args[0])).toEqual(["run"])
      expect(result.invocations[0].config).toBe(result.directory)
      expect(result.invocations[0].args).toContain("--standalone")
      expect(result.invocations[0].args).toContain("code-review")
      expect(result.invocations[0].args.at(-1)).toContain("PR #42")
      expect(result.invocations[0].modelsFetch).toBeUndefined()
    })

    test("disables fetching the model catalog for offline or custom provider setups", () => {
      const result = runReview(script, { refresh: "false" })
      expect(result.status).toBe(0)
      expect(result.invocations[0].modelsFetch).toBe("true")
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

test("Docker preserves a custom prompt", () => {
  const prompt = "Review PR #17 with spaces and 'quotes'."
  const result = runReview([join(root, "entrypoint.sh"), "review", prompt])
  expect(result.status).toBe(0)
  expect(result.invocations.at(-1).args).toEqual(["run", "--standalone", "--agent", "code-review", prompt])
})

test("Docker reports the MODEL environment setting without claiming it was selected", () => {
  const result = runReview([join(root, "entrypoint.sh"), "review"], { env: {
    MODEL: undefined,
    OPENAI_BASE_URL: undefined,
    DEEPSEEK_API_KEY: undefined,
    ANTHROPIC_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    LLM_API_KEY: undefined,
    OPENROUTER_API_KEY: undefined,
    REVIEW_GATEWAY_KEY: "never-print-this-fixture",
  } })
  expect(result.status).toBe(0)
  expect(result.stdout).toContain("MODEL env default: deepseek/deepseek-chat")
  expect(result.stdout).toContain("OpenCode config can select a different model")
  expect(result.stdout).toContain("custom or local providers load their own settings")
  expect(result.stdout + result.stderr).not.toContain("No LLM API key detected")
  expect(result.stdout + result.stderr).not.toContain("never-print-this-fixture")
})

test("a stalled OpenCode run times out without rerunning or treating a receipt as success", () => {
  const result = runReview([join(root, "entrypoint.sh"), "review"], { refresh: "false", env: {
    REVIEW_MODE: "draft", TEST_DRAFT_RECEIPT: "true", TEST_RECEIPT_STATUS: "draft_saved",
    REVIEW_RUN_TIMEOUT_SECONDS: "1", TEST_STALL: "true",
  } })
  expect(result.status).toBe(124)
  expect(result.invocations.map(call => call.args[0])).toEqual(["run"])
  expect(result.stderr).toContain("REVIEW_RUN_TIMEOUT")
  expect(result.stderr).toContain("may already have written a review")
  expect(result.stdout).not.toContain("Verified draft")
  expect(existsSync(result.invocations[0].cwd)).toBe(false)
})

test("invalid runner timeout fails without starting the review", () => {
  const result = runReview([join(root, "entrypoint.sh"), "review"], { refresh: "false", env: {
    REVIEW_RUN_TIMEOUT_SECONDS: "0",
  } })
  expect(result.status).toBe(1)
  expect(result.invocations).toEqual([])
  expect(result.stderr).toContain("INVALID_REVIEW_RUN_TIMEOUT")
})

test("Docker version only asks OpenCode for its version", () => {
  const result = runReview([join(root, "entrypoint.sh"), "version"])
  expect(result.status).toBe(0)
  expect(result.invocations.map(call => call.args)).toEqual([["--version"]])
})

test("Docker draft mode freezes delivery and can explicitly save without waiting", () => {
  const result = runReview([join(root, "entrypoint.sh"), "review"], { env: {
    REVIEW_MODE: "draft", TEST_DRAFT_RECEIPT: "true", TEST_RECEIPT_STATUS: "draft_saved", DRAFT_WAIT_TIMEOUT_SECONDS: "0",
  } })
  expect(result.status).toBe(0)
  expect(result.invocations.at(-1).mode).toBe("draft")
  expect(result.invocations.at(-1).output).toBe(result.directory)
  expect(result.invocations.at(-1).args.at(-1)).toContain("Delivery mode: draft")
  expect(result.stdout).toContain("Verified draft:")
  expect(result.stdout).toContain("Draft saved without waiting")
})
test("invalid draft wait configuration fails before starting the model", () => {
  const result = runReview([join(root, "entrypoint.sh"), "review"], { env: { REVIEW_MODE: "draft", DRAFT_WAIT_TIMEOUT_SECONDS: "-1" } })
  expect(result.status).toBe(1)
  expect(result.invocations.some(call => call.args[0] === "run")).toBe(false)
})
test("the default draft handoff requires persisted state instead of trusting a receipt alone", () => {
  const result = runReview([join(root, "entrypoint.sh"), "review"], { env: {
    REVIEW_MODE: "draft", TEST_DRAFT_RECEIPT: "true", TEST_RECEIPT_STATUS: "draft_saved",
  } })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain("DRAFT_STATE_REQUIRED")
})
test("a published receipt cannot certify draft mode", () => {
  const result = runReview([join(root, "entrypoint.sh"), "review"], { env: { REVIEW_MODE: "draft" } })
  expect(result.status).toBe(1)
  expect(result.stdout + result.stderr).toContain("REVIEW_NOT_CONFIRMED")
})
test("a draft receipt cannot certify submit mode", () => {
  const result = runReview([join(root, "entrypoint.sh"), "review"], { env: {
    TEST_DRAFT_RECEIPT: "true", TEST_RECEIPT_STATUS: "draft_saved",
  } })
  expect(result.status).toBe(1)
})
test("invalid delivery mode does not start the model", () => {
  const result = runReview([join(root, "entrypoint.sh"), "review"], { env: { REVIEW_MODE: "invalid" } })
  expect(result.status).toBe(1)
  expect(result.invocations.some(call => call.args[0] === "run")).toBe(false)
})

describe("review receipt target", () => {
  const target = { server: "https://gitea.example.com", owner: "owner", repo: "repo", pull_number: 42 }
  for (const [field, value] of [["server", "https://other.example.com"], ["owner", "other"], ["repo", "other"], ["pull_number", 99]] as const) {
    test(`rejects a successful receipt for another ${field}`, () => {
      const result = runReview([join(root, "entrypoint.sh"), "review"], {
        env: { TEST_RECEIPT_TARGET: JSON.stringify({ ...target, [field]: value }) },
      })
      expect(result.status).toBe(1)
      expect(result.stdout + result.stderr).toContain("REVIEW_TARGET_MISMATCH")
    })
  }
  test("rejects a legacy receipt without a target", () => {
    const result = runReview([join(root, "entrypoint.sh"), "review"], { env: { TEST_LEGACY_RECEIPT: "true" } })
    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toContain("REVIEW_TARGET_MISMATCH")
  })
  test("rejects a receipt URL that does not identify the verified review", () => {
    const result = runReview([join(root, "entrypoint.sh"), "review"], { env: { TEST_RECEIPT_URL: "https://gitea.example.com/other/repo/pulls/99" } })
    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toContain("REVIEW_TARGET_MISMATCH")
  })
  test("requires a fixed target before starting the model", () => {
    const result = runReview(scripts[1].script, { env: { PR_NUMBER: undefined } })
    expect(result.status).toBe(1)
    expect(result.invocations.some(call => call.args[0] === "run")).toBe(false)
    expect(result.stdout + result.stderr).toContain("REVIEW_TARGET_REQUIRED")
  })
  test("the model runs outside PR files with automatic project config disabled", () => {
    const result = runReview([join(root, "entrypoint.sh"), "review"], { env: { OPENCODE_DISABLE_PROJECT_CONFIG: "false" } })
    expect(result.status).toBe(0)
    const call = result.invocations.find(call => call.args[0] === "run")
    expect(call.cwd).not.toBe(root)
    expect(call.cwd).toContain("opencode-review-run-")
    expect(call.disableProjectConfig).toBe("true")
    expect(existsSync(call.cwd)).toBe(false)
  })
})

describe("workspace configuration", () => {
  function workspace() {
    const directory = mkdtempSync(join(tmpdir(), "review-workspace-"))
    temporaryDirectories.push(directory)
    mkdirSync(join(directory, ".opencode-review", "plugins", "added-by-pr"), { recursive: true })
    writeFileSync(join(directory, ".opencode-review", "plugins", "added-by-pr", "index.ts"), "throw new Error('PR code ran')\n")
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
