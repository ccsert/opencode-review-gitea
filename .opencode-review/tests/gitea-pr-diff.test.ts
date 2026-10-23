import { expect, test } from "bun:test"
import { parseDiff, formatDiffForReview, formatAsRawDiff, filterFilesByPatterns } from "../lib/diff"

const text = `diff --git a/app.ts b/app.ts
--- a/app.ts
+++ b/app.ts
@@ -10,2 +10,2 @@
-const old = 1
+const value = 2
 return value
`
test("production parser preserves both old and new line anchors", () => {
  const files = parseDiff(text)
  expect(files[0].hunks[0].changes[0].oldLine).toBe(10)
  expect(files[0].hunks[0].changes[1].newLine).toBe(10)
  expect(formatDiffForReview(files)).toContain("[OLD:10] -const old = 1")
  expect(formatDiffForReview(files)).toContain("[NEW:10] +const value = 2")
})
test("lib subdirectories are not confused with the b/ path prefix", () => {
  expect(parseDiff(text.replaceAll("app.ts", "src/lib/foo.ts"))[0].path).toBe("src/lib/foo.ts")
})
test("Git-quoted UTF-8 and spaces retain the real path", () => {
  const encoded = '"b/lib/\\346\\265\\213\\350\\257\\225 file.ts"'
  const value = text.replace("diff --git a/app.ts b/app.ts", `diff --git "a/lib/old file.ts" ${encoded}`)
    .replace("--- a/app.ts", '--- "a/lib/old file.ts"').replace("+++ b/app.ts", `+++ ${encoded}`)
  expect(parseDiff(value)[0].path).toBe("lib/测试 file.ts")
})
test("unquoted space paths exclude Git's trailing tab separator", () => {
  const value = text.replaceAll("app.ts", "docs/接入 说明.md")
    .replace("--- a/docs/接入 说明.md", "--- a/docs/接入 说明.md\t")
    .replace("+++ b/docs/接入 说明.md", "+++ b/docs/接入 说明.md\t")
  const files = parseDiff(value)
  expect(files[0].path).toBe("docs/接入 说明.md")
  expect(parseDiff(formatAsRawDiff(files))).toEqual(files)
})
test("quoted control characters remain in filenames while timestamp delimiters do not", () => {
  const value = text.replace("diff --git a/app.ts b/app.ts", 'diff --git "a/tab\\tfile.ts" "b/tab\\tfile.ts"')
    .replace("--- a/app.ts", '--- "a/tab\\tfile.ts"\t2026-10-23 00:00:00 +0000')
    .replace("+++ b/app.ts", '+++ "b/tab\\tfile.ts"\t2026-10-23 00:00:00 +0000')
  const files = parseDiff(value)
  expect(files[0].path).toBe("tab\tfile.ts")
  expect(parseDiff(formatAsRawDiff(files))).toEqual(files)
})
test("binary and rename-only files do not consume the next text file", () => {
  const files = parseDiff(`diff --git a/icon.png b/icon.png
Binary files a/icon.png and b/icon.png differ
diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
${text}`)
  expect(files.map(file => file.path)).toEqual(["icon.png", "new.ts", "app.ts"])
  expect(files[1].status).toBe("renamed")
  expect(files[2].hunks).toHaveLength(1)
})
test("filtered raw output retains valid hunk sizes and can be parsed again", () => {
  const files = filterFilesByPatterns(parseDiff(text), ["*.ts"])
  const raw = formatAsRawDiff(files)
  expect(raw).toContain("@@ -10,2 +10,2 @@")
  expect(parseDiff(raw)).toEqual(files)
  expect(filterFilesByPatterns(files, ["*.go"])).toHaveLength(0)
})
