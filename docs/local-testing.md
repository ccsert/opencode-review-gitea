# 本地开发与审查可靠性验证

需要 Docker Compose 和 Bun。测试环境使用 Gitea 1.24.6、Forgejo 17.0.0，数据保存在本项目命名的 Docker volumes 中，端口仅绑定本机。

```bash
bun install --cwd .opencode-review
docker compose -f tests/integration/compose.yaml up -d
bun tests/integration/lab.ts
```

- Gitea：<http://127.0.0.1:13010>
- Forgejo：<http://127.0.0.1:13011>
- 本地管理员账号及随机密码：`tests/integration/.local/credentials.json`
- 测试用户：`review-bot`、`human-reviewer`。它们使用相同的本地随机密码。
- 密码、测试 token、模型日志均在被 Git 忽略的 `.local/` 目录中，不用于任何远程服务。
- 可通过 `GITEA_LAB_PORT`、`FORGEJO_LAB_PORT` 调整端口；启动与初始化时需使用相同设置。

## 验证命令

```bash
# 单元测试直接导入生产模块，不复制实现
bun test ./tests/*.test.ts ./.opencode-review/tests/*.test.ts
bun .opencode-review/node_modules/typescript/bin/tsc -p .opencode-review/tsconfig.json

# 在真实 Gitea 和 Forgejo 中创建私有仓库、PR、review 和行评论
bun test tests/integration/review.integration.test.ts

# 构建当前代码，并验证完整的 OpenCode 工具调用链
docker build -t opencode-review-reliability:local .
bun tests/integration/model-smoke.ts
```

API 集成测试覆盖固定提交、人工 review 不推进 bot 基准、push 后拒绝旧结果、并发与重复提交、POST 响应超时恢复、发布后读回失败及恢复。增量审查按新提交触及的文件筛选原始 PR hunks，保留 PR base/head 行号，不拼接不同提交的 diff。

模型测试使用**真实 OpenCode CLI 和项目 Docker 入口**，由本地 OpenAI 兼容协议桩产生确定性 tool calls，再调用生产工具发布真实 review、读回行评论并检查回执。它不访问商业模型，不代表真实模型审查质量或真实模型服务兼容性。日志保存在 `.local/model-gitea.log`、`.local/model-forgejo.log`。

CI 在发布镜像前运行上述测试；任何一步失败都不会进入镜像发布任务。旧的统计测试针对的是仓库中已不存在的实现，现已删除。

## 可选：真实 Actions 与自定义模型验收

这组验收实际注册仓库级 runner，由 PR 的 `opened`、`synchronize` 和 `/oc` 的 `issue_comment` 事件触发。使用真实模型推理，不使用协议桩，因此需要自行提供可用的模型网关；不作为默认 CI 的一部分。

将单个自定义 provider 配置保存在被忽略的 `tests/integration/.local/provider.json`，例如：

```json
{
  "provider": {
    "review-gateway": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://host.docker.internal:3425/v1",
        "apiKey": "<填写本地网关密钥>"
      },
      "models": {
        "minimax-cn/MiniMax-M3.1-Flash": {
          "name": "MiniMax M3.1 Flash",
          "limit": { "context": 131072, "output": 8192 }
        }
      }
    }
  }
}
```

容器通过 `host.docker.internal` 访问宿主机网关；直接在宿主机运行时使用 `127.0.0.1`。OpenCode 的 `MODEL` 为 `provider/模型ID`，此例是 `review-gateway/minimax-cn/MiniMax-M3.1-Flash`，发送给网关的模型 ID 仍是 `minimax-cn/MiniMax-M3.1-Flash`。

```bash
docker build -t opencode-review-reliability:local .
REVIEW_LAB_CONFIG=tests/integration/.local/provider.json \
REVIEW_LAB_MODEL=review-gateway/minimax-cn/MiniMax-M3.1-Flash \
  bun tests/integration/actions-lab.ts
bun tests/integration/actions-scenarios.ts create
bun tests/integration/actions-scenarios.ts status
```

初始化会创建两个私有样例仓库，单独注册 Gitea act_runner 0.2.13 和 Forgejo runner 13.0.0，保存 runner 名称、仓库、模型及 PR 地址到 `.local/actions-lab.json`。仅将选定 provider 的配置和测试机器人 token 写入本地仓库 Actions Secrets；不改写用户全局 OpenCode 配置，也不提交凭据。需要 Docker socket 的是 runner，工作容器不挂载该 socket。

