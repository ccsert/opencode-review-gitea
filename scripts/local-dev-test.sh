#!/bin/bash
# 本地开发环境完整测试流程
#
# 使用方法: ./scripts/local-dev-test.sh

set -e

SERVER_URL=${SERVER_URL:-http://localhost:3000}
API_URL="${SERVER_URL}/api/v1"

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║        🚀 OpenCode Review Platform - 本地测试              ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# 检查服务器
echo "1️⃣  检查服务器状态..."
if ! curl -s "${SERVER_URL}/" > /dev/null 2>&1; then
    echo "❌ 服务器未运行！"
    echo ""
    echo "请在另一个终端运行:"
    echo "  cd packages/server && bun run dev"
    echo ""
    exit 1
fi
echo "   ✅ 服务器运行中"
echo ""

# 检查健康状态
echo "2️⃣  API 健康检查..."
HEALTH=$(curl -s "${SERVER_URL}/")
echo "   ${HEALTH}" | head -c 100
echo ""
echo ""

# 创建测试仓库
echo "3️⃣  创建测试仓库..."
REPO_RESPONSE=$(curl -s -X POST "${API_URL}/repositories" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-owner/test-repo",
    "url": "https://gitea.com/test-owner/test-repo",
    "provider": "gitea",
    "accessToken": "test-token-for-local-dev"
  }' 2>&1) || true

echo "   响应: ${REPO_RESPONSE}" | head -c 200
echo ""
echo ""

# 提取仓库 ID
REPO_ID=$(echo "${REPO_RESPONSE}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "${REPO_ID}" ]; then
    echo "   ⚠️  无法获取仓库 ID，尝试从现有仓库获取..."
    
    # 获取仓库列表
    REPOS=$(curl -s "${API_URL}/repositories")
    echo "   现有仓库: ${REPOS}" | head -c 200
    echo ""
fi

# 发送测试 Webhook
echo "4️⃣  发送测试 Webhook..."

WEBHOOK_PAYLOAD=$(cat <<'EOF'
{
  "action": "opened",
  "number": 1,
  "pull_request": {
    "id": 1,
    "number": 1,
    "title": "test: webhook integration test",
    "body": "Testing webhook to ReviewEngine integration",
    "state": "open",
    "user": { "id": 1, "login": "tester" },
    "base": { "ref": "main", "sha": "abc123" },
    "head": { "ref": "test-branch", "sha": "def456" },
    "html_url": "https://gitea.com/test/repo/pulls/1"
  },
  "repository": {
    "id": 1,
    "name": "test-repo",
    "full_name": "test-owner/test-repo"
  },
  "sender": { "id": 1, "login": "tester" }
}
EOF
)

if [ -n "${REPO_ID}" ]; then
    WEBHOOK_RESPONSE=$(curl -s -X POST "${API_URL}/webhooks/gitea/${REPO_ID}" \
      -H "Content-Type: application/json" \
      -H "X-Gitea-Event: pull_request" \
      -H "X-Gitea-Delivery: local-test-$(date +%s)" \
      -d "${WEBHOOK_PAYLOAD}")
    
    echo "   响应: ${WEBHOOK_RESPONSE}"
else
    echo "   ⚠️  跳过 Webhook 测试（需要有效的仓库 ID）"
fi
echo ""

# 查看 Reviews
echo "5️⃣  查看 Review 记录..."
REVIEWS=$(curl -s "${API_URL}/reviews?limit=5")
echo "   ${REVIEWS}" | head -c 500
echo ""
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "✅ 测试完成！"
echo ""
echo "📋 下一步:"
echo "   - 检查服务器日志查看 Review 执行详情"
echo "   - 配置真实的 Gitea Token 进行实际测试"
echo "   - 配置 OPENCODE_* 环境变量启用 AI 审查"
echo "═══════════════════════════════════════════════════════════"
