#!/bin/bash
#
# OpenCode Gitea Review - Installation Script
# Installs the Gitea/Forgejo PR code review tool to your project
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash
#
# This script installs to .opencode-review/ directory (NOT .opencode/)
# to avoid conflicts with your existing OpenCode configuration.
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Repository URL
REPO_URL="https://github.com/ccsert/opencode-review-gitea"

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if in a git repository
check_git_repo() {
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        log_error "Current directory is not a git repository"
        echo "Please run this script in your project root directory"
        exit 1
    fi
}

# Get project root
get_project_root() {
    git rev-parse --show-toplevel
}

# Check dependencies
check_dependencies() {
    if ! command -v git &> /dev/null; then
        log_error "git is required but not installed"
        exit 1
    fi
    
    if ! command -v bun &> /dev/null; then
        log_warn "bun not found, attempting to install..."
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
    fi
}

# Temporary directory
TMP_DIR=$(mktemp -d)

# Download repository
download_repo() {
    log_info "Downloading opencode-review-gitea..."
    
    if command -v git &> /dev/null; then
        git clone --depth 1 "$REPO_URL.git" "$TMP_DIR/repo" 2>/dev/null || {
            log_warn "Git clone failed, trying tarball..."
            curl -fsSL "$REPO_URL/archive/main.tar.gz" | tar -xz -C "$TMP_DIR"
            mv "$TMP_DIR/opencode-review-gitea-main" "$TMP_DIR/repo"
        }
    else
        curl -fsSL "$REPO_URL/archive/main.tar.gz" | tar -xz -C "$TMP_DIR"
        mv "$TMP_DIR/opencode-review-gitea-main" "$TMP_DIR/repo"
    fi
}

# Install files
install_files() {
    local project_root="$1"
    local source_dir="$TMP_DIR/repo"
    
    log_info "Installing to $project_root..."
    
    # Install .opencode-review directory (isolated from user's .opencode)
    local target_dir="$project_root/.opencode-review"
    
    if [ -d "$target_dir" ]; then
        log_warn ".opencode-review already exists"
        read -p "Overwrite? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Skipping .opencode-review installation"
        else
            rm -rf "$target_dir"
            cp -r "$source_dir/.opencode-review" "$target_dir"
            log_success "Installed .opencode-review/"
        fi
    else
        cp -r "$source_dir/.opencode-review" "$target_dir"
        log_success "Installed .opencode-review/"
    fi
    
    # Install Gitea Actions workflow
    mkdir -p "$project_root/.gitea/workflows"
    local workflow_target="$project_root/.gitea/workflows/opencode-review.yaml"
    
    if [ -f "$workflow_target" ]; then
        log_warn "Workflow already exists: .gitea/workflows/opencode-review.yaml"
        read -p "Overwrite? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            cp "$source_dir/.gitea/workflows/opencode-review.yaml" "$workflow_target"
            log_success "Updated workflow: .gitea/workflows/opencode-review.yaml"
        fi
    else
        cp "$source_dir/.gitea/workflows/opencode-review.yaml" "$workflow_target"
        log_success "Installed workflow: .gitea/workflows/opencode-review.yaml"
    fi
}

# Install npm dependencies
install_dependencies() {
    local project_root="$1"
    
    log_info "Installing npm dependencies..."
    cd "$project_root/.opencode-review"
    bun install
    cd - > /dev/null
}

# Cleanup
cleanup() {
    rm -rf "$TMP_DIR"
}

# Print next steps
print_next_steps() {
    echo ""
    echo -e "${GREEN}✅ Installation complete!${NC}"
    echo ""
    echo "📋 Next steps:"
    echo ""
    echo "1. Configure Gitea Secrets:"
    echo "   - OPENCODE_GIT_TOKEN: Your Gitea API Token"
    echo "   - DEEPSEEK_API_KEY: Your LLM API Key (or other provider)"
    echo ""
    echo "2. Commit changes:"
    echo "   git add .opencode-review .gitea"
    echo "   git commit -m 'Add OpenCode Gitea Review'"
    echo "   git push"
    echo ""
    echo "3. Use /oc or /opencode in PR comments to trigger review"
    echo ""
    echo "📚 Docs: https://github.com/ccsert/opencode-review-gitea"
    echo ""
    echo -e "${BLUE}ℹ️  Isolation:${NC} Uses OPENCODE_CONFIG_DIR environment variable"
    echo "   to load from .opencode-review/ (won't affect your .opencode/)"
    echo "   See: https://opencode.ai/docs/config/#custom-directory"
    echo ""
}

# Main function
main() {
    echo ""
    echo "╔══════════════════════════════════════════════════╗"
    echo "║   OpenCode Gitea Review - Installation Script    ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo ""
    
    check_git_repo
    local project_root=$(get_project_root)
    
    log_info "Project root: $project_root"
    
    # Check if .opencode exists
    if [ -d "$project_root/.opencode" ]; then
        log_info "Detected existing .opencode/ directory"
        log_info "Installing to separate .opencode-review/ directory to avoid conflicts"
    fi
    
    check_dependencies
    download_repo
    install_files "$project_root"
    install_dependencies "$project_root"
    cleanup
    print_next_steps
}

# Error handling
trap cleanup EXIT

main "$@"
