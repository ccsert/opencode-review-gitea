/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import DESCRIPTION from "./gitea-comment.txt"
import { GiteaClient, requireReviewTarget } from "../lib/gitea"

export default tool({
  description: DESCRIPTION,
  args: {
    owner: tool.schema.string().describe("Repository owner"),
    repo: tool.schema.string().describe("Repository name"),
    issue_number: tool.schema.number().describe("Issue or PR number"),
    body: tool.schema.string().describe("Comment content (supports Markdown)"),
  },
  async execute({ owner, repo, issue_number, body }) {
    requireReviewTarget({ owner, repo, pull_number: issue_number })
    await new GiteaClient().json(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issue_number}/comments`, {
      method: "POST", body: JSON.stringify({ body }),
    })
    return `✅ Comment posted successfully on #${issue_number}`
  },
})
