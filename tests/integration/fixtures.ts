import { api, type Lab } from "./lab"
const owner = "review-lab-admin"

export async function fixture(lab: Lab) {
  const repo = `regression-${crypto.randomUUID().slice(0, 8)}`
  await api(lab, "/user/repos", { name: repo, auto_init: true, default_branch: "main", private: true })
  const path = `/repos/${owner}/${repo}`
  await api(lab, `${path}/contents/app.ts`, { message: "Initial code", content: Buffer.from("export const a = 1\n").toString("base64") })
  await api(lab, `${path}/branches`, { new_branch_name: "feature", old_branch_name: "main" })
  async function push(content: string) {
    const file = await api(lab, `${path}/contents/app.ts?ref=feature`)
    await api(lab, `${path}/contents/app.ts`, { branch: "feature", sha: file.sha, message: "Update feature",
      content: Buffer.from(content).toString("base64") }, "PUT")
  }
  await push("export const a = 1\nexport const b = 2\n")
  for (const username of ["review-bot", "human-reviewer"]) {
    await api(lab, `${path}/collaborators/${username}`, { permission: "write" }, "PUT")
  }
  const pr = await api(lab, `${path}/pulls`, { base: "main", head: "feature", title: "Local review regression" })
  const args = { owner, repo, pull_number: pr.number }
  return { args, push, path: `${path}/pulls/${pr.number}`, head: pr.head.sha }
}

