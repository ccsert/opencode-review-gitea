# Webhook 管理指南

## 概述

OpenCode Gitea Review 现在支持通过实时查询 Gitea API 来进行全面的 Webhook 管理。本指南说明如何使用 Webhook 管理功能。

## 功能特性

- **实时查询**：始终从 Gitea API 获取当前 Webhook 状态
- **无数据库持久化**：按需查询 Webhook，不进行本地存储
- **手动和自动创建检测**：显示平台创建和用户手动配置的 Webhook
- **国际化**：完整支持中文和英文
- **令牌错误预防**：提供清晰的错误消息和解决步骤

## 架构设计

Webhook 管理系统使用：
- **直接 API 查询**：所有 Webhook 信息实时来自 Gitea API
- **无缓存**：每次请求都是新数据（支持手动刷新）
- **正确的令牌处理**：验证令牌可用性和权限
- **国际化支持**：所有消息根据 REVIEW_LANGUAGE 设置翻译

## 可用工具

### 1. 列出 Webhook (`gitea-webhook-list`)

列出仓库的所有 Webhook 配置。

**用法：**
```typescript
{
  owner: "your-org",
  repo: "your-repo"
}
```

**响应：**
- 显示所有 Webhook，包含 ID、URL、状态、事件和时间戳
- 包括活跃和非活跃的 Webhook
- 显示平台创建和用户手动配置的 Webhook

**使用场景：**
- 在仓库管理界面查看所有 Webhook
- 检查 Webhook 是否在 Gitea 中被删除
- 验证手动配置的 Webhook
- 手动刷新 Webhook 状态

### 2. 创建 Webhook (`gitea-webhook-create`)

为仓库创建新的 Webhook。

**用法：**
```typescript
{
  owner: "your-org",
  repo: "your-repo",
  url: "https://example.com/webhook",
  content_type: "json",  // 或 "form"
  secret: "可选的密钥",  // 推荐使用以提高安全性
  events: ["push", "pull_request"],  // 触发 Webhook 的事件
  active: true  // Webhook 是否激活
}
```

**常用事件：**
- `push`：代码推送到仓库
- `pull_request`：PR 打开、关闭或更新
- `pull_request_comment`：PR 评论
- `issue_comment`：Issue 评论
- `issues`：Issue 打开、关闭或更新
- `create`：分支或标签创建
- `delete`：分支或标签删除

**最佳实践：**
- 始终使用密钥进行 Webhook 签名验证
- 从特定事件开始，而不是订阅所有事件
- 先用 inactive: false 测试 Webhook

### 3. 删除 Webhook (`gitea-webhook-delete`)

从仓库删除 Webhook。

**用法：**
```typescript
{
  owner: "your-org",
  repo: "your-repo",
  webhook_id: 123
}
```

**修复令牌错误：**
此工具专门解决"仓库未配置访问令牌"错误：
1. 验证 OPENCODE_GIT_TOKEN 已配置
2. 验证令牌具有所需权限
3. 删除前检查 Webhook 是否存在
4. 提供清晰的错误消息和解决步骤

**所需权限：**
- 令牌必须具有 `write:repository` 或 `admin:repo_hook` 权限
- 令牌必须配置为 `OPENCODE_GIT_TOKEN` 密钥
- 令牌不能过期

**常见错误及解决方案：**

1. **"仓库未配置访问令牌"**
   - 在仓库设置中配置 `OPENCODE_GIT_TOKEN` 密钥
   - 确保密钥正确保存

2. **"访问令牌无效或已过期"**
   - 在 Gitea 中生成新令牌
   - 更新 `OPENCODE_GIT_TOKEN` 密钥

3. **"权限不足"**
   - 令牌需要 `write:repository` 权限
   - 用正确权限重新生成令牌

4. **"Webhook 不存在"**
   - Webhook 已删除或 ID 不正确
   - 先列出 Webhook 以验证 ID

