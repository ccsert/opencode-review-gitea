import { expect, test } from "bun:test"
import { paginate } from "../lib/diff"

test("multi-line standards are paged by physical lines", () => {
  const text = "RULE\n".repeat(3000)
  const pages = paginate([{ text }], { bytes: 40000, lines: 1500 })
  expect(pages.length).toBeGreaterThan(1)
  expect(pages.flat().join("\n")).toBe(text)
  for (const page of pages) expect(page.join("\n").split("\n").length).toBeLessThanOrEqual(1500)
})

test("a single oversized code line fails instead of silently truncating", () => {
  expect(() => paginate([{ text: "[NEW:1] +" + "中".repeat(20000) }], { bytes: 40000, lines: 1500 }))
    .toThrow("REVIEW_LINE_TOO_LARGE")
})

test("continuation headers cannot make the next page exceed its budget", () => {
  expect(() => paginate([{ text: "a".repeat(70) }, { text: "b".repeat(70), header: ["c".repeat(50)] }], { bytes: 100, lines: 10 }))
    .toThrow("REVIEW_LINE_TOO_LARGE")
})
