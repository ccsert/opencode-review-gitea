/**
 * 本地验证 diff 解析逻辑
 * 运行: cd .opencode-review && bun run gitea-pr-diff.test.ts
 */

// 模拟 parseDiff 和 formatDiffForReview 函数
interface ParsedChange {
  type: "add" | "del" | "normal"
  content: string
  oldLine?: number
  newLine?: number
}

interface ParsedHunk {
  oldStart: number
  newStart: number
  changes: ParsedChange[]
}

interface ParsedFile {
  path: string
  status: string
  hunks: ParsedHunk[]
}

function parseDiff(diffText: string): ParsedFile[] {
  const files: ParsedFile[] = []
  const lines = diffText.split("\n")
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith("diff --git")) {
      const pathMatch = line.match(/b\/(.+)$/)
      const path = pathMatch ? pathMatch[1] : "unknown"

      let status = "modified"
      while (i < lines.length && !lines[i].startsWith("@@")) {
        if (lines[i].startsWith("new file")) status = "added"
        else if (lines[i].startsWith("deleted file")) status = "deleted"
        else if (lines[i].startsWith("rename")) status = "renamed"
        i++
      }

      const hunks: ParsedHunk[] = []

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

function formatDiffForReview(files: ParsedFile[]): string {
  const parts: string[] = []

  for (const file of files) {
    parts.push(`\n## ${file.path} (${file.status})\n`)

    for (const hunk of file.hunks) {
      parts.push(`@@ starting at line ${hunk.newStart} (old: ${hunk.oldStart}) @@`)

      for (const change of hunk.changes) {
        if (change.type === "add") {
          parts.push(`[NEW:${change.newLine}] +${change.content}`)
        } else if (change.type === "del") {
          parts.push(`[OLD:${change.oldLine}] -${change.content}`)
        } else {
          parts.push(`[NEW:${change.newLine}]  ${change.content}`)
        }
      }
      parts.push("")
    }
  }

  return parts.join("\n")
}

// ============ 测试用例 ============

const testDiff = `diff --git a/src/app.ts b/src/app.ts
index 1234567..abcdefg 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,7 +10,8 @@ function main() {
   const config = loadConfig()
   console.log("Starting app")
-  const oldValue = "deprecated"
+  const newValue = "updated"
+  const extraLine = "added"
   return config
 }
`

console.log("=== 测试 Diff 解析 ===\n")

const parsed = parseDiff(testDiff)
console.log("解析结果:")
console.log(JSON.stringify(parsed, null, 2))

console.log("\n=== 格式化输出 ===\n")

const formatted = formatDiffForReview(parsed)
console.log(formatted)

console.log("\n=== 验证检查 ===\n")

// 验证删除行有 oldLine
const delChange = parsed[0]?.hunks[0]?.changes.find(c => c.type === "del")
if (delChange && delChange.oldLine) {
  console.log(`✅ 删除行有 oldLine: ${delChange.oldLine}`)
} else {
  console.log("❌ 删除行缺少 oldLine")
}

// 验证添加行有 newLine
const addChange = parsed[0]?.hunks[0]?.changes.find(c => c.type === "add")
if (addChange && addChange.newLine) {
  console.log(`✅ 添加行有 newLine: ${addChange.newLine}`)
} else {
  console.log("❌ 添加行缺少 newLine")
}

// 验证格式化输出包含 [OLD:X] 和 [NEW:X]
if (formatted.includes("[OLD:") && formatted.includes("[NEW:")) {
  console.log("✅ 格式化输出包含 [OLD:X] 和 [NEW:X] 格式")
} else {
  console.log("❌ 格式化输出格式不正确")
}

console.log("\n=== 模拟 Review 评论映射 ===\n")

// 模拟 gitea-review 的评论映射逻辑
interface Comment {
  path: string
  line?: number
  old_line?: number
  body: string
}

function mapComment(c: Comment) {
  const result: { path: string; body: string; new_position?: number; old_position?: number } = {
    path: c.path,
    body: c.body,
  }
  
  if (c.old_line !== undefined && c.old_line > 0) {
    result.old_position = c.old_line
    result.new_position = 0
  } else if (c.line !== undefined && c.line > 0) {
    result.new_position = c.line
    result.old_position = 0
  }
  
  return result
}

// 测试评论映射
const testComments: Comment[] = [
  { path: "src/app.ts", line: 13, body: "Consider const here" },
  { path: "src/app.ts", old_line: 12, body: "This was important logic" },
]

console.log("输入评论:")
console.log(JSON.stringify(testComments, null, 2))

console.log("\n映射到 Gitea API 格式:")
const mapped = testComments.map(mapComment)
console.log(JSON.stringify(mapped, null, 2))

// 验证映射结果
const newLineComment = mapped.find(m => m.new_position && m.new_position > 0)
const oldLineComment = mapped.find(m => m.old_position && m.old_position > 0)

if (newLineComment && newLineComment.old_position === 0) {
  console.log("\n✅ 新行评论正确映射: new_position=" + newLineComment.new_position + ", old_position=0")
} else {
  console.log("\n❌ 新行评论映射错误")
}

if (oldLineComment && oldLineComment.new_position === 0) {
  console.log("✅ 旧行评论正确映射: old_position=" + oldLineComment.old_position + ", new_position=0")
} else {
  console.log("❌ 旧行评论映射错误")
}

console.log("\n=== 测试完成 ===")
