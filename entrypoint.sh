#!/bin/bash
#
# OpenCode Review Docker Entrypoint
# Handles environment configuration and user config mounting
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Actions container jobs check out to $GITHUB_WORKSPACE (/workspace/<owner>/<repo>);
# local runs mount the project at /workspace.
WORKSPACE_DIR="${OPENCODE_REVIEW_WORKSPACE:-${GITHUB_WORKSPACE:-/workspace}}"

# The workspace may hold pull request code. Configuration there defines the
# agent prompt, approval rules and executable tools, so it is used only when the
# workflow explicitly trusts it (for example, a checkout of the base branch).
trusts_workspace_config() {
    [ "${OPENCODE_REVIEW_TRUST_WORKSPACE_CONFIG:-false}" = "true" ]
}

is_in_workspace() {
    local path root resolved
    path="$(cd "$1" 2>/dev/null && pwd -P)" || return 1
    for root in "$WORKSPACE_DIR" /workspace "${GITHUB_WORKSPACE:-}"; do
        [ -n "$root" ] || continue
        resolved="$(cd "$root" 2>/dev/null && pwd -P)" || continue
        [[ "$path" == "$resolved" || "$path" == "$resolved"/* ]] && return 0
    done
    return 1
}

setup_config() {
    # Honor pre-set OPENCODE_CONFIG_DIR (guard runs FIRST)
    if [ -n "$OPENCODE_CONFIG_DIR" ] && [ -d "$OPENCODE_CONFIG_DIR" ] && [ "$OPENCODE_CONFIG_DIR" != "/app/.opencode-review" ]; then
        if ! is_in_workspace "$OPENCODE_CONFIG_DIR" || trusts_workspace_config; then
            log_info "Using OPENCODE_CONFIG_DIR=$OPENCODE_CONFIG_DIR (user-prescribed)"
            export OPENCODE_CONFIG_DIR
            return 0
        fi
        log_warn "Ignoring OPENCODE_CONFIG_DIR=$OPENCODE_CONFIG_DIR inside the workspace; set OPENCODE_REVIEW_TRUST_WORKSPACE_CONFIG=true only for trusted checkouts"
    fi

    if [ -d "$WORKSPACE_DIR/.opencode-review" ]; then
        if trusts_workspace_config; then
            log_info "Using trusted custom config from $WORKSPACE_DIR/.opencode-review"
            export OPENCODE_CONFIG_DIR="$WORKSPACE_DIR/.opencode-review"
            if [ -f "$OPENCODE_CONFIG_DIR/package.json" ]; then
                log_info "Installing custom tool dependencies..."
                (
                    cd "$OPENCODE_CONFIG_DIR" || exit 1
                    bun install 2>/dev/null || echo "[WARN] Failed to install custom dependencies"
                )
            fi
            return 0
        fi
        log_warn "Ignoring $WORKSPACE_DIR/.opencode-review: it may come from the pull request under review."
        log_warn "Set OPENCODE_REVIEW_TRUST_WORKSPACE_CONFIG=true only when the workspace is a trusted checkout."
    fi

    log_info "Using built-in config from /app/.opencode-review"
    export OPENCODE_CONFIG_DIR="/app/.opencode-review"
}

# Validate required environment variables
validate_env() {
    local missing=()
    
    # Check for API token
    if [ -z "$GITEA_TOKEN" ] && [ -z "$GITHUB_TOKEN" ]; then
        missing+=("GITEA_TOKEN or GITHUB_TOKEN")
    fi
    
    # Check for server URL
    if [ -z "$GITEA_SERVER_URL" ] && [ -z "$GITHUB_SERVER_URL" ]; then
        missing+=("GITEA_SERVER_URL or GITHUB_SERVER_URL")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        log_error "Missing required environment variables:"
        for var in "${missing[@]}"; do
            echo "  - $var"
        done
        exit 1
    fi

    # Warn if no LLM API key is set (not fatal - some providers don't need one)
    if [ -z "$DEEPSEEK_API_KEY" ] && [ -z "$ANTHROPIC_API_KEY" ] && \
       [ -z "$OPENAI_API_KEY" ] && [ -z "$LLM_API_KEY" ] && \
       [ -z "$OPENROUTER_API_KEY" ] && [ -z "$OPENAI_BASE_URL" ]; then
        log_warn "No LLM API key detected (DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, LLM_API_KEY, OPENROUTER_API_KEY)"
        log_warn "If you are using a local model or custom gateway, you can ignore this warning"
        log_warn "For custom gateways (9router, LiteLLM, etc.), add a custom provider to .opencode-review/opencode.json; OPENAI_BASE_URL alone only works for OpenAI catalog models — use a custom provider for non-catalog model ids"
    fi
    
    log_success "Environment validated"
    log_warn "Note: GITEA_TOKEN must have 'write:repository' scope to submit reviews"
}

infer_gitea_server_url() {
    # Normalize: remove trailing slashes and /api/v1 suffix
    if [ -n "$GITEA_SERVER_URL" ]; then
        export GITEA_SERVER_URL="${GITEA_SERVER_URL%/}"
        export GITEA_SERVER_URL="${GITEA_SERVER_URL%/api/v1}"
        return 0
    fi

    if [ -n "$GITHUB_SERVER_URL" ]; then
        export GITEA_SERVER_URL="${GITHUB_SERVER_URL%/}"
        export GITEA_SERVER_URL="${GITEA_SERVER_URL%/api/v1}"
        return 0
    fi

    # Best-effort inference from git remote when running locally with -v $(pwd):/workspace
    if [ -d "/workspace/.git" ]; then
        local remote
        remote=$(git -C /workspace remote get-url origin 2>/dev/null || true)

        if [[ "$remote" =~ ^https?:// ]]; then
            local host
            host=$(echo "$remote" | sed -E 's#^(https?://[^/]+).*#\1#')
            if [ -n "$host" ]; then
                export GITEA_SERVER_URL="$host"
                log_info "Inferred GITEA_SERVER_URL from git remote: $GITEA_SERVER_URL"
                return 0
            fi
        fi

        # SSH-style: git@host:owner/repo.git -> assume https://host
        if [[ "$remote" =~ ^git@[^:]+: ]]; then
            local host
            host=$(echo "$remote" | sed -E 's#^git@([^:]+):.*#\1#')
            if [ -n "$host" ]; then
                export GITEA_SERVER_URL="https://$host"
                log_info "Inferred GITEA_SERVER_URL from git remote: $GITEA_SERVER_URL"
                return 0
            fi
        fi
    fi
}

normalize_repo_context() {
    # Accept REPO_NAME as either "repo" or "owner/repo".
    if [ -n "$REPO_NAME" ] && [[ "$REPO_NAME" == */* ]]; then
        local owner_part="${REPO_NAME%%/*}"
        local repo_part="${REPO_NAME#*/}"

        if [ -z "$REPO_OWNER" ]; then
            export REPO_OWNER="$owner_part"
            export REPO_NAME="$repo_part"
            return 0
        fi

        if [ "$owner_part" = "$REPO_OWNER" ]; then
            export REPO_NAME="$repo_part"
            return 0
        fi
    fi
}

