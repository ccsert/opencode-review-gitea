import { tool, type ToolContext } from "@opencode-ai/plugin"
import diff from "../../tools/gitea-pr-diff"
import incremental from "../../tools/gitea-incremental-diff"
import files from "../../tools/gitea-pr-files"
import review from "../../tools/gitea-review"

// The V2 server accepts a default-exported { id, setup } plugin. Keep this
// adapter out of V1's discovered plugin directory, and keep one set of review
// schemas and executors rather than forking the Gitea behavior.
type V2ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  signal: AbortSignal
}

type V2Tool = {
  name: string
  description: string
  input: object
  options: { codemode: false }
  execute(input: unknown, context: V2ToolContext): Promise<{ content: string }>
}

type V2PluginContext = {
  tool: { transform(edit: (editor: { add(tool: V2Tool): void }) => void): Promise<unknown> }
}

type InputShape = Parameters<typeof tool>[0]["args"]

function adapt<Args extends InputShape>(name: string, definition: ReturnType<typeof tool<Args>>): V2Tool {
  const schema = tool.schema.strictObject(definition.args)
  return {
    name,
    description: definition.description,
    input: tool.schema.toJSONSchema(schema, { target: "draft-7", io: "input" }),
    options: { codemode: false },
    async execute(input, context) {
      if (context.agent !== "code-review" || !context.sessionID) {
        throw new Error("A code-review agent session is required")
      }
      const legacyContext: ToolContext = {
        sessionID: context.sessionID,
        messageID: context.messageID,
        agent: context.agent,
        abort: context.signal,
        metadata() {},
        async ask() { throw new Error("Permission escalation is not supported by the review adapter") },
      }
      return { content: await definition.execute(schema.parse(input), legacyContext) }
    },
  }
}

export default {
  id: "gitea-review-v2",
  async setup(ctx: V2PluginContext) {
    await ctx.tool.transform(editor => {
      editor.add(adapt("gitea-pr-diff", diff))
      editor.add(adapt("gitea-incremental-diff", incremental))
      editor.add(adapt("gitea-pr-files", files))
      editor.add(adapt("gitea-review", review))
    })
  },
}
