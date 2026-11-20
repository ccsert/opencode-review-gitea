import { constants } from "node:fs"
import { lstat, open, realpath } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"

// This source is selected only by the trusted launch environment, never tool
// arguments or PR content. Do not expose host/container paths to the model.
export const MOUNTED_RULE_SOURCE = "mounted:REVIEW_RULES_FILE"

export function rulesByteLimit() {
  const value = Number(process.env.REVIEW_RULES_MAX_BYTES ?? 30000)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("REVIEW_RULES_MAX_BYTES must be a positive safe integer")
  return value
}

function contains(root: string, path: string) {
  const child = relative(root, path)
  return child === "" || (!child.startsWith("../") && child !== ".." && !isAbsolute(child))
}

export async function readMountedRules(): Promise<string | undefined> {
  const path = process.env.REVIEW_RULES_FILE?.trim()
  if (!path) return undefined
  if (["none", "false"].includes(process.env.REVIEW_RULES?.trim() ?? "")) {
    throw new Error("RULES_INVALID: REVIEW_RULES_FILE cannot be combined with REVIEW_RULES=none/false")
  }
  if (!isAbsolute(path) || path.includes("\0") || !/\.(md|markdown|txt)$/i.test(path)) {
    throw new Error("RULES_INVALID: REVIEW_RULES_FILE must be an absolute path to one Markdown/text file (.md, .markdown or .txt), not a URI")
  }
  const limit = rulesByteLimit()
  try {
    // Check before realpath too: some runtimes open the path while resolving
    // it, which can otherwise wait forever on a FIFO with no writer.
    const entry = await lstat(path)
    if (entry.isSymbolicLink()) throw new Error("RULES_INVALID: REVIEW_RULES_FILE must not be a symbolic link")
    if (!entry.isFile()) throw new Error("RULES_INVALID: REVIEW_RULES_FILE must be a regular file")
    // Check both lexical and canonical roots, including symlinked parents.
    // No workspace-trust opt-in can bypass the mounted-rules boundary.
    const resolved = await realpath(path)
    for (const root of ["/workspace", process.env.GITHUB_WORKSPACE, process.env.OPENCODE_REVIEW_WORKSPACE].filter(Boolean) as string[]) {
      const absolute = resolve(root)
      let canonical = absolute
      try { canonical = await realpath(absolute) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
      if (contains(absolute, resolve(path)) || contains(canonical, resolved)) {
        throw new Error("RULES_INVALID: REVIEW_RULES_FILE must be outside the PR workspace; mount a trusted file separately")
      }
    }
    // NONBLOCK prevents a replaced FIFO from hanging before fstat; NOFOLLOW
    // prevents a replaced final symlink. Read only the validated regular file.
    const file = await open(resolved, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (!stat.isFile()) throw new Error("RULES_INVALID: REVIEW_RULES_FILE must be a regular file")
      const tooLarge = () => new Error(`RULES_TOO_LARGE: REVIEW_RULES_FILE exceeds ${limit} bytes (REVIEW_RULES_MAX_BYTES), including frontmatter`)
      if (stat.size > limit) throw tooLarge()
      const chunks: Buffer[] = []
      let size = 0
      while (size <= limit) {
        const chunk = Buffer.alloc(Math.min(8192, limit + 1 - size))
        const { bytesRead } = await file.read(chunk, 0, chunk.length, null)
        if (!bytesRead) break
        size += bytesRead
        if (size > limit) throw tooLarge()
        chunks.push(chunk.subarray(0, bytesRead))
      }
      let text: string
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)) }
      catch { throw new Error("RULES_INVALID: REVIEW_RULES_FILE must contain valid UTF-8 text") }
      if (!text.trim() || text.includes("\0")) throw new Error("RULES_INVALID: REVIEW_RULES_FILE must contain non-empty Markdown/text without NUL bytes")
      return text
    } finally { await file.close() }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("RULES_")) throw error
    // Filesystem errors contain the private pathname. Surface only the code.
    const code = (error as NodeJS.ErrnoException).code ?? "READ_FAILED"
    throw new Error(`RULES_UNAVAILABLE: Cannot read REVIEW_RULES_FILE (${code}); check the trusted read-only mount and file permissions`)
  }
}
