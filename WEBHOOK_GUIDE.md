# Webhook Management Guide

## Overview

OpenCode Gitea Review now supports comprehensive webhook management through real-time querying of the Gitea API. This guide explains how to use the webhook management features.

## Features

- **Real-time Querying**: Always fetches current webhook state from Gitea API
- **No Database Persistence**: Webhooks are queried on-demand, not stored locally
- **Manual & Auto-created Detection**: Shows both platform-created and manually configured webhooks
- **Internationalization**: Full support for English and Chinese
- **Token Error Prevention**: Clear error messages with resolution steps

## Architecture

The webhook management system uses:
- **Direct API Queries**: All webhook information comes from Gitea API in real-time
- **No Caching**: Fresh data on every request (supports manual refresh)
- **Proper Token Handling**: Validates token availability and permissions
- **i18n Support**: All messages translated based on REVIEW_LANGUAGE setting

## Available Tools

### 1. List Webhooks (`gitea-webhook-list`)

Lists all webhooks configured for a repository.

**Usage:**
```typescript
{
  owner: "your-org",
  repo: "your-repo"
}
```

**Response:**
- Shows all webhooks with ID, URL, status, events, and timestamps
- Includes both active and inactive webhooks
- Shows platform-created AND manually configured webhooks

**Use Cases:**
- View all webhooks in repository management interface
- Check if webhook was deleted in Gitea
- Verify manually configured webhooks
- Manual refresh of webhook status

### 2. Create Webhook (`gitea-webhook-create`)

Creates a new webhook for a repository.

**Usage:**
```typescript
{
  owner: "your-org",
  repo: "your-repo",
  url: "https://example.com/webhook",
  content_type: "json",  // or "form"
  secret: "optional-secret",  // recommended for security
  events: ["push", "pull_request"],  // which events trigger webhook
  active: true  // whether webhook is active
}
```

**Common Events:**
- `push`: Code pushed to repository
- `pull_request`: PR opened, closed, or updated
- `pull_request_comment`: Comments on PRs
- `issue_comment`: Comments on issues
- `issues`: Issue opened, closed, or updated
- `create`: Branch or tag created
- `delete`: Branch or tag deleted

**Best Practices:**
- Always use a secret for webhook signature validation
- Start with specific events rather than all events
- Test webhook with inactive: false first

### 3. Delete Webhook (`gitea-webhook-delete`)

Deletes a webhook from a repository.

**Usage:**
```typescript
{
  owner: "your-org",
  repo: "your-repo",
  webhook_id: 123
}
```

**Fixes Token Error:**
This tool specifically addresses the "Repository has no access token configured" error by:
1. Validating OPENCODE_GIT_TOKEN is configured
2. Verifying token has required permissions
3. Checking webhook exists before deletion
4. Providing clear error messages with resolution steps

**Required Permissions:**
- Token must have `write:repository` or `admin:repo_hook` scope
- Token must be configured as `OPENCODE_GIT_TOKEN` secret
- Token must not be expired

**Common Errors & Solutions:**

1. **"Repository has no access token configured"**
   - Configure `OPENCODE_GIT_TOKEN` secret in repository settings
   - Ensure secret is properly saved

2. **"Invalid or expired access token"**
   - Generate a new token in Gitea
   - Update the `OPENCODE_GIT_TOKEN` secret

3. **"Insufficient permissions"**
   - Token needs `write:repository` scope
   - Regenerate token with correct permissions

4. **"Webhook not found"**
   - Webhook already deleted or ID incorrect
   - List webhooks first to verify ID

### 4. Update Webhook (`gitea-webhook-update`)

Updates an existing webhook without deleting it.

**Usage:**
```typescript
{
  owner: "your-org",
  repo: "your-repo",
  webhook_id: 123,
  url: "https://new-url.com/webhook",  // optional
  content_type: "json",  // optional
  secret: "new-secret",  // optional
  events: ["push"],  // optional
  active: false  // optional - toggle on/off
}
```

**Partial Updates:**
- Only specify fields you want to change
- Unspecified fields remain unchanged
- Fetches current config and merges changes

**Use Cases:**
- Toggle webhook on/off temporarily
- Update URL when service moves
- Add or change secret
- Modify event subscriptions

## Webhook Manager Agent

The `webhook-manager` agent provides an interactive interface for webhook management.

**Features:**
- Natural language webhook commands
- Automatic error recovery
- Helpful guidance for configuration
- Supports both English and Chinese

**Example Interactions:**

English:
```
User: List all webhooks for myorg/myrepo
Agent: [uses gitea-webhook-list and shows results]

User: Delete webhook ID 123
Agent: [uses gitea-webhook-delete, handles any token errors with guidance]
```

Chinese:
```
用户：列出 myorg/myrepo 的所有 webhook
助手：[使用 gitea-webhook-list 并显示结果]

用户：删除 webhook ID 123
助手：[使用 gitea-webhook-delete，处理令牌错误并提供指导]
```

## Internationalization

All webhook tools support i18n through the `REVIEW_LANGUAGE` environment variable.

**Configuration:**

```yaml
env:
  REVIEW_LANGUAGE: auto  # auto-detect from system locale
  # REVIEW_LANGUAGE: en     # force English
  # REVIEW_LANGUAGE: zh-CN  # force Chinese
```

