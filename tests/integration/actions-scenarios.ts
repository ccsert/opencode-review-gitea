import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { api, labs } from "./lab"
import { parseReviewMarker } from "../../.opencode-review/lib/review-state"
import { nativeRuns } from "./native-actions"

const manifestPath = join(import.meta.dir, ".local/actions-lab.json")
interface Scenario { name: string; branch: string; number: number; head: string; url: string; expectedStatus?: "success" | "failure" }
interface Entry { name: string; url: string; owner: string; repo: string; path: string; model: string; runner: string; scenarios: Scenario[];
  repeat?: { commentId: number; head: string; reviewIds: number[]; createdAt: string } }
const manifest: Entry[] = JSON.parse(await readFile(manifestPath, "utf8"))
const command = process.argv[2] || "status"
const broken: Record<string, string> = {
  "src/search.ts": `type Database = { query(sql: string, values?: unknown[]): Promise<unknown[]> }

export async function searchAccounts(db: Database, keyword: string) {
  return db.query(\`SELECT id, email FROM accounts WHERE email LIKE '%\u0024{keyword}%'\`)
}
`,
  "worker/report.py": `import subprocess


def build_report(customer_name: str) -> str:
    """Build a report for the customer name supplied by the web request."""
    return subprocess.check_output(
        f"report-generator --customer {customer_name}", shell=True, text=True
    )
`,
  "src/latency.ts": `/** Mean latency in milliseconds. An empty sample must return 0. */
export function meanLatency(samples: number[]): number {
  return samples.reduce((sum, value) => sum + value, 0) / samples.length
}
`,
  "ui/welcome.ts": `/** Display the customer name from the account profile. */
export function renderWelcome(root: HTMLElement, customerName: string) {
  root.innerHTML = \`<h2>欢迎，\u0024{customerName}</h2>\`
}
`,
}
const fixed: Record<string, string> = {
  "src/search.ts": `type Database = { query(sql: string, values?: unknown[]): Promise<unknown[]> }

export async function searchAccounts(db: Database, keyword: string) {
  return db.query("SELECT id, email FROM accounts WHERE email LIKE $1", [\`%\u0024{keyword}%\`])
}
`,
  "worker/report.py": `import subprocess


def build_report(customer_name: str) -> str:
    """Build a report for the customer name supplied by the web request."""
    return subprocess.check_output(
        ["report-generator", "--customer", customer_name], text=True, timeout=30
    )
`,
  "src/latency.ts": `/** Mean latency in milliseconds. An empty sample must return 0. */
export function meanLatency(samples: number[]): number {
  if (samples.length === 0) return 0
  return samples.reduce((sum, value) => sum + value, 0) / samples.length
}
`,
  "ui/welcome.ts": `/** Display the customer name from the account profile. */
export function renderWelcome(root: HTMLElement, customerName: string) {
  const heading = document.createElement("h2")
  heading.textContent = \`欢迎，\u0024{customerName}\`
  root.replaceChildren(heading)
}
`,
}

