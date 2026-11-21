/// <reference path="../env.d.ts" />
import { z } from "zod"
import DESCRIPTION from "./gitea-comment.txt"
import { GiteaClient, requireReviewTarget } from "../lib/gitea"
import { giteaTool } from "../lib/tool"

export default giteaTool({
  name: "gitea-comment",
  description: DESCRIPTION,
  input: z.object({
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    issue_number: z.number().describe("Issue or PR number"),
    body: z.string().describe("Comment content (supports Markdown)"),
  }),
  async execute({ owner, repo, issue_number, body }) {
    requireReviewTarget({ owner, repo, pull_number: issue_number })
    await new GiteaClient().json(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issue_number}/comments`, {
      method: "POST", body: JSON.stringify({ body }),
    })
    return `✅ Comment posted successfully on #${issue_number}`
  },
})
