import { defineConfig } from 'drizzle-kit'

/**
 * Drizzle Kit 配置
 * 
 * 使用 PostgreSQL 方言 (PGlite 兼容)
 * PGlite 数据存储在本地目录，与 PostgreSQL 语法完全兼容
 */

const databaseUrl = process.env.DATABASE_URL || 'pglite:./data/review'

// 解析数据库路径
function getDatabasePath(url: string): string {
  if (url.startsWith('pglite:')) {
    return url.replace('pglite:', '')
  }
  if (url.startsWith('file:')) {
    return url.replace('file:', '').replace('.db', '') + '-pg'
  }
  return url
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: `file:${getDatabasePath(databaseUrl)}`,
  },
  verbose: true,
  strict: true,
})
