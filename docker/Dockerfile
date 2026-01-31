# OpenCode Review Platform - Docker Configuration
# 多阶段构建，优化镜像大小

FROM oven/bun:1-alpine AS base

WORKDIR /app

# 安装依赖阶段
FROM base AS deps

# 复制 package 文件
COPY package.json bun.lock* ./
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/

# 安装依赖
RUN bun install --frozen-lockfile

# 构建阶段
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
COPY . .

# 构建所有包
RUN bun run build

# 生产阶段
FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 opencode
USER opencode

# 复制构建产物
COPY --from=builder --chown=opencode:nodejs /app/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=opencode:nodejs /app/packages/core/package.json ./packages/core/
COPY --from=builder --chown=opencode:nodejs /app/packages/server/dist ./packages/server/dist
COPY --from=builder --chown=opencode:nodejs /app/packages/server/package.json ./packages/server/
COPY --from=deps --chown=opencode:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=opencode:nodejs /app/package.json ./

# 创建数据目录
RUN mkdir -p /app/data

EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1/system/health || exit 1

# 启动服务
CMD ["bun", "run", "packages/server/dist/index.js"]
