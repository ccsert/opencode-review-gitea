import { expect, test } from "bun:test"
import plugin from "../adapters/gitea-review-v2"

type Context = Parameters<typeof plugin.setup>[0]
type Editor = Parameters<Parameters<Context["tool"]["transform"]>[0]>[0]
type Tool = Parameters<Editor["add"]>[0]

async function tools() {
  const definitions: Tool[] = []
  await plugin.setup({ tool: { async transform(edit) { edit({ add: definition => definitions.push(definition) }) } } })
  return definitions
}

const agent = { agent: "code-review", sessionID: "s1", messageID: "m1", signal: new AbortController().signal }

test("v2 exposes exactly the existing review tools as direct calls", async () => {
  const definitions = await tools()
  expect(definitions.map(tool => tool.name).sort()).toEqual(["gitea-incremental-diff", "gitea-pr-diff", "gitea-pr-files", "gitea-review"])
  expect(definitions.every(tool => tool.options.codemode === false)).toBe(true)
})

test("v2 rejects other agents, missing sessions, and malformed tool inputs", async () => {
  const [diff] = await tools()
  await expect(diff.execute({}, { ...agent, agent: "build" })).rejects.toThrow("code-review agent session")
  await expect(diff.execute({}, { ...agent, sessionID: "" })).rejects.toThrow("code-review agent session")
  await expect(diff.execute({ owner: "test", repo: "test", pull_number: 1, unexpected: "value" }, agent)).rejects.toThrow("Unrecognized key")
})
