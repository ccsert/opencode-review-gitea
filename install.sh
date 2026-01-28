#!/bin/bash
#
# OpenCode Gitea Review - Installation Script
# Installs the Gitea/Forgejo PR code review tool to your project
#
# Usage:
#   Interactive:  curl -fsSL https://raw.githubusercontent.com/ccsert/opencode-review-gitea/main/install.sh | bash
#   Docker only:  curl ... | bash -s -- --docker
#   Source only:  curl ... | bash -s -- --source
#
# Options:
#   --docker    Install Docker-based workflow only (recommended)
#   --source    Install source-based workflow with .opencode-review/
#   --both      Install both installation methods
#   --help      Show help message
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Repository URL
REPO_URL="https://github.com/ccsert/opencode-review-gitea"
DOCKER_IMAGE="ghcr.io/ccsert/opencode-review"

# Installation mode
INSTALL_MODE=""

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --docker) INSTALL_MODE="docker"; shift ;;
            --source) INSTALL_MODE="source"; shift ;;
            --both) INSTALL_MODE="both"; shift ;;
            --help|-h) show_help; exit 0 ;;
            *) log_error "Unknown option: $1"; show_help; exit 1 ;;
        esac
    done
}

show_help() {
    echo ""
    echo "OpenCode Gitea Review - Installation Script"
    echo ""
    echo "Usage:"
    echo "  curl -fsSL $REPO_URL/main/install.sh | bash [options]"
    echo ""
    echo "Options:"
    echo "  --docker    Install Docker-based workflow only (recommended)"
    echo "  --source    Install source-based workflow with .opencode-review/"
    echo "  --both      Install both installation methods"
    echo "  --help      Show this help message"
    echo ""
}

print_banner() {
    echo ""
    echo -e "${CYAN}+--------------------------------------------------------------+${NC}"
    echo -e "${CYAN}|${NC}     ${BOLD}OpenCode Gitea Review - AI-Powered Code Review${NC}          ${CYAN}|${NC}"
    echo -e "${CYAN}+--------------------------------------------------------------+${NC}"
    echo ""
}

select_install_mode() {
    echo -e "${BOLD}Select installation method:${NC}"
    echo ""
    echo -e "  ${GREEN}1)${NC} ${BOLD}Docker${NC} (Recommended)"
    echo "     - Zero files added to your repo (just 1 workflow file)"
    echo "     - Faster CI (pre-built image, no dependency installation)"
    echo "     - Automatic updates with :latest tag"
    echo ""
    echo -e "  ${BLUE}2)${NC} ${BOLD}Source${NC}"
    echo "     - Full control over agents, tools, and configuration"
    echo "     - Can customize review behavior"
    echo "     - Adds .opencode-review/ directory (~50KB)"
    echo ""
    echo -e "  ${YELLOW}3)${NC} ${BOLD}Both${NC}"
    echo "     - Install both methods (Docker workflow + source files)"
    echo "     - Docker workflow can mount local config for customization"
    echo ""
    
    while true; do
        read -p "Enter choice [1-3]: " choice
        case $choice in
            1) INSTALL_MODE="docker"; break ;;
            2) INSTALL_MODE="source"; break ;;
            3) INSTALL_MODE="both"; break ;;
            *) echo "Invalid choice. Please enter 1, 2, or 3." ;;
        esac
    done
    echo ""
}

check_git_repo() {
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        log_error "Current directory is not a git repository"
        echo "Please run this script in your project root directory"
        exit 1
    fi
}

get_project_root() { git rev-parse --show-toplevel; }

