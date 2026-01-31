# OpenCode Review for Gitea/Forgejo
# Docker image for AI-powered PR code review
#
# Build: docker build -t ghcr.io/ccsert/opencode-review:latest .
# Run:   docker run --rm -v $(pwd):/workspace -e GITEA_TOKEN=xxx ghcr.io/ccsert/opencode-review

FROM oven/bun:1-alpine

LABEL org.opencontainers.image.source="https://github.com/ccsert/opencode-review-gitea"
LABEL org.opencontainers.image.description="AI-powered code review for Gitea/Forgejo PRs"
LABEL org.opencontainers.image.licenses="MIT"

# Install git and other dependencies
RUN apk add --no-cache git curl bash

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
