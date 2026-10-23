export interface ParsedChange {
  type: "add" | "del" | "normal"
  content: string
  oldLine?: number
  newLine?: number
}

export interface ParsedHunk {
  oldStart: number
  newStart: number
  changes: ParsedChange[]
}

export interface ParsedFile {
  path: string
  status: string
  hunks: ParsedHunk[]
}

function gitPath(value: string): string {
  // Git appends a TAB delimiter to unquoted ---/+++ paths containing spaces.
  // A real TAB in a filename is C-quoted, so decode it only inside the quotes.
  if (!value.startsWith('"')) return value.split("\t", 1)[0]
  const quoted = value.match(/^"(?:\\.|[^"])*"/)?.[0]
  if (!quoted) throw new Error("Invalid Git-quoted file path")
  value = quoted
  const bytes: number[] = []
  for (let i = 1; i < value.length - 1;) {
    if (value[i] === "\\") {
      const octal = value.slice(i + 1).match(/^[0-7]{1,3}/)?.[0]
      if (octal) { bytes.push(parseInt(octal, 8)); i += octal.length + 1; continue }
      const escaped: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, "\\": 92 }
      bytes.push(escaped[value[i + 1]] ?? value.charCodeAt(i + 1)); i += 2
    } else {
      const point = value.codePointAt(i)!
      bytes.push(...Buffer.from(String.fromCodePoint(point)))
      i += point > 0xffff ? 2 : 1
    }
  }
  return Buffer.from(bytes).toString("utf8")
}

function quoteGitPath(value: string): string {
  return `"${value.replace(/["\\\x00-\x1f\x7f]/g, char =>
    char === '"' ? '\\"' : char === "\\" ? "\\\\" : `\\${char.charCodeAt(0).toString(8).padStart(3, "0")}`)}"`
}

export function parseDiff(diffText: string): ParsedFile[] {
  const files: ParsedFile[] = []
  const lines = diffText.split("\n")
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Look for file header
    if (line.startsWith("diff --git")) {
      const quoted = line.match(/^diff --git ("(?:\\.|[^"])*") ("(?:\\.|[^"])*")$/)
      const separator = line.lastIndexOf(" b/")
      let path = quoted ? gitPath(quoted[2]).replace(/^b\//, "") : separator >= 0 ? line.slice(separator + 3) : "unknown"

      // Determine status
      let status = "modified"
      i++
      while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff --git")) {
        if (lines[i].startsWith("new file")) status = "added"
        else if (lines[i].startsWith("deleted file")) status = "deleted"
        else if (lines[i].startsWith("rename")) status = "renamed"
        if (lines[i].startsWith("--- ") && lines[i].slice(4) !== "/dev/null") path = gitPath(lines[i].slice(4)).replace(/^a\//, "")
        if (lines[i].startsWith("+++ ") && lines[i].slice(4) !== "/dev/null") path = gitPath(lines[i].slice(4)).replace(/^b\//, "")
        if (lines[i].startsWith("rename to ")) path = gitPath(lines[i].slice(10))
        i++
      }

      const hunks: ParsedHunk[] = []

      // Parse hunks
      while (i < lines.length && !lines[i].startsWith("diff --git")) {
        if (lines[i].startsWith("@@")) {
          const hunkMatch = lines[i].match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
          if (hunkMatch) {
            const oldStart = parseInt(hunkMatch[1], 10)
            const newStart = parseInt(hunkMatch[2], 10)
            const changes: ParsedChange[] = []
            let oldLine = oldStart
            let newLine = newStart

            i++
            while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff --git")) {
              const content = lines[i].slice(1)
              if (lines[i].startsWith("+")) {
                changes.push({ type: "add", content, newLine: newLine++ })
              } else if (lines[i].startsWith("-")) {
                changes.push({ type: "del", content, oldLine: oldLine++ })
              } else if (lines[i].startsWith(" ")) {
                changes.push({ type: "normal", content, oldLine: oldLine++, newLine: newLine++ })
              }
              i++
            }

            hunks.push({ oldStart, newStart, changes })
          } else {
            i++
          }
        } else {
          i++
        }
      }

      files.push({ path, status, hunks })
    } else {
      i++
    }
  }

  return files
}

