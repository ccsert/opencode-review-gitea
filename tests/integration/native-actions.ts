import { api, type Lab } from "./lab"

export interface NativeRun { number: number; status: string; event: string; commentId?: number }

// issue_comment runs have no native commit status on these servers. Check the
// actual run, independently of the success marker written inside the workflow.
export async function nativeRuns(lab: Lab, owner: string, repo: string): Promise<NativeRun[]> {
  if (lab.name === "forgejo") {
    const result = await api(lab, `/repos/${owner}/${repo}/actions/runs?limit=100`)
    if (result.workflow_runs.length >= 100) throw new Error("Native Actions run pagination limit exceeded")
    return result.workflow_runs.map((run: any) => ({ number: run.index_in_repo, status: run.status,
      event: run.trigger_event, commentId: JSON.parse(run.event_payload).comment?.id }))
  }
  if (lab.name !== "gitea") throw new Error("Unsupported local Actions lab")
  // Pinned Gitea 1.24.6 has no run-status REST endpoint. Read only this fixture
  // repository's rows from the Compose SQLite volume, without network access.
  // StatusSuccess=1: go-gitea/gitea v1.24.6 models/actions/status.go.
  const source = `import { Database } from "bun:sqlite";
const db = new Database("/data/gitea/gitea.db", { readonly: true });
const rows = db.query('SELECT a."index" AS number, a.status, a.trigger_event AS event, a.event_payload FROM action_run a JOIN repository r ON r.id=a.repo_id JOIN user u ON u.id=r.owner_id WHERE u.name=? AND r.name=? LIMIT 101').all(process.argv[1], process.argv[2]);
if (rows.length >= 100) throw new Error("Native Actions run pagination limit exceeded");
console.log(JSON.stringify(rows.map(row => ({ number: row.number, status: row.status === 1 ? "success" : "not-success", event: row.event, commentId: JSON.parse(row.event_payload).comment?.id }))));`
  const result = Bun.spawnSync(["docker", "run", "--rm", "--network", "none", "--read-only", "--entrypoint", "bun",
    "--mount", "type=volume,src=opencode-review-lab_gitea-data,dst=/data,readonly",
    process.env.REVIEW_LAB_IMAGE || "opencode-review-reliability:local", "-e", source, owner, repo])
  if (result.exitCode !== 0) throw new Error(`Could not read local native Actions state: ${result.stderr.toString()}`)
  return JSON.parse(result.stdout.toString())
}
