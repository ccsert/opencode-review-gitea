# Draft reviews

`REVIEW_MODE=submit` is the default. `REVIEW_MODE=draft` creates a native PENDING
review owned by the token's account; the AI cannot switch it to a published
review. This works from an external Docker invocation without a workflow or
checkout in the target repository.

See [screenshots and local validation](draft-review-validation.md) for the
reviewer/other-collaborator views and the tested platform versions.

## Choose an image

When testing an unreleased PR, build from a checkout containing that change:

```bash
docker build --build-arg OPENCODE_VERSION=1.19.4 -t opencode-review:draft .
export REVIEW_IMAGE=opencode-review:draft
```

The version above is the OpenCode version used for the local acceptance run.
Omit the build argument to use the Dockerfile's current default. The published
`ghcr.io/ccsert/opencode-review:latest` includes a change only after it is merged
and the publishing workflow succeeds. For a released image, set `REVIEW_IMAGE`
to its tag or digest instead.

## Persistent output and human handoff

Create a Gitea/Forgejo API token for the person who will finish the review.
That account needs access to the target repository. For a scoped token, enable
`read:user` (reviewer identity), `write:repository` (PR reviews and code access)
and `write:issue` (timeline lookup and placeholder cleanup). On the tested
Gitea/Forgejo versions, repository permission alone does not authorize the user
or issue-timeline endpoints. Export these values in your shell (use your own
server and credentials):

```bash
export GITEA_SERVER_URL="https://git.example.com"
export GITEA_TOKEN="<human-reviewer-token>"
export DEEPSEEK_API_KEY="<model-provider-key>"
```

The example uses the image's default DeepSeek model. For another supported
provider, pass its key and `MODEL`; for an OpenAI-compatible custom gateway,
use the example below. Avoid putting tokens in repository files.

Draft mode requires `REVIEW_OUTPUT_DIR`. Mount it to retain both the exported
summary and recovery data across disposable containers:

```bash
mkdir -p review-output
docker run --rm \
  -v "$(pwd)/review-output:/review-output" \
  -e GITEA_TOKEN -e GITEA_SERVER_URL -e DEEPSEEK_API_KEY \
  -e REPO_OWNER=your-org -e REPO_NAME=your-repo -e PR_NUMBER=123 \
  -e REVIEW_MODE=draft -e REVIEW_OUTPUT_DIR=/review-output \
  "${REVIEW_IMAGE:-ghcr.io/ccsert/opencode-review:latest}"
```

Custom model providers use the same trusted OpenCode config mounting mechanism
as submit mode. Only the output directory and optional provider configuration
are mounted; target repository code is not needed.

### Custom OpenAI-compatible gateway

Save this as `review-provider.json` outside the target repository. Replace
`my-model` with the model ID accepted by your gateway, including any slashes or
prefixes. The `MODEL` value consists of the provider name followed by that ID.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "review-gateway/my-model",
  "enabled_providers": ["review-gateway"],
  "permission": { "edit": "deny", "bash": "deny", "read": "deny" },
  "provider": {
    "review-gateway": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "{env:REVIEW_GATEWAY_URL}",
        "apiKey": "{env:REVIEW_GATEWAY_KEY}"
      },
      "models": { "my-model": { "name": "My review model" } }
    }
  }
}
```

Export `REVIEW_GATEWAY_URL` (ending in `/v1`) and `REVIEW_GATEWAY_KEY` in your
shell, then run:

```bash
mkdir -p review-output
docker run --rm \
  -v "$(pwd)/review-provider.json:/app/.opencode-review/opencode.json:ro" \
  -v "$(pwd)/review-output:/review-output" \
  -e GITEA_TOKEN -e GITEA_SERVER_URL \
  -e REVIEW_GATEWAY_URL -e REVIEW_GATEWAY_KEY \
  -e MODEL=review-gateway/my-model -e OPENCODE_REFRESH_MODELS=false \
  -e REPO_OWNER=your-org -e REPO_NAME=your-repo -e PR_NUMBER=123 \
  -e REVIEW_MODE=draft -e REVIEW_OUTPUT_DIR=/review-output \
  "${REVIEW_IMAGE:-ghcr.io/ccsert/opencode-review:latest}"
```

URLs must be reachable from inside the container: `127.0.0.1` there refers to
the container itself. Docker Desktop can reach a host service through
`host.docker.internal`; on Linux, configure the corresponding host gateway or
use a Docker network shared with the service.

### Finish the review

The output contains `review-<key>.md` (editable local AI summary), `review-<key>.json`
(target, immutable base/head, recommendation and formatted comments), and a
private `.state/` directory. `OPENCODE_REVIEW_STATE_DIR` overrides the latter
when explicitly configured; keep it persistent too. Files are created with
mode 0600 and directories with mode 0700. Existing exports are not overwritten,
so edits made to the local Markdown survive a repeated run.

On Linux, bind mounts preserve numeric ownership. With the image's default
container user, the exported 0600 files can be owned by root and unreadable to
your host account. You can read the summary using the same image without
changing its private permissions (replace `<key>` with the returned filename):

```bash
docker run --rm --entrypoint cat \
  -v "$(pwd)/review-output:/review-output:ro" \
  "${REVIEW_IMAGE:-ghcr.io/ccsert/opencode-review:latest}" \
  "/review-output/review-<key>.md"