# Build the review prompt based on environment
build_prompt() {
    local pr_num="${PR_NUMBER:-}"
    local repo_owner="${REPO_OWNER:-}"
    local repo_name="${REPO_NAME:-}"
    
    local prompt="Review"
    
    if [ -n "$pr_num" ]; then
        prompt="$prompt PR #$pr_num"
    fi
    
    if [ -n "$repo_owner" ] && [ -n "$repo_name" ]; then
        prompt="$prompt in $repo_owner/$repo_name"
    fi
    
    prompt="$prompt."
    
    # Add style instructions
    case "${REVIEW_STYLE:-balanced}" in
        concise)
            prompt="$prompt Focus only on critical issues, be concise."
            ;;
        thorough)
            prompt="$prompt Provide thorough analysis including best practices and improvements."
            ;;
        security)
            prompt="$prompt Focus on security vulnerabilities and potential risks."
            ;;
        *)
            prompt="$prompt Provide balanced feedback on bugs, security, and code quality."
            ;;
    esac
    
    # Add language preference
    case "${REVIEW_LANGUAGE:-auto}" in
        zh-CN|zh)
            prompt="$prompt 请使用简体中文回复。"
            ;;
        en)
            prompt="$prompt Reply in English."
            ;;
        # auto: let the model decide based on code content
    esac
    
    # Add file filter instructions
    if [ -n "$FILE_PATTERNS" ]; then
        prompt="$prompt Only review files matching: $FILE_PATTERNS."
    fi
    
    echo "$prompt"
}

# Print configuration summary
print_config() {
    log_info "Configuration:"
    echo "  Model:    ${MODEL:-deepseek/deepseek-chat}"
    echo "  Mode:     ${REVIEW_MODE:-submit}"
    echo "  Style:    ${REVIEW_STYLE:-balanced}"
    echo "  Template: ${REVIEW_TEMPLATE:-from REVIEW_STYLE}"
    echo "  Rules:    ${REVIEW_RULES:-auto (.gitea/review-rules*, .forgejo/review-rules*)}"
    echo "  Language: ${REVIEW_LANGUAGE:-auto}"
    echo "  Server:   ${GITEA_SERVER_URL:-${GITHUB_SERVER_URL:-}}"
    echo "  Config:   $OPENCODE_CONFIG_DIR"
    if [ -n "$FILE_PATTERNS" ]; then
        echo "  Filter:   $FILE_PATTERNS"
    fi
    if [ -n "$PR_NUMBER" ]; then
        echo "  PR:       #$PR_NUMBER"
    fi
    if [ -n "$REPO_OWNER" ] && [ -n "$REPO_NAME" ]; then
        echo "  Repo:     $REPO_OWNER/$REPO_NAME"
    fi
}

