# OpenCode Review for Gitea/Forgejo
# Docker image for AI-powered PR code review
#
# Build: docker build -t ghcr.io/ccsert/opencode-review:latest .
# Run with explicit GITEA_SERVER_URL, REPO_OWNER, REPO_NAME and PR_NUMBER;
# target code does not need to be mounted. See docs/draft-review.md.

FROM oven/bun:1

LABEL org.opencontainers.image.source="https://github.com/ccsert/opencode-review-gitea"
LABEL org.opencontainers.image.description="AI-powered code review for Gitea/Forgejo PRs"
LABEL org.opencontainers.image.licenses="MIT"

# Install git and runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl bash nodejs ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install opencode CLI globally
ARG OPENCODE_GENERATION=1
ARG OPENCODE_VERSION=latest
RUN case "$OPENCODE_GENERATION" in \
      1) bun add -g "opencode-ai@${OPENCODE_VERSION}" ;; \
      2) printf '%s\n' "$OPENCODE_VERSION" | grep -Eq '^2\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || \
           { echo 'OpenCode 2 requires an exact stable 2.x OPENCODE_VERSION' >&2; exit 1; }; \
         bun add -g --trust "@opencode/cli@${OPENCODE_VERSION}" ;; \
      *) echo 'OPENCODE_GENERATION must be 1 or 2' >&2; exit 1 ;; \
    esac && opencode --version

# Create app directory for built-in config
WORKDIR /app

# Copy built-in configuration (agents, tools, skills)
COPY .opencode-review/ /app/.opencode-review/

# Install tool dependencies
WORKDIR /app/.opencode-review
RUN bun install --frozen-lockfile

# Install the V2 plugin only in the opt-in image. Leave V1 tool discovery intact.
RUN if [ "$OPENCODE_GENERATION" = 2 ]; then \
      mkdir -p plugins && cp -R adapters/gitea-review-v2 plugins/; \
    fi

# Set working directory for user code
WORKDIR /workspace

# Environment variables with defaults
ENV OPENCODE_IMAGE_GENERATION=${OPENCODE_GENERATION} \
    OPENCODE_CONFIG_DIR=/app/.opencode-review \
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