初始场景包括多语言安全/逻辑问题、无阻塞重构、中文空格路径文档。初轮完成后可继续：

```bash
# 推送一笔修复提交，观察 synchronize 增量审查
bun tests/integration/actions-scenarios.ts fix

# 当前提交已有已完成审查后，用真实 /oc 评论触发重复审查
bun tests/integration/actions-scenarios.ts repeat

# 故意缺少进程凭据：预期 Actions 失败、零条 review
bun tests/integration/actions-scenarios.ts error

# 等上述任务结束后验收；尚在排队或运行时应失败，稍后重查
bun tests/integration/actions-scenarios.ts verify
bun tests/integration/actions-scenarios.ts snapshot
```

`verify` 同时检查每次验收步骤生成的唯一运行标记和同一运行的原生 Actions 成功状态，排除已作废或待提交 review。重复审查还必须匹配本次 `/oc` 评论 ID，并确认前后 review ID 不变。缺少凭据的负向场景保留红色失败记录，不应将它理解为环境整体故障。

真实模型可能给出不同判断。应独立检查意见是否有充分证据；本组用例不以评论数量代表审查质量，也不自动应用模型建议。旧的失败样例可保留用于排障，不能混算为通过。

## 运行约定

- Docker 入口及源码 workflow 通过 `run-review.ts` 执行审查。OpenCode 返回 0，但未提供已确认的 review 回执时，任务仍以失败结束。
- diff 工具记录本次运行的 base/head。PR 在读取 diff 或提交前发生变更会报 `PR_CHANGED`，应启动新审查；同一运行不能覆盖快照后复用旧结论。
- 取 diff 前后和发布前后还会校验实际的 `refs/pull/N/head`，避免 Forgejo 的 PR 元数据先更新、Git 引用后更新时把旧 diff 标成新提交。引用短时间未就绪会等待；持续未就绪则报 `PR_DIFF_NOT_READY`，不创建快照或发布。
- Git 的空格路径分隔 TAB 与真实文件名中的转义字符分别处理；重建 raw diff 时使用 Git 引号，避免中文、空格、TAB、引号等路径产生虚构的行评论锚点。
- `gitea-review` 要求先在同一运行获取 diff，并校验行评论是否属于该 diff。发布时明确指定捕获的 SHA，随后读回 review 和行评论。
- 发布标记同时携带总结正文和行评论（含文件路径、新旧侧行号）的完整性摘要。首次提交、重复提交、增量基准及 `No New Changes` 使用同一读回校验，不能借“无新变更”绕过正文损坏、评论丢失或行号错误。HTTP 写入采用 ASCII JSON 转义传输 Unicode，避免多字节字符在字符串编码边界受损。
- 增量基准只接受当前 token 用户发布、带本工具版本内容校验信息、匹配 base、覆盖完整 PR 的已完成 review。未带标记或缺少内容校验信息的旧审查不作为基准，升级后首次运行会完整审查；旧提交意图保留在原格式命名空间。
- 重复触发会复用远端已确认的 review。同一状态目录中的并发提交还通过原子文件声明去重。网络超时/5xx 后只查询结果，不盲目重发 POST。
- `OPENCODE_REVIEW_STATE_DIR` 默认使用容器临时目录；需要跨容器重启保留提交意图时，将它设为持久卷中的目录。多个独立 runner 应使用同一个共享持久目录并串行处理同一 PR；仅凭远端“查询后提交”不能保证跨机器原子去重。
- 模板的 `concurrency` 对同一 PR 排队且不取消运行。Gitea 1.24 不支持此语法；旧版应使用单个专用 runner、串行执行审查，或升级到支持并发组的版本。
- `SUBMISSION_UNKNOWN` 表示服务器可能已接受写入。保留状态文件；恢复服务后重试只会查询已有 review。若持续没有结果，先核实服务器 review 列表和日志，再由维护者决定是否清除错误中给出的那一个提交意图文件。不要批量删除状态后自动重发。
- `GITEA_API_TIMEOUT_MS` 控制单次 API 超时，默认 30000。

## 保留或停止环境

测试会保留生成的仓库和 PR，方便在网页中查看。可随时停止服务并保留数据：

```bash
docker compose -f tests/integration/compose.yaml stop
```

再次启动使用 `up -d`。仅在确认不再需要本地测试数据时使用 `down -v` 删除本测试项目的 volumes。
