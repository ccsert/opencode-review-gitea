import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const directory = join(import.meta.dir, ".local")
const credentialsPath = join(directory, "credentials.json")
export interface Lab {
  name: string; url: string; adminToken: string; botToken: string; humanToken: string
}
export async function labs(): Promise<Lab[]> {
  return JSON.parse(await readFile(join(directory, "servers.json"), "utf8"))
}

export async function api<T = any>(lab: Pick<Lab, "url" | "adminToken">, endpoint: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`${lab.url}/api/v1${endpoint}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { Authorization: `token ${lab.adminToken}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`${response.status} ${endpoint}: ${await response.text()}`)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function bootstrap() {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  let credentials: { username: string; password: string }
  try { credentials = JSON.parse(await readFile(credentialsPath, "utf8")) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    credentials = { username: "review-lab-admin", password: `Local-${crypto.randomUUID()}!` }
    await writeFile(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600 })
  }
  const servers: Lab[] = []
  for (const [name, port, binary] of [
    ["gitea", process.env.GITEA_LAB_PORT ?? "13010", "gitea"],
    ["forgejo", process.env.FORGEJO_LAB_PORT ?? "13011", "forgejo"],
  ]) {
    const url = `http://127.0.0.1:${port}`
    let ready = false
    for (let attempt = 0; attempt < 90; attempt++) {
      try { if ((await fetch(`${url}/api/v1/version`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } }
      catch { /* Wait for the local database migrations. */ }
      await Bun.sleep(1000)
    }
    if (!ready) throw new Error(`${name} did not become ready`)
    const command = (...args: string[]) => Bun.spawnSync(["docker", "compose", "-f", join(import.meta.dir, "compose.yaml"),
      "exec", "-T", "--user", "git", name, binary, "--config", "/data/gitea/conf/app.ini", "admin", ...args])
    const create = command("user", "create", "--username", credentials.username, "--password", credentials.password,
      "--email", "admin@review-lab.test", "--admin", "--must-change-password=false")
    const createOutput = create.stdout.toString() + create.stderr.toString()
    if (create.exitCode !== 0 && !/already exists|already been taken/i.test(createOutput)) throw new Error(createOutput)
    const tokenResult = command("user", "generate-access-token", "--username", credentials.username,
      "--token-name", `regression-${Date.now()}`, "--scopes", "all", "--raw")
    if (tokenResult.exitCode !== 0) throw new Error(tokenResult.stderr.toString())
    const adminToken = tokenResult.stdout.toString().trim().split("\n").at(-1)!
    const server = { name, url, adminToken }
    const tokens: string[] = []
    for (const username of ["review-bot", "human-reviewer"]) {
      try {
        await api(server, "/admin/users", { username, password: credentials.password, email: `${username}@review-lab.test`,
          must_change_password: false, send_notify: false })
      } catch (error) { if (!String(error).includes("422")) throw error }
      const response = await fetch(`${url}/api/v1/users/${username}/tokens`, { method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${username}:${credentials.password}`).toString("base64")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: `regression-${Date.now()}`, scopes: ["all"] }) })
      if (!response.ok) throw new Error(`Could not create ${username} token: ${await response.text()}`)
      tokens.push((await response.json() as { sha1: string }).sha1)
    }
    servers.push({ ...server, botToken: tokens[0], humanToken: tokens[1] })
    console.log(`${name} ready: ${url}`)
  }
  await writeFile(join(directory, "servers.json"), JSON.stringify(servers, null, 2), { mode: 0o600 })
  console.log(`Local login credentials: ${credentialsPath}`)
}
if (import.meta.main) await bootstrap()
