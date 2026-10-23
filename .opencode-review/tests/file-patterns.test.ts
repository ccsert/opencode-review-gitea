import { expect, test } from "bun:test"
import { matchPattern } from "../lib/diff"

test.each([
  ["src/a.ts", "*.ts", true],
  ["a.ts", "*.ts", true],
  ["src/a.tsx", "*.ts", false],
  ["src/a.ts", "src/**/*.ts", true],
  ["src/x/y/a.ts", "src/**/*.ts", true],
  ["lib/a.ts", "src/**/*.ts", false],
  ["src/a.ts", "src/*.ts", true],
  ["src/x/a.ts", "src/*.ts", false],
  ["docs/x/y.md", "docs/**", true],
  ["a.c++", "*.c++", true],
  ["a.cxx", "*.c++", false],
  ["b.ts", "[!a].ts", true],
  ["a.ts", "[!a].ts", false],
  ["v2.go", "v[0-9].go", true],
  ["src/a.ts", "./src/*.ts", true],
  ["中文 目录/说明.md", "*.md", true],
] as const)("%s matches %s: %p", (file, pattern, expected) => {
  expect(matchPattern(file, pattern)).toBe(expected)
})