export function formatDiffForReview(files: ParsedFile[]): string {
  const parts: string[] = []

  for (const file of files) {
    parts.push(`\n## ${file.path} (${file.status})\n`)

    for (const hunk of file.hunks) {
      parts.push(`@@ starting at line ${hunk.newStart} (old: ${hunk.oldStart}) @@`)

      for (const change of hunk.changes) {
        if (change.type === "add") {
          // New line: [NEW:行号] +内容
          parts.push(`[NEW:${change.newLine}] +${change.content}`)
        } else if (change.type === "del") {
          // Deleted line: [OLD:行号] -内容 (用于 old_position 评论)
          parts.push(`[OLD:${change.oldLine}] -${change.content}`)
        } else {
          // Context line: [NEW:行号] 内容
          parts.push(`[NEW:${change.newLine}]  ${change.content}`)
        }
      }
      parts.push("")
    }
  }

  return parts.join("\n")
}

function globSource(pattern: string): string {
  let source = ""
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === "*" && pattern[i + 1] === "*") {
      // `**/` also matches zero directories: src/**/*.ts includes src/a.ts.
      const directory = pattern[i + 2] === "/"
      source += directory ? "(?:.*/)?" : ".*"
      i += directory ? 2 : 1
    } else if (char === "*") source += "[^/]*"
    else if (char === "?") source += "[^/]"
    else if (char === "[" && pattern.indexOf("]", i + 2) > 0) {
      const end = pattern.indexOf("]", i + 2)
      const body = pattern.slice(i + 1, end)
      const negated = body.startsWith("!") || body.startsWith("^")
      const members = (negated ? body.slice(1) : body).replace(/\\/g, "\\\\")
      source += negated ? `[^${members}/]` : `[${members}]`
      i = end
    } else source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }
  return source
}

export function matchPattern(filename: string, pattern: string): boolean {
  // Glob semantics follow .gitignore: a pattern without "/" matches the file
  // name at any depth, and one with "/" matches the full repository path.
  // Supports: *, **, ?, [abc], [!abc]
  pattern = pattern.trim().replace(/^\.?\//, "")
  const target = pattern.includes("/") ? filename : filename.slice(filename.lastIndexOf("/") + 1)
  return new RegExp(`^${globSource(pattern)}$`).test(target)
}

export function filterFilesByPatterns<T extends { path: string }>(files: T[], patterns: string[]): T[] {
  if (!patterns || patterns.length === 0) {
    return files
  }
  
  return files.filter(file => 
    patterns.some(pattern => matchPattern(file.path, pattern))
  )
}

export function formatAsRawDiff(files: ParsedFile[]): string {
  // Reconstruct a simplified raw diff from parsed files
  const parts: string[] = []
  
  for (const file of files) {
    parts.push(`diff --git ${quoteGitPath(`a/${file.path}`)} ${quoteGitPath(`b/${file.path}`)}`)
    parts.push(`--- ${file.status === "added" ? "/dev/null" : quoteGitPath(`a/${file.path}`)}`)
    parts.push(`+++ ${file.status === "deleted" ? "/dev/null" : quoteGitPath(`b/${file.path}`)}`)
    
    for (const hunk of file.hunks) {
      const oldCount = hunk.changes.filter(change => change.type !== "add").length
      const newCount = hunk.changes.filter(change => change.type !== "del").length
      parts.push(`@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`)
      
      for (const change of hunk.changes) {
        if (change.type === "add") {
          parts.push(`+${change.content}`)
        } else if (change.type === "del") {
          parts.push(`-${change.content}`)
        } else {
          parts.push(` ${change.content}`)
        }
      }
    }
    parts.push("")
  }
  
  return parts.join("\n")
}

