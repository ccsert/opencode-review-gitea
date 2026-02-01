/**
 * 数据库客户端 - PGlite (PostgreSQL 兼容)
 * 
 * 使用 @electric-sql/pglite 替代 SQLite
 * PGlite 是一个轻量级的 PostgreSQL 实现，完全兼容 PostgreSQL 语法
 * 方便后续无缝迁移到完整的 PostgreSQL 数据库
 */

import { drizzle } from 'drizzle-orm/pglite'
import { PGlite } from '@electric-sql/pglite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

import * as schema from './schema/index'

export type DatabaseType = 'pglite' | 'postgresql'

// 使用 PGlite 的 Drizzle 类型
export type DatabaseInstance = ReturnType<typeof drizzle<typeof schema>>

// 全局数据库状态
let _db: DatabaseInstance | null = null
let _pglite: PGlite | null = null

/**
 * 解析数据库 URL
 * 支持格式：
 * - pglite:./data/review (本地 PGlite 目录)
 * - pglite::memory: (内存模式)
 * - file:./data/review.db (兼容旧格式，自动转换)
 */
function parseDatabaseUrl(url: string): { path: string; isMemory: boolean } {
  // 内存模式
  if (url === 'pglite::memory:' || url === ':memory:') {
    return { path: '', isMemory: true }
  }
  
  // PGlite 格式
  if (url.startsWith('pglite:')) {
    return { path: url.replace('pglite:', ''), isMemory: false }
  }
  
  // 兼容旧的 SQLite file: 格式，转换为 PGlite 路径
  if (url.startsWith('file:')) {
    const oldPath = url.replace('file:', '').replace('.db', '')
    return { path: oldPath + '-pg', isMemory: false }
  }
  
  // 默认作为路径处理
  return { path: url, isMemory: false }
}

/**
 * 初始化数据库
 */
export async function initDatabase(url: string): Promise<void> {
  const { path, isMemory } = parseDatabaseUrl(url)
  
  if (isMemory) {
    // 内存模式
    _pglite = new PGlite()
    console.log(`[Database] Using in-memory PGlite`)
  } else {
    // 确保目录存在
    const dir = dirname(path)
    if (dir && dir !== '.' && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    
    _pglite = new PGlite(path)
    console.log(`[Database] Connected to PGlite: ${path}`)
  }
  
  _db = drizzle(_pglite, { schema })
}

/**
 * 获取全局数据库实例
 */
export function getDatabase(): DatabaseInstance {
  if (!_db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return _db
}

/**
 * 获取数据库类型
 */
export function getDatabaseType(): DatabaseType {
  return 'pglite'
}

/**
 * 运行数据库迁移/同步
 */
export async function runMigrations(): Promise<void> {
  if (!_db || !_pglite) {
    throw new Error('Database not initialized')
  }
  
  console.log(`[Database] Syncing schema...`)
  
  // 使用 PostgreSQL 语法创建表
  await _pglite.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );

    -- API Keys table
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      scopes JSONB DEFAULT '[]',
      last_used_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Review Templates table
    CREATE TABLE IF NOT EXISTS review_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      system_prompt TEXT NOT NULL,
      categories JSONB DEFAULT '["BUG", "SECURITY", "PERFORMANCE", "STYLE"]',
      severities JSONB DEFAULT '["CRITICAL", "HIGH", "MEDIUM", "LOW"]',
      is_default BOOLEAN DEFAULT FALSE,
      is_system BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );

    -- Repositories table
    CREATE TABLE IF NOT EXISTS repositories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'gitea',
      provider_repo_id TEXT,
      url TEXT NOT NULL,
      name TEXT NOT NULL,
      webhook_secret TEXT,
      access_token TEXT,
      template_id TEXT REFERENCES review_templates(id) ON DELETE SET NULL,
      config JSONB DEFAULT '{}',
      enabled BOOLEAN DEFAULT TRUE,
      last_review_at TIMESTAMPTZ,
      review_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    );

    -- Reviews table
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      pr_number INTEGER NOT NULL,
      pr_title TEXT,
      pr_author TEXT,
      pr_url TEXT,
      status TEXT DEFAULT 'pending',
      decision TEXT,
      summary TEXT,
      comments_count INTEGER DEFAULT 0,
      model TEXT,
      tokens_used INTEGER,
      error TEXT,
      duration_ms INTEGER,
      triggered_by TEXT,
      webhook_event_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    -- Webhook Logs table
    CREATE TABLE IF NOT EXISTS webhook_logs (
      id TEXT PRIMARY KEY,
      repository_id TEXT REFERENCES repositories(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      delivery_id TEXT,
      payload JSONB,
      headers JSONB,
      processed BOOLEAN DEFAULT FALSE,
      review_id TEXT,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_repos_user ON repositories(user_id);
    CREATE INDEX IF NOT EXISTS idx_repos_provider ON repositories(provider, provider_repo_id);
    CREATE INDEX IF NOT EXISTS idx_repos_name ON repositories(name);
    CREATE INDEX IF NOT EXISTS idx_reviews_repo ON reviews(repository_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
    CREATE INDEX IF NOT EXISTS idx_webhook_logs_repo ON webhook_logs(repository_id);
    CREATE INDEX IF NOT EXISTS idx_webhook_logs_delivery ON webhook_logs(delivery_id);
  `)
  
  console.log(`[Database] Schema synced successfully`)
}

/**
 * 关闭数据库连接
 */
export async function closeDatabase(): Promise<void> {
  if (_pglite) {
    await _pglite.close()
    _db = null
    _pglite = null
    console.log(`[Database] Connection closed`)
  }
}
