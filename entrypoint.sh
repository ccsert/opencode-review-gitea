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

# Check for user-mounted custom config
setup_config() {
    # Honor pre-set OPENCODE_CONFIG_DIR (guard runs FIRST)
    if [ -n "$OPENCODE_CONFIG_DIR" ] && [ -d "$OPENCODE_CONFIG_DIR" ]; then
        # Exclude built-in paths to prevent loops/fallback to built-in as per plan AC
        if [[ "$OPENCODE_CONFIG_DIR" != "/app/.opencode-review" && "$OPENCODE_CONFIG_DIR" != "/workspace/.opencode-review" ]]; then
            log_info "Using OPENCODE_CONFIG_DIR=$OPENCODE_CONFIG_DIR (user-prescribed)"
            export OPENCODE_CONFIG_DIR
            return 0
        fi
    fi
    
    # Fall back to /workspace/.opencode-review for workspace-mounted config
    if [ -d "/workspace/.opencode-review" ]; then
        log_info "Using custom config from /workspace/.opencode-review"
        export OPENCODE_CONFIG_DIR="/workspace/.opencode-review"
        
        # Install dependencies if package.json exists
        if [ -f "/workspace/.opencode-review/package.json" ]; then
            log_info "Installing custom tool dependencies..."
            # Use subshell to avoid directory stack issues
            (
                cd /workspace/.opencode-review || exit 1
                bun install 2>/dev/null || echo "[WARN] Failed to install custom dependencies"
            )
        fi
        return 0
    fi
    
    # Fall back to built-in config
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
    echo "  Style:    ${REVIEW_STYLE:-balanced}"
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
    local arch
    arch=$(uname -m)
    if [ "$arch" != "x86_64" ] && [ "$arch" != "amd64" ]; then
        log_warn "Detected architecture: $arch (opencode-ai binary may not be supported)"
        log_warn "If you encounter errors, please use the source installation method:"
        log_warn "  https://github.com/ccsert/opencode-review-gitea#installation"
        # Verify opencode binary actually works
        if ! opencode --version >/dev/null 2>&1; then
            log_error "opencode binary is not compatible with $arch architecture"
            log_error "The pre-built Docker image only supports x86_64/amd64"
            log_error "Please use the source installation method instead (--source)"
            exit 1
        fi
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
            
            local prompt
            if [ -n "$1" ]; then
                prompt="$*"
            else
                prompt=$(build_prompt)
            fi
            
            log_info "Running code review..."
            exec opencode run --agent code-review "$prompt"
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
            echo "  REVIEW_LANGUAGE    auto|en|zh-CN (default: auto)"
            echo "  REVIEW_STYLE       concise|balanced|thorough|security (default: balanced)"
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
