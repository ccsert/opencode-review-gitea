import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { api, labs, type Lab } from "./lab"

// Opt-in local acceptance lab. Unlike model-smoke.ts, every review here must
// originate from a real PR/comment event and use an explicitly selected model.
const directory = join(import.meta.dir, ".local")
const image = process.env.REVIEW_TEST_IMAGE || "opencode-review-reliability:local"
const owner = "review-lab-admin"
const model = process.env.REVIEW_LAB_MODEL
if (!model?.includes("/")) throw new Error("Set REVIEW_LAB_MODEL=provider/model to select a real configured model")
const providerName = model.split("/")[0]
const config = JSON.parse(await readFile(process.env.REVIEW_LAB_CONFIG || join(homedir(), ".config/opencode/opencode.json"), "utf8"))
const provider = config.provider?.[providerName]
if (!provider) throw new Error(`Provider ${providerName} is not present in the selected local config`)
const modelConfig = JSON.stringify({ provider: { [providerName]: provider } })

async function command(args: string[]) {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  if (code) throw new Error(`${args[0]} failed (${code}): ${err.slice(-1500)}`)
  return out.trim()
}

function workflow(lab: Lab) {
  // Only local network/provider settings differ from the Docker workflow.
  // A single dedicated runner serializes PRs on the older Gitea release.
  return `name: OpenCode · 真实模型场景审查
on:
  pull_request:
    types: [opened, synchronize]
  issue_comment:
    types: [created]
jobs:
  review:
    if: github.event_name == 'pull_request' || startsWith(github.event.comment.body, '/oc')
    runs-on: review-lab
    timeout-minutes: 10
    container:
      image: ${image}
    env:
      GITEA_TOKEN: \${{ secrets.OPENCODE_GIT_TOKEN }}
      GITEA_SERVER_URL: http://${lab.name}:3000
      PR_NUMBER: \${{ github.event.issue.number || github.event.pull_request.number }}
      REPO_OWNER: \${{ github.repository_owner }}
      REPO_NAME: \${{ github.event.repository.name }}
      LAB_EVENT: \${{ github.event_name }}
      LAB_COMMENT_ID: \${{ github.event.comment.id }}
      LAB_RUN_NUMBER: \${{ github.run_number }}
      LAB_RUN_URL: ${lab.url}/\${{ github.repository }}/actions/runs/\${{ github.run_number }}/jobs/0
    steps:
      - name: 记录触发来源
        env:
          EVENT: \${{ github.event_name }}
          RUN_ID: \${{ github.run_id }}
          SHA: \${{ github.sha }}
          ACTOR: \${{ github.actor }}
        run: |
          echo "event=$EVENT run=$RUN_ID sha=$SHA actor=$ACTOR"
          echo 'model=${model}; real inference, no protocol fixture'
      - name: Checkout repository
        uses: https://github.com/actions/checkout@v4
        with:
          github-server-url: http://${lab.name}:3000
          persist-credentials: false
      - name: 捕获本次验收的 PR 版本
        run: bun .gitea/audit.ts capture
      - name: 真实模型审查并确认评论
        env:
          GITEA_TOKEN: \${{ secrets.OPENCODE_GIT_TOKEN }}
          PROVIDER_CONFIG: \${{ secrets.REVIEW_LAB_PROVIDER_CONFIG }}
          GITEA_SERVER_URL: http://${lab.name}:3000
          MODEL: ${model}
          REVIEW_LANGUAGE: zh-CN
          REVIEW_STYLE: balanced
          OPENCODE_REFRESH_MODELS: 'false'
          PR_NUMBER: \${{ github.event.issue.number || github.event.pull_request.number }}
          REPO_OWNER: \${{ github.repository_owner }}
          REPO_NAME: \${{ github.event.repository.name }}
        run: |
          umask 077
          printf '%s' "$PROVIDER_CONFIG" > /tmp/review-lab-provider.json
          export OPENCODE_CONFIG=/tmp/review-lab-provider.json
          trap 'rm -f /tmp/review-lab-provider.json' EXIT
          /entrypoint.sh review "请审查 $REPO_OWNER/$REPO_NAME 的 PR #$PR_NUMBER。先调用 gitea-incremental-diff；若已确认无新变更则结束且不要重复发布。否则只基于实际 diff 判断问题并调用 gitea-review 提交。使用简体中文，写清触发条件、实际影响和修复建议，简单修复提供 suggestion。不必填满分类；没有问题可以 approve，不要编造问题。审查概述请原样使用本次 Actions 的完整运行链接 $LAB_RUN_URL（不要猜测或替换域名）和模型 ${model}，标明这是本地真实模型验收样例。"
      - name: 关联本次事件、运行与已确认 review
        run: bun .gitea/audit.ts success
`
}