### 4. 更新 Webhook (`gitea-webhook-update`)

更新现有 Webhook 而无需删除它。

**用法：**
```typescript
{
  owner: "your-org",
  repo: "your-repo",
  webhook_id: 123,
  url: "https://new-url.com/webhook",  // 可选
  content_type: "json",  // 可选
  secret: "新密钥",  // 可选
  events: ["push"],  // 可选
  active: false  // 可选 - 切换开关
}
```

**部分更新：**
- 只需指定要更改的字段
- 未指定的字段保持不变
- 获取当前配置并合并更改

**使用场景：**
- 临时开关 Webhook
- 服务迁移时更新 URL
- 添加或更改密钥
- 修改事件订阅

## Webhook 管理 Agent

`webhook-manager` Agent 提供交互式 Webhook 管理界面。

**功能：**
- 自然语言 Webhook 命令
- 自动错误恢复
- 有用的配置指导
- 支持中文和英文

**示例交互：**

中文：
```
用户：列出 myorg/myrepo 的所有 webhook
助手：[使用 gitea-webhook-list 并显示结果]

用户：删除 webhook ID 123
助手：[使用 gitea-webhook-delete，处理令牌错误并提供指导]
```

英文：
```
User: List all webhooks for myorg/myrepo
Agent: [uses gitea-webhook-list and shows results]

User: Delete webhook ID 123
Agent: [uses gitea-webhook-delete, handles any token errors with guidance]
```

## 国际化

所有 Webhook 工具通过 `REVIEW_LANGUAGE` 环境变量支持国际化。

**配置：**

```yaml
env:
  REVIEW_LANGUAGE: auto  # 从系统区域设置自动检测
  # REVIEW_LANGUAGE: en     # 强制英文
  # REVIEW_LANGUAGE: zh-CN  # 强制中文
```

**支持的语言：**
- 英文 (en)
- 简体中文 (zh-CN)

**翻译内容：**
- 成功消息
- 错误消息
- 状态标签（活跃/未激活）
- 确认提示
- 帮助文本

## 实时查询设计

### 为什么不用数据库？

1. **始终是最新的**：显示 Gitea 的真实状态，而非缓存数据
2. **检测手动更改**：查找用户直接在 Gitea 中创建的 Webhook
3. **更简单的架构**：无需数据库同步、迁移或一致性问题
4. **用户控制**：手动刷新让用户明确控制

### 工作原理

1. 用户请求 Webhook 列表
2. 工具直接查询 Gitea API
3. Gitea 返回当前 Webhook 状态
4. 工具格式化并显示结果
5. 不在本地存储数据

### 缓存策略

- **无自动缓存**：每次请求都是新数据
- **用户发起刷新**：用户可随时刷新
- **基于会话**：Agent 可在对话期间缓存
- **无持久化**：会话间清除缓存

## 安全最佳实践

### 令牌管理

1. **使用仓库密钥**
   - 将 `OPENCODE_GIT_TOKEN` 存储为密钥，不要写在代码中
   - 永远不要将令牌提交到仓库
   - 定期轮换令牌

2. **最小权限**
   - Webhook 使用 `write:repository` 权限
   - 除非必要，不要使用管理员令牌
   - 为不同目的创建单独的令牌

3. **令牌验证**
   - 所有工具验证令牌存在
   - 操作前检查权限
   - 提供令牌问题的清晰指导

### Webhook 安全

1. **始终使用密钥**
   - 设置 Webhook 密钥进行签名验证
   - 使用强且唯一的密钥
   - 定期轮换密钥

2. **仅 HTTPS**
   - Webhook 使用 HTTPS URL
   - 生产环境不接受自签名证书
   - 验证 SSL/TLS

3. **事件过滤**
   - 只订阅需要的事件
   - 除非必要，不要使用通配符 (*) 事件
   - 定期审查事件列表

## 故障排除

### Webhook 未显示在列表中