```

1. Open the returned `/pulls/<number>/files` page as the token's account.
2. Review/edit the pending line comments.
3. Keep the container running. Optionally add your own assessment in the native review form.
4. Select Comment, Approve or Request Changes. The runner detects submission and
   automatically attaches the local Markdown summary as a separate PR comment.
   It names the reviewed commit and review ID; it does not modify your native
   review body, line comments or chosen verdict. No summary copying is needed.

Before submitting, you can preview or edit `review-<key>.md` locally. The watcher
reads that file after submission, then persists the exact publication intent.
It never publishes the summary while the review is PENDING. Its comment uses
the same token/account as the draft, and is labelled as an AI summary.

### Waiting and recovery

`DRAFT_WAIT_TIMEOUT_SECONDS` defaults to `3600` (one hour). On timeout the process
exits with an explicit incomplete-handoff error and preserves the pending review
and output. `0` explicitly saves without waiting, for separately scheduled
watchers. To resume, keep the original output mount, account and exact target:

```bash
docker run --rm \
  -v "$(pwd)/review-output:/review-output" \
  -e GITEA_TOKEN -e GITEA_SERVER_URL \
  -e REPO_OWNER=your-org -e REPO_NAME=your-repo -e PR_NUMBER=123 \
  -e REVIEW_OUTPUT_DIR=/review-output \
  "${REVIEW_IMAGE:-ghcr.io/ccsert/opencode-review:latest}" \
  draft-watch <draft-key>
```

The key is printed when waiting starts. This command does not call a model or
create another review. It accepts human edits to pending comments and the native
review body. It refuses to publish for a changed base/head, wrong account,
deleted/dismissed review, or closed PR. Graceful interruption releases the local
lock; after a forced kill, establish that no process owns the lock before
removing its abandoned `draft-lock-*` directory.

Publication intent is persisted before POST. A lost response is reconciled
through a unique comment marker; an unknown result is never retried as a write.
Preserve state and rerun `draft-watch` for another read-back. Once the comment ID
is confirmed, subsequent runs do not overwrite human edits or recreate a
manually deleted summary. This follow-up comment is separate from the native
review, so it may create an additional notification. The container must remain
running (or be resumed) to observe native submission.

Drafts belong to an account, not to a team. A different ordinary collaborator
cannot open the pending review. Site administrators have special access. Use
the human reviewer's token when that person should finish in the native UI.

## Lifecycle and safeguards

| Result | Meaning |
|---|---|
| `draft_saved` | A new PENDING review and its exact line comments were read back. |
| `draft_reused` | The existing untouched draft was reused; no extra POST. |
| `draft_submitted` | The tracked review was manually submitted; no new review. This acknowledges the lifecycle, not the AI's original judgment. |
| `DRAFT_EDITED` / `DRAFT_CHANGED` | Native content, owner or commit changed. Stop and preserve the human's work. |
| `DRAFT_CONFLICT` | This account already has another pending review, including an older PR snapshot. Finish or discard it manually. |
| `DRAFT_UNKNOWN` | Creation was ambiguous. Preserve state and reconcile; never automatically POST again. |
| `DRAFT_BUSY` | Another process owns the account/PR lock. |

All diff pages and the captured base/head are still validated before writing.
Draft mode always reviews the full selected PR scope, even through the
incremental tool. Draft markers are separate from completed bot-review markers;
human-edited submissions cannot silently advance automatic coverage. Submit
mode also refuses to absorb an existing pending review into an automatic POST.

Serialize runs for each account/PR, including across hosts. The local shared
directory lock does not make query-before-create atomic across uncoordinated
hosts. Do not start native edits while a draft run is still creating/confirming
its comments. If a process is killed, first establish that no run is active,
then remove only its abandoned `draft-lock-*` directory. Preserve the
`draft-<key>.json` state and rerun with the same mounted output. Missing or
ambiguous native results are not automatically recreated.

## Pending-body and timeline compatibility

Gitea 1.24.6 and Forgejo 17.0.0 may expose the body of a PENDING review through
the issue timeline API. Therefore the model's summary is **never put in that
body**. A non-sensitive handoff placeholder and opaque key are used instead;
Until the human submits, AI findings stay in pending line comments and local
exports. The automatic summary comment is created only after submission.

On Gitea 1.24.6 the runtime removes only the exact placeholder timeline entry
belonging to the new pending review. Its owner, review ID, type and exact body
must match, and the native review must still be pending. This preserves pending
line comments and yields a single timeline entry when the human later submits.

Forgejo 17.0.0's issue-comment deletion endpoint ignores review-type entries
while returning HTTP 204. The runtime detects the retained placeholder by
reading the timeline again and reports `PENDING_TIMELINE_RETAINED`. The native
conversation can show the review twice after manual submission. No AI summary
is exposed through this placeholder. This compatibility warning does not
represent a second review or another POST; the original review ID is preserved.

Do not infer that every server version has the same privacy behavior. Verify
both the native review endpoints and timeline access with another ordinary
account on the versions you deploy. A draft is stored on the server; it is not
an offline dry run. The placeholder may have platform metadata/notification
side effects, even though findings are withheld from ordinary collaborators.
