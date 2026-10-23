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
  if (!value.startsWith('"')) return value
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

export function matchPattern(filename: string, pattern: string): boolean {
  // Convert glob pattern to regex
  // Supports: *, **, ?, [abc], [!abc]
  const regexPattern = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*")
    .replace(/\?/g, ".")
  
  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(filename)
}

export function filterFilesByPatterns(files: ParsedFile[], patterns: string[]): ParsedFile[] {
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
    parts.push(`diff --git a/${file.path} b/${file.path}`)
    parts.push(`--- ${file.status === "added" ? "/dev/null" : `a/${file.path}`}`)
    parts.push(`+++ ${file.status === "deleted" ? "/dev/null" : `b/${file.path}`}`)
    
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