**Supported Languages:**
- English (en)
- Chinese Simplified (zh-CN)

**What's Translated:**
- Success messages
- Error messages
- Status labels (Active/Inactive)
- Confirmation prompts
- Help text

## Real-time Query Design

### Why No Database?

1. **Always Current**: Shows real state from Gitea, not cached data
2. **Detects Manual Changes**: Finds webhooks users created directly in Gitea
3. **Simpler Architecture**: No database sync, migration, or consistency issues
4. **User Control**: Manual refresh gives users explicit control

### How It Works

1. User requests webhook list
2. Tool queries Gitea API directly
3. Gitea returns current webhook state
4. Tool formats and displays results
5. No data stored locally

### Caching Strategy

- **No automatic caching**: Each request is fresh
- **User-initiated refresh**: Users can refresh anytime
- **Session-based**: Agent can cache during a conversation
- **No persistence**: Cache cleared between sessions

## Security Best Practices

### Token Management

1. **Use Repository Secrets**
   - Store `OPENCODE_GIT_TOKEN` as secret, not in code
   - Never commit tokens to repository
   - Rotate tokens periodically

2. **Minimum Permissions**
   - Use `write:repository` scope for webhooks
   - Don't use admin tokens unless necessary
   - Create separate tokens for different purposes

3. **Token Validation**
   - All tools validate token presence
   - Check permissions before operations
   - Provide clear guidance on token issues

### Webhook Security

1. **Always Use Secrets**
   - Set webhook secret for signature validation
   - Use strong, unique secrets
   - Rotate secrets periodically

2. **HTTPS Only**
   - Use HTTPS URLs for webhooks
   - Don't accept self-signed certificates in production
   - Validate SSL/TLS

3. **Event Filtering**
   - Subscribe only to needed events
   - Don't use wildcard (*) events unless necessary
   - Review event list regularly

## Troubleshooting

### Webhook Not Appearing in List

**Possible Causes:**
1. Webhook deleted in Gitea UI
2. Token lacks read permissions
3. Wrong repository name

**Solutions:**
1. Check Gitea UI directly
2. Verify token has repository access
3. Double-check owner/repo parameters

### Cannot Delete Webhook

**Possible Causes:**
1. `OPENCODE_GIT_TOKEN` not configured
2. Token lacks write permissions
3. Token expired

**Solutions:**
1. Configure secret in repository settings
2. Generate new token with `write:repository` scope
3. Update token in secrets

### Webhook Not Triggering

**Possible Causes:**
1. Webhook inactive
2. Event mismatch
3. URL unreachable
4. Secret mismatch

**Solutions:**
1. Check webhook active status with `gitea-webhook-list`
2. Verify events include the action you expect
3. Test webhook URL independently
4. Verify secret matches in both systems

## Examples

### Complete Webhook Lifecycle

```typescript
// 1. List existing webhooks
const list = await giteaWebhookList({
  owner: "myorg",
  repo: "myrepo"
})

// 2. Create new webhook
const create = await giteaWebhookCreate({
  owner: "myorg",
  repo: "myrepo",
  url: "https://example.com/webhook",
  content_type: "json",
  secret: "wh_3c8f9a2b1e7d4c5a8b9e6f0d2a1c3b5e",  // Use strong random secret
  events: ["push", "pull_request"],
  active: true
})

// 3. Update webhook
const update = await giteaWebhookUpdate({
  owner: "myorg",
  repo: "myrepo",
  webhook_id: 123,
  active: false  // temporarily disable
})

// 4. Re-enable webhook
const enable = await giteaWebhookUpdate({
  owner: "myorg",
  repo: "myrepo",
  webhook_id: 123,
  active: true
})

// 5. Delete webhook when no longer needed
const deleteResult = await giteaWebhookDelete({
  owner: "myorg",
  repo: "myrepo",
  webhook_id: 123
})
```

### Error Handling Example

```typescript
// Always handle potential errors
try {
  const result = await giteaWebhookDelete({
    owner: "myorg",
    repo: "myrepo",
    webhook_id: 123
  })
  console.log(result)
} catch (error) {
  if (error.message.includes("no access token")) {
    console.log("Please configure OPENCODE_GIT_TOKEN secret")
    console.log("1. Go to repository Settings → Secrets")
    console.log("2. Add OPENCODE_GIT_TOKEN with your Gitea token")
  } else if (error.message.includes("permission")) {
    console.log("Token needs write:repository scope")
    console.log("Generate new token in Gitea Settings → Applications")
  } else {
    console.log("Error:", error.message)
  }
}
```

## API Reference

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GITEA_TOKEN` | Gitea API token | Required |
| `GITEA_SERVER_URL` | Gitea server URL | Required |
| `REVIEW_LANGUAGE` | UI language (auto\|en\|zh-CN) | `auto` |

### Tool Schemas

All tools follow the OpenCode plugin pattern:

```typescript
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "...",
  args: {
    // tool-specific arguments
  },
  async execute(args) {
    // implementation
  }
})
```

## Further Reading

- [Gitea Webhook Documentation](https://docs.gitea.io/en-us/webhooks/)
- [Gitea API Reference](https://docs.gitea.io/en-us/api-usage/)
- [OpenCode Plugin System](https://opencode.ai/docs/custom-tools/)
- [Webhook Security Best Practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)