check_architecture() {
    # The image is published for linux/amd64 and linux/arm64.
    case "$(uname -m)" in
        x86_64|amd64|aarch64|arm64) return 0 ;;
    esac
    if ! opencode --version >/dev/null 2>&1; then
        log_error "The opencode binary does not run on $(uname -m)"
        log_error "Use the source installation method instead: https://github.com/ccsert/opencode-review-gitea#installation"
        exit 1
    fi
}

# Refresh the catalog before selecting a model. Keep cached models usable offline.
refresh_models() {
    if [ "${OPENCODE_REFRESH_MODELS:-true}" = "false" ]; then
        return 0
    fi

    log_info "Refreshing models cache..."
    if ! opencode models --refresh >/dev/null; then
        log_warn "Failed to refresh models; continuing with the cached model catalog"
    fi
}

# Main entrypoint
main() {
    local command="${1:-review}"
    shift || true
    
    case "$command" in
        review)
            check_architecture
            setup_config
            infer_gitea_server_url
            normalize_repo_context
            validate_env
            print_config
            refresh_models
            
            local prompt
            if [ -n "$1" ]; then
                prompt="$*"
            else
                prompt=$(build_prompt)
            fi
            
            log_info "Running code review..."
            local runner="/app/.opencode-review/run-review.ts"
            if [ ! -f "$runner" ]; then
                runner="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.opencode-review/run-review.ts"
            fi
            exec bun "$runner" "$prompt"
            ;;
            
        shell|bash|sh)
            log_info "Starting interactive shell..."
            exec /bin/bash
            ;;
            
        version|--version|-v)
            opencode --version
            ;;
            
        help|--help|-h)
            echo "OpenCode Review for Gitea/Forgejo"
            echo ""
            echo "Usage: docker run ghcr.io/ccsert/opencode-review [command]"
            echo ""
            echo "Commands:"
            echo "  review [prompt]  Run code review (default)"
            echo "  shell            Start interactive shell"
            echo "  version          Show version"
            echo "  help             Show this help"
            echo ""
            echo "Environment Variables:"
            echo "  GITEA_TOKEN        Gitea API token (required)"
            echo "  GITEA_SERVER_URL   Base URL like https://gitea.example.com (required)"
            echo ""
            echo "  LLM API Keys (at least one recommended):"
            echo "  DEEPSEEK_API_KEY   DeepSeek API key"
            echo "  ANTHROPIC_API_KEY  Anthropic API key"
            echo "  OPENAI_API_KEY     OpenAI API key"
            echo "  LLM_API_KEY        Generic API key for other providers"
            echo "  OPENROUTER_API_KEY OpenRouter API key"
            echo ""
            echo "  LLM Gateway (for LiteLLM, OpenRouter, Together AI, etc.):"
            echo "  OPENAI_BASE_URL    Custom API base URL (e.g., http://localhost:4000/v1)"
            echo ""
            echo "  MODEL              AI model (default: deepseek/deepseek-chat)"
            echo "  OPENCODE_REFRESH_MODELS  Refresh model catalog before review (default: true; false to skip)"
            echo "  OPENCODE_REVIEW_TRUST_WORKSPACE_CONFIG  Use .opencode-review from the workspace (default: false)."
            echo "                     Enable only when the workspace is a trusted checkout, never PR code."
            echo "  REVIEW_LANGUAGE    auto|en|zh-CN (default: auto)"
            echo "  REVIEW_MODE        submit|draft (default: submit). Draft saves PENDING; human submits."
            echo "  REVIEW_OUTPUT_DIR  Persistent draft output directory; mount it to retain summaries and state."
            echo "  REVIEW_STYLE       concise|balanced|thorough|security (default: balanced)"
            echo "  REVIEW_TEMPLATE    standard|concise|thorough|security|performance|compliance, or a path/URL"
            echo "                     (default: derived from REVIEW_STYLE)"
            echo "  REVIEW_RULES       Team standards, comma-separated: repository paths (read from the PR"
            echo "                     base commit), owner/repo:path[@ref], or URLs; 'none' disables"
            echo "                     (default: .gitea/review-rules[.md] and .forgejo/review-rules[.md])"
            echo "  REVIEW_RULES_MAX_BYTES   Size limit of applicable standards (default: 30000)"
            echo "  REVIEW_DIFF_PAGE_BYTES   Diff output page size (default: 40000)"
            echo "  FILE_PATTERNS      Glob patterns to filter files (e.g., '*.ts,*.go')"
            echo "  PR_NUMBER          PR number to review"
            echo "  REPO_OWNER         Repository owner"
            echo "  REPO_NAME          Repository name"
            ;;
            
        *)
            # Pass through to opencode
            exec opencode "$command" "$@"
            ;;
    esac
}

main "$@"