**可能原因：**
1. Webhook 在 Gitea UI 中被删除
2. 令牌缺少读取权限
3. 仓库名称错误

**解决方案：**
1. 直接检查 Gitea UI
2. 验证令牌有仓库访问权限
3. 仔细检查 owner/repo 参数

### 无法删除 Webhook

**可能原因：**
1. `OPENCODE_GIT_TOKEN` 未配置
2. 令牌缺少写入权限
3. 令牌过期

**解决方案：**
1. 在仓库设置中配置密钥
2. 用 `write:repository` 权限生成新令牌
3. 在密钥中更新令牌

### Webhook 未触发

**可能原因：**
1. Webhook 未激活
2. 事件不匹配
3. URL 无法访问
4. 密钥不匹配

**解决方案：**
1. 用 `gitea-webhook-list` 检查 Webhook 激活状态
2. 验证事件包含您期望的操作
3. 独立测试 Webhook URL
4. 验证两个系统中的密钥匹配

## 示例

### 完整的 Webhook 生命周期

```typescript
// 1. 列出现有 webhook
const list = await giteaWebhookList({
  owner: "myorg",
  repo: "myrepo"
})

// 2. 创建新 webhook
const create = await giteaWebhookCreate({
  owner: "myorg",
  repo: "myrepo",
  url: "https://example.com/webhook",
  content_type: "json",
  secret: "我的密钥",
  events: ["push", "pull_request"],
  active: true
})

// 3. 更新 webhook
const update = await giteaWebhookUpdate({
  owner: "myorg",
  repo: "myrepo",
  webhook_id: 123,
  active: false  // 临时禁用
})

// 4. 重新启用 webhook
const enable = await giteaWebhookUpdate({
  owner: "myorg",
  repo: "myrepo",
  webhook_id: 123,
  active: true
})

// 5. 不再需要时删除 webhook
const deleted = await giteaWebhookDelete({
  owner: "myorg",
  repo: "myrepo",
  webhook_id: 123
})
```

### 错误处理示例

```typescript
// 始终处理潜在错误
try {
  const result = await giteaWebhookDelete({
    owner: "myorg",
    repo: "myrepo",
    webhook_id: 123
  })
  console.log(result)
} catch (error) {
  if (error.message.includes("未配置访问令牌")) {
    console.log("请配置 OPENCODE_GIT_TOKEN 密钥")
    console.log("1. 进入仓库设置 → 密钥")
    console.log("2. 添加新密钥：OPENCODE_GIT_TOKEN")
    console.log("3. 在 Gitea 中生成令牌：设置 → 应用 → 生成新令牌")
    console.log("4. 令牌需要 'write:repository' 或 'admin:repo_hook' 权限")
    console.log("5. 将令牌保存为密钥值")
  } else if (error.message.includes("权限")) {
    console.log("令牌需要 write:repository 权限")
    console.log("在 Gitea 设置 → 应用中生成新令牌")
  } else {
    console.log("错误：", error.message)
  }
}
```

## API 参考

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `GITEA_TOKEN` | Gitea API 令牌 | 必需 |
| `GITEA_SERVER_URL` | Gitea 服务器 URL | 必需 |
| `REVIEW_LANGUAGE` | UI 语言 (auto\|en\|zh-CN) | `auto` |

### 工具架构

所有工具遵循 OpenCode 插件模式：

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "...",
  args: {
    // 工具特定的参数
  },
  async execute(args) {
    // 实现
  }
})
```

## 延伸阅读

- [Gitea Webhook 文档](https://docs.gitea.io/zh-cn/webhooks/)
- [Gitea API 参考](https://docs.gitea.io/zh-cn/api-usage/)
- [OpenCode 插件系统](https://opencode.ai/docs/custom-tools/)
- [Webhook 安全最佳实践](https://docs.github.com/zh/webhooks/using-webhooks/best-practices-for-using-webhooks)