check_source_dependencies() {
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

TMP_DIR=$(mktemp -d)

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

install_docker_workflow() {
    local project_root="$1"
    local source_dir="$TMP_DIR/repo"
    log_info "Installing Docker-based workflow..."
    mkdir -p "$project_root/.gitea/workflows"
    local workflow_target="$project_root/.gitea/workflows/opencode-review.yaml"
    if [ -f "$workflow_target" ]; then
        log_warn "Workflow already exists"
        read -p "Overwrite with Docker version? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Skipping workflow installation"
            return
        fi
    fi
    cp "$source_dir/templates/workflow-docker.yaml" "$workflow_target"
    log_success "Installed Docker workflow: .gitea/workflows/opencode-review.yaml"
}

install_source_files() {
    local project_root="$1"
    local source_dir="$TMP_DIR/repo"
    log_info "Installing source files..."
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
            log_success "Updated .opencode-review/"
        fi
    else
        cp -r "$source_dir/.opencode-review" "$target_dir"
        log_success "Installed .opencode-review/"
    fi
}

install_source_workflow() {
    local project_root="$1"
    local source_dir="$TMP_DIR/repo"
    mkdir -p "$project_root/.gitea/workflows"
    local workflow_target="$project_root/.gitea/workflows/opencode-review.yaml"
    if [ -f "$workflow_target" ]; then
        log_warn "Workflow already exists"
        read -p "Overwrite with source version? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Skipping workflow installation"
            return
        fi
    fi
    cp "$source_dir/templates/workflow-source.yaml" "$workflow_target"
    log_success "Installed source workflow: .gitea/workflows/opencode-review.yaml"
}

install_dependencies() {
    local project_root="$1"
    if [ -d "$project_root/.opencode-review" ]; then
        log_info "Installing npm dependencies..."
        cd "$project_root/.opencode-review"
        bun install
        cd - > /dev/null
        log_success "Dependencies installed"
    fi
}

cleanup() { rm -rf "$TMP_DIR"; }

print_next_steps() {
    local mode="$1"
    echo ""
    echo -e "${GREEN}Installation complete!${NC}"
    echo ""
    echo -e "${BOLD}Next steps:${NC}"
    echo ""
    echo "1. Configure Gitea/Forgejo Secrets:"
    echo "   - OPENCODE_GIT_TOKEN: Your Gitea API Token"
    echo "   - DEEPSEEK_API_KEY: Your LLM API Key (default model)"
    echo ""
    if [ "$mode" = "docker" ] || [ "$mode" = "both" ]; then
        echo "2. Commit and push:"
        echo "   git add .gitea"
        echo "   git commit -m 'Add OpenCode AI Review (Docker)'"
        echo "   git push"
    fi
    if [ "$mode" = "source" ]; then
        echo "2. Commit and push:"
        echo "   git add .opencode-review .gitea"
        echo "   git commit -m 'Add OpenCode AI Review (Source)'"
        echo "   git push"
    fi
    echo ""
    echo "3. Trigger review by commenting /oc or /opencode on a PR"
    echo ""
    echo -e "${BOLD}Documentation:${NC} $REPO_URL"
    echo ""
    if [ "$mode" = "docker" ]; then
        echo -e "${BLUE}Docker image:${NC} $DOCKER_IMAGE:latest"
    fi
    if [ "$mode" = "source" ] || [ "$mode" = "both" ]; then
        echo -e "${BLUE}Isolation:${NC} Uses OPENCODE_CONFIG_DIR to load from .opencode-review/"
    fi
    echo ""
}

main() {
    parse_args "$@"
    print_banner
    check_git_repo
    local project_root=$(get_project_root)
    log_info "Project root: $project_root"
    if [ -d "$project_root/.opencode" ]; then
        log_info "Detected existing .opencode/ directory"
        log_info "This tool uses isolated .opencode-review/ to avoid conflicts"
    fi
    if [ -z "$INSTALL_MODE" ]; then
        select_install_mode
    fi
    log_info "Installation mode: $INSTALL_MODE"
    echo ""
    download_repo
    case "$INSTALL_MODE" in
        docker) install_docker_workflow "$project_root" ;;
        source)
            check_source_dependencies
            install_source_files "$project_root"
            install_source_workflow "$project_root"
            install_dependencies "$project_root"
            ;;
        both)
            check_source_dependencies
            install_source_files "$project_root"
            install_docker_workflow "$project_root"
            install_dependencies "$project_root"
            ;;
    esac
    cleanup
    print_next_steps "$INSTALL_MODE"
}

trap cleanup EXIT
main "$@"
