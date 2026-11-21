import type { z } from "zod"

export interface ToolCallContext {
  readonly sessionID: string
}

// An OpenCode tool definition. Registered as a direct tool, not inside Code Mode, so
// the model and the agent permissions see the gitea-* names.
export function giteaTool<Input extends z.ZodObject>(tool: {
  name: string
  description: string
  input: Input
  execute(input: z.output<Input>, context: ToolCallContext): Promise<string>
}) {
  return {
    ...tool,
    options: { codemode: false },
    execute: async (input: z.output<Input>, context: ToolCallContext) => ({ content: await tool.execute(input, context) }),
  }
}
