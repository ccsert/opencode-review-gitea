# OpenCode Review Platform - Docker Configuration
# Multi-stage build with Node.js + pnpm

FROM node:22-alpine AS base

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Dependencies stage
FROM base AS deps

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build stage
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
COPY . .

# Build all packages
RUN pnpm run build

# Production stage
FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 opencode
USER opencode

# Copy build artifacts
COPY --from=builder --chown=opencode:nodejs /app/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=opencode:nodejs /app/packages/core/package.json ./packages/core/
COPY --from=builder --chown=opencode:nodejs /app/packages/server/dist ./packages/server/dist
COPY --from=builder --chown=opencode:nodejs /app/packages/server/package.json ./packages/server/
COPY --from=deps --chown=opencode:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=opencode:nodejs /app/package.json ./

# Create data directory
RUN mkdir -p /app/data

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1/system/health || exit 1

# Start server
CMD ["node", "packages/server/dist/index.js"]
