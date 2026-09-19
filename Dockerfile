# OpenCode Review for Gitea/Forgejo
# Docker image for AI-powered PR code review
#
# Build: docker build -t ghcr.io/ccsert/opencode-review:latest .
# Run:   docker run --rm -v $(pwd):/workspace -e GITEA_TOKEN=xxx ghcr.io/ccsert/opencode-review

FROM oven/bun:1

LABEL org.opencontainers.image.source="https://github.com/ccsert/opencode-review-gitea"
LABEL org.opencontainers.image.description="AI-powered code review for Gitea/Forgejo PRs"
LABEL org.opencontainers.image.licenses="MIT"

# Install git and runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl bash nodejs ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Check architecture - opencode-ai binary only supports x86_64/amd64
# ARM users should use the source installation method instead
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" != "x86_64" ] && [ "$ARCH" != "amd64" ]; then \
        echo "⚠️  WARNING: opencode-ai binary may not support $ARCH architecture" && \
        echo "   If you encounter errors, please use the source installation method:" && \
        echo "   https://github.com/ccsert/opencode-review-gitea#installation" ; \
    fi

# Install opencode CLI globally
RUN bun add -g opencode-ai

# Create app directory for built-in config
WORKDIR /app

# Copy built-in configuration (agents, tools, skills)
COPY .opencode-review/ /app/.opencode-review/

# Install tool dependencies
WORKDIR /app/.opencode-review
RUN bun install --frozen-lockfile || bun install

# Set working directory for user code
WORKDIR /workspace

# Environment variables with defaults
ENV OPENCODE_CONFIG_DIR=/app/.opencode-review \
    MODEL=deepseek/deepseek-chat \
    REVIEW_LANGUAGE=auto \
    REVIEW_STYLE=balanced

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD opencode --version || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["review"]
