import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.DATABASE_URL || 'file:./data/review.db'

// 检测数据库类型
const isPostgres = databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: isPostgres ? 'postgresql' : 'sqlite',
  dbCredentials: isPostgres 
    ? { url: databaseUrl }
    : { url: databaseUrl.replace('file:', '') },
  verbose: true,
  strict: true,
})
