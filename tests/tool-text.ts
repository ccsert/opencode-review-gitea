// Call a registered OpenCode tool definition and return the text it gives the model.
export const toolText = <Input, Context>(tool: { execute(input: Input, context: Context): Promise<{ content: string }> }) => ({
  execute: async (input: Input, context: Context) => (await tool.execute(input, context)).content,
})
