import { expect, test } from "bun:test"
import { MINIMUM_V2, resolveVersion } from "../.github/scripts/resolve-opencode-v2.mjs"

test("selects newest stable v2 numerically at or above the tested baseline", () => {
  expect(resolveVersion(MINIMUM_V2)).toBe("2.3.2")
  expect(resolveVersion(["2.3.2", "2.9.8", "2.10.0", "3.0.0", "2.99.0-rc.1", "2.03.4"])).toBe("2.10.0")
})

test("rejects registry errors or lack of an eligible stable v2 version", () => {
  for (const input of [[], { error: "fetch failed" }, "latest", ["2.3.1", "2.3.2-beta", "3.0.0"]]) {
    expect(() => resolveVersion(input)).toThrow("No stable OpenCode 2.x release")
  }
})
