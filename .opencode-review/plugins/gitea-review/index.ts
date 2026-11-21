import { Plugin } from "@opencode/plugin"
import comment from "../../tools/gitea-comment"
import incrementalDiff from "../../tools/gitea-incremental-diff"
import prDiff from "../../tools/gitea-pr-diff"
import prFiles from "../../tools/gitea-pr-files"
import review from "../../tools/gitea-review"

export default Plugin.define({
  id: "opencode-review.gitea",
  async setup(ctx) {
    await ctx.tool.transform(editor => {
      editor.add(comment)
      editor.add(incrementalDiff)
      editor.add(prDiff)
      editor.add(prFiles)
      editor.add(review)
    })
  },
})