const manifest = []
for (const lab of await labs()) {
  const repo = process.env.REVIEW_LAB_REPO || `review-showcase-${Date.now().toString(36)}`
  const path = `/repos/${owner}/${repo}`
  try {
    await api(lab, path)
  } catch (error) {
    if (!String(error).includes("404")) throw error
    await api(lab, "/user/repos", { name: repo, auto_init: true, default_branch: "main", private: true,
      description: "真实 PR 事件 → Actions runner → OpenCode → 真实模型 → review-bot；与早期协议桩样例分开。" })
  }
  await api(lab, path, { has_actions: true }, "PATCH")
  await api(lab, `${path}/collaborators/review-bot`, { permission: "write" }, "PUT")
  await api(lab, `${path}/actions/secrets/OPENCODE_GIT_TOKEN`, { data: lab.botToken }, "PUT")
  await api(lab, `${path}/actions/secrets/REVIEW_LAB_PROVIDER_CONFIG`, { data: modelConfig }, "PUT")
  const files = []
  for (const [file, content] of Object.entries({
    ".gitea/workflows/review.yaml": workflow(lab),
    ".gitea/audit.ts": await readFile(join(import.meta.dir, "actions-audit.ts"), "utf8"),
    "src/math.ts": "// 对任意数值列表求和；空数组返回 0。\nexport function sum(values: number[]): number {\n  let total = 0\n  for (const value of values) total += value\n  return total\n}\n",
    "docs/接入 说明.md": "# 本地接入\n\n先启动 Gitea，再配置审查机器人。\n",
    "README.md": "# 审查效果验收样例\n\n此仓库用于观察真实模型审查效果。PR 创建、push 和 `/oc` 评论会触发 Actions。\n模型判断具有不确定性；运行记录与最终 review 均保留供检查。\n",
  })) {
    let existing: { sha: string } | undefined
    try { existing = await api(lab, `${path}/contents/${encodeURI(file)}`) }
    catch (error) { if (!String(error).includes("404")) throw error }
    files.push({ operation: existing ? "update" : "create", path: file,
      content: Buffer.from(content).toString("base64"), ...(existing ? { sha: existing.sha } : {}) })
  }
  await api(lab, `${path}/contents`, { message: "Configure local Actions acceptance lab", files })

  const data = resolve(directory, `actions-${lab.name}-${repo}`)
  await mkdir(data, { recursive: true, mode: 0o700 })
  await writeFile(join(data, "config.yaml"), `log:\n  level: info\nrunner:\n  file: /data/.runner\n  capacity: 1\n  timeout: 10m\n  fetch_interval: 2s\n  labels:\n    - review-lab:docker://${image}\ncache:\n  enabled: false\ncontainer:\n  network: opencode-review-lab_default\n  privileged: false\n  docker_host: '-'\n  force_pull: false\n  valid_volumes: []\n`, { mode: 0o600 })
  const runnerImage = lab.name === "gitea" ? "gitea/act_runner:0.2.13" : "data.forgejo.org/forgejo/runner:13.0.0"
  const binary = lab.name === "gitea" ? "act_runner" : "forgejo-runner"
  const token = await api<{ token: string }>(lab, `${path}/actions/runners/registration-token`)
  // The registration token is passed only to the short-lived registration
  // container; the persistent daemon has just its scoped .runner identity.
  await command(["docker", "run", "--rm", "--user", "0:0", "--network", "opencode-review-lab_default", "--entrypoint", binary,
    "-v", `${data}:/data`, "-w", "/data", runnerImage, "--config", "/data/config.yaml", "register", "--no-interactive",
    "--instance", `http://${lab.name}:3000`, "--token", token.token,
    "--name", `review-showcase-${lab.name}`, "--labels", `review-lab:docker://${image}`])
  const container = `opencode-review-showcase-${lab.name}-${repo}`
  await command(["docker", "run", "-d", "--name", container, "--user", "0:0", "--network", "opencode-review-lab_default",
    "--label", "opencode-review.lab=actions", "--entrypoint", binary,
    "-v", `${data}:/data`, "-v", "/var/run/docker.sock:/var/run/docker.sock", "-w", "/data", runnerImage,
    "--config", "/data/config.yaml", "daemon"])
  manifest.push({ name: lab.name, url: lab.url, owner, repo, path, model, runner: container, scenarios: [] })
  await writeFile(join(directory, "actions-lab.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 })
  console.log(`${lab.name}: repository-scoped runner started; ${lab.url}/${owner}/${repo}/actions`)
}
await writeFile(join(directory, "actions-lab.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 })