for (const entry of manifest) {
  const lab = (await labs()).find(lab => lab.name === entry.name)!
  async function put(branch: string, file: string, content: string, message: string) {
    let existing: { sha: string } | undefined
    try { existing = await api(lab, `${entry.path}/contents/${encodeURI(file)}?ref=${branch}`) }
    catch (error) { if (!String(error).includes("404")) throw error }
    return api(lab, `${entry.path}/contents/${encodeURI(file)}`, { branch, message,
      content: Buffer.from(content).toString("base64"), ...(existing ? { sha: existing.sha } : {}) }, existing ? "PUT" : "POST")
  }
  if (command === "create") {
    for (const [name, branch, files] of [
      ["多语言问题：搜索、报表、统计和页面渲染", "feature/business-changes", broken],
      ["无问题改动：保留空数组语义的求和重构", "refactor/sum", {
        "src/math.ts": "// 对任意数值列表求和；空数组返回 0。\nexport function sum(values: number[]): number {\n  return values.reduce((total, value) => total + value, 0)\n}\n",
      }],
      ["文档场景：中文与空格路径、仅文档变更", "docs/chinese-path", {
        "docs/接入 说明.md": "# 本地接入\n\n1. 启动 Gitea 或 Forgejo，并启用仓库 Actions。\n2. 注册仅服务于测试仓库的 runner。\n3. 将审查机器人的 token 保存到仓库 Actions Secret `OPENCODE_GIT_TOKEN`。\n4. 配置真实模型服务。\n5. 创建 PR，在 Actions 查看执行记录，在 PR 查看机器人审查。\n\n机器人身份由 token 决定；模型负责分析，`gitea-review` 工具负责发布。\n不要将 token 写入工作流文件。\n",
      }],
    ] as const) {
      if (entry.scenarios.some(scenario => scenario.branch === branch)) continue
      await api(lab, `${entry.path}/branches`, { new_branch_name: branch, old_branch_name: "main" })
      const changes = []
      for (const [file, content] of Object.entries(files)) {
        let old: { sha: string } | undefined
        try { old = await api(lab, `${entry.path}/contents/${encodeURI(file)}?ref=${branch}`) }
        catch (error) { if (!String(error).includes("404")) throw error }
        changes.push({ operation: old ? "update" : "create", path: file, content: Buffer.from(content).toString("base64"), ...(old ? { sha: old.sha } : {}) })
      }
      await api(lab, `${entry.path}/contents`, { branch, message: name, files: changes })
      // Let the initial push hook finish before creating the PR, avoiding an
      // artificial backlog of synchronize events from fixture construction.
      await Bun.sleep(1000)
      const pr = await api(lab, `${entry.path}/pulls`, { base: "main", head: branch, title: name,
        body: "本地真实模型验收样例。创建本 PR 触发 Actions；评论由工作流中的 OpenCode 调用真实模型后发布，测试脚本不编写审查结论。请查看 Actions 运行记录与 review-bot 的审查。" })
      entry.scenarios.push({ name, branch, number: pr.number, head: pr.head.sha,
        url: `${entry.url}/${entry.owner}/${entry.repo}/pulls/${pr.number}` })
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 })
      console.log(`${entry.name}: created ${name}: ${entry.scenarios.at(-1)!.url}`)
    }
  } else if (command === "error") {
    const branch = "test/missing-token"
    if (entry.scenarios.some(scenario => scenario.branch === branch)) continue
    await api(lab, `${entry.path}/branches`, { new_branch_name: branch, old_branch_name: "main" })
    const source = await api(lab, `${entry.path}/contents/.gitea/workflows/review.yaml?ref=main`)
    const content = Buffer.from(source.content, "base64").toString().replace(/          \/entrypoint\.sh review /,
      "          unset GITEA_TOKEN GITHUB_TOKEN\n          /entrypoint.sh review ")
    if (!content.includes("unset GITEA_TOKEN GITHUB_TOKEN")) throw new Error("Failed to inject the missing-credential test")
    await put(branch, ".gitea/workflows/review.yaml", content, "验收缺少凭据时任务必须失败")
    const pr = await api(lab, `${entry.path}/pulls`, { base: "main", head: branch, title: "异常保护：缺少凭据时必须失败，禁止假成功",
      body: "负向验收：工作流主动清除本次进程的 Gitea 凭据，应在调用模型之前失败；不会删除或修改仓库 Secret。预期 Actions 红色失败、零条 review。这是故意保留的配置异常样例。" })
    entry.scenarios.push({ name: "异常保护：缺少凭据", branch, number: pr.number, head: pr.head.sha,
      url: `${entry.url}/${entry.owner}/${entry.repo}/pulls/${pr.number}`, expectedStatus: "failure" })
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 })
    console.log(`${entry.name}: created expected-failure Actions scenario: ${entry.scenarios.at(-1)!.url}`)
  } else if (command === "fix") {
    const scenario = entry.scenarios[0]
    // One multi-file commit creates one synchronize event, rather than one
    // separate Actions run per fix. All source edits are local test fixtures.
    const files = []
    for (const [path, content] of Object.entries(fixed)) {
      const old = await api(lab, `${entry.path}/contents/${encodeURI(path)}?ref=${scenario.branch}`)
      files.push({ operation: "update", path, sha: old.sha, content: Buffer.from(content).toString("base64") })
    }
    await api(lab, `${entry.path}/contents`, { branch: scenario.branch, message: "修复搜索、报表、空样本和 HTML 渲染问题", files })
    console.log(`${entry.name}: pushed fixes; synchronize event should start an incremental review`)
  } else if (command === "repeat") {
    const scenario = entry.scenarios[0]
    const pr = await api(lab, `${entry.path}/pulls/${scenario.number}`)
    const reviews = await api(lab, `${entry.path}/pulls/${scenario.number}/reviews`)
    const comment = await api(lab, `${entry.path}/issues/${scenario.number}/comments`, {
      body: "/oc 请在相同提交上重新确认审查；已有结果应复用，不应新增重复 review。",
    })
    entry.repeat = { commentId: comment.id, head: pr.head.sha, reviewIds: reviews.map((review: any) => review.id).sort((a: number, b: number) => a - b), createdAt: comment.created_at }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 })
    console.log(`${entry.name}: /oc issue_comment ${comment.id} recorded with head and existing review IDs`)
  } else if (command === "verify") {
    const target = (status: any) => new URL(status.target_url || "/", entry.url).pathname
    const native = entry.repeat ? await nativeRuns(lab, entry.owner, entry.repo) : []
    for (const scenario of entry.scenarios) {
      const pr = await api(lab, `${entry.path}/pulls/${scenario.number}`)
      const reviews = await api(lab, `${entry.path}/pulls/${scenario.number}/reviews`)
      const status = await api(lab, `${entry.path}/commits/${pr.head.sha}/status`)
      const statuses = await api(lab, `${entry.path}/commits/${pr.head.sha}/statuses?limit=100`)
      if (statuses.length >= 100) throw new Error("Actions status pagination limit exceeded")
      const audited = statuses.filter((item: any) => /^review-lab\/run-\d+$/.test(item.context) && item.status === "success" &&
        statuses.some((native: any) => !native.context.startsWith("review-lab/") && native.status === "success" && target(native) === target(item)))
      const expected = scenario.expectedStatus || "success"
      if (expected === "failure") {
        if (!["failure", "error"].includes(status.state) || reviews.length) throw new Error(`${entry.name} ${scenario.name}: expected failed workflow and zero reviews`)
      } else {
        const current = reviews.filter((review: any) => parseReviewMarker(review.body) && review.commit_id === pr.head.sha && !review.dismissed &&
          ["COMMENT", "APPROVED", "REQUEST_CHANGES"].includes(review.state))
        if (status.state !== "success" || !audited.length || current.length !== 1 || current[0].user.login !== "review-bot" ||
            !current[0].body.includes(entry.model) || !current[0].body.includes("<!-- opencode-review:v1")) {
          throw new Error(`${entry.name} ${scenario.name}: expected successful Actions and exactly one marked real-model review on the current head`)
        }
        if (scenario === entry.scenarios[0] && entry.repeat) {
          const ids = reviews.map((review: any) => review.id).sort((a: number, b: number) => a - b)
          if (pr.head.sha !== entry.repeat.head || JSON.stringify(ids) !== JSON.stringify(entry.repeat.reviewIds) ||
              !statuses.some((item: any) => item.status === "success" && item.description.includes(`event=issue_comment comment=${entry.repeat!.commentId} `) &&
                native.some(run => run.status === "success" && run.event === "issue_comment" && run.commentId === entry.repeat!.commentId &&
                  item.context === `review-lab/run-${run.number}` && target(item) === `/${entry.owner}/${entry.repo}/actions/runs/${run.number}/jobs/0`))) {
            throw new Error(`${entry.name}: this specific /oc event has not completed successfully without adding a review`)
          }
        }
      }
      console.log(`PASS ${entry.name}: ${scenario.name} (${expected}; ${reviews.length} reviews)`)
    }
  } else if (command === "snapshot") {
    const results = []
    for (const scenario of entry.scenarios) {
      const pr = await api(lab, `${entry.path}/pulls/${scenario.number}`)
      const reviews = await api(lab, `${entry.path}/pulls/${scenario.number}/reviews`)
      const status = await api(lab, `${entry.path}/commits/${pr.head.sha}/status`)
      const runs = await api(lab, `${entry.path}/commits/${pr.head.sha}/statuses?limit=100`)
      for (const review of reviews) review.line_comments = await api(lab, `${entry.path}/pulls/${scenario.number}/reviews/${review.id}/comments`)
      results.push({ ...scenario, current_head: pr.head.sha, status, runs, reviews })
    }
    const label = process.env.REVIEW_LAB_SNAPSHOT_LABEL || "latest"
    if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Snapshot label must contain only lowercase letters, digits and hyphens")
    await writeFile(join(import.meta.dir, `.local/actions-results-${entry.name}-${label}.json`),
      JSON.stringify({ server: entry.name, url: entry.url, repo: entry.repo, model: entry.model,
        captured_at: new Date().toISOString(), repeat: entry.repeat, native_runs: await nativeRuns(lab, entry.owner, entry.repo), results }, null, 2), { mode: 0o600 })
    console.log(`${entry.name}: captured actual review bodies, line comments and commit statuses`)
  } else if (command === "status") {
    for (const scenario of entry.scenarios) {
      const pr = await api(lab, `${entry.path}/pulls/${scenario.number}`)
      const reviews = await api(lab, `${entry.path}/pulls/${scenario.number}/reviews`)
      const status = await api(lab, `${entry.path}/commits/${pr.head.sha}/status`)
      console.log(JSON.stringify({ server: entry.name, scenario: scenario.name, url: scenario.url,
        head: pr.head.sha, status: status.state, checks: status.statuses?.map((s: any) => ({ state: s.status, url: s.target_url })),
        reviews: reviews.map((r: any) => ({ id: r.id, author: r.user.login, state: r.state, commit: r.commit_id,
          comments: r.comments_count, summary: r.body.replace(/<!-- opencode-review:v1[\s\S]*$/, "").slice(0, 180) })) }))
    }
  } else throw new Error(`Unknown command: ${command}`)
}
