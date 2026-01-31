#!/bin/bash
# 本地测试 Webhook → AI Review 流程
# 
# 使用方法:
#   1. 启动服务器: cd packages/server && bun run dev
#   2. 运行测试:   ./scripts/test-webhook.sh

set -e

# 配置
SERVER_URL=${SERVER_URL:-http://localhost:3000}
REPOSITORY_ID=${REPOSITORY_ID:-test-repo-id}
PROVIDER=${PROVIDER:-gitea}

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           🧪 Webhook 本地测试脚本                          ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# 1. 检查服务器是否运行
echo "📡 检查服务器状态..."
if ! curl -s "${SERVER_URL}/" > /dev/null 2>&1; then
    echo "❌ 服务器未运行！请先启动: cd packages/server && bun run dev"
    exit 1
fi
echo "✅ 服务器运行中: ${SERVER_URL}"
echo ""

# 2. 模拟 PR 打开事件
echo "📨 发送模拟 Webhook 事件 (PR 打开)..."
PAYLOAD=$(cat <<'EOF'
{
  "action": "opened",
  "number": 1,
  "pull_request": {
    "id": 1,
    "number": 1,
    "title": "feat: add new feature",
    "body": "This PR adds a new awesome feature.",
    "state": "open",
    "user": {
      "id": 1,
      "login": "test-user",
      "full_name": "Test User"
    },
    "base": {
      "ref": "main",
      "sha": "abc123"
    },
    "head": {
      "ref": "feature/new-feature",
      "sha": "def456"
    },
    "html_url": "http://localhost:3000/test/repo/pulls/1",
    "diff_url": "http://localhost:3000/test/repo/pulls/1.diff",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  },
  "repository": {
    "id": 1,
    "name": "repo",
    "full_name": "test/repo",
    "owner": {
      "id": 1,
      "login": "test"
    },
    "html_url": "http://localhost:3000/test/repo",
    "clone_url": "http://localhost:3000/test/repo.git"
  },
  "sender": {
    "id": 1,
    "login": "test-user"
  }
}
EOF
)

RESPONSE=$(curl -s -X POST \
  "${SERVER_URL}/api/v1/webhooks/${PROVIDER}/${REPOSITORY_ID}" \
  -H "Content-Type: application/json" \
  -H "X-Gitea-Event: pull_request" \
  -H "X-Gitea-Delivery: test-delivery-$(date +%s)" \
  -d "${PAYLOAD}")

echo "响应: ${RESPONSE}"
echo ""

# 检查响应
if echo "${RESPONSE}" | grep -q '"success":true'; then
    echo "✅ Webhook 接收成功！"
else
    echo "⚠️  Webhook 处理可能有问题，请检查服务器日志"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "💡 提示:"
echo "   - 查看服务器日志以跟踪 Review 执行进度"
echo "   - 确保已配置 OPENCODE_* 环境变量"
echo "   - 需要先通过 API 创建仓库记录才能正确处理"
echo "═══════════════════════════════════════════════════════════"
