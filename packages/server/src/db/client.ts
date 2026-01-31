/**
 * 数据库客户端 - SQLite (开发优先)
 * 
 * 注意：PostgreSQL 支持将在后续版本中通过独立模块添加
 */

import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

import * as schema from './schema/index'

export type DatabaseType = 'sqlite'

// 使用具体类型而非联合类型
export type DatabaseInstance = BetterSQLite3Database<typeof schema>

// 全局数据库状态
let _db: DatabaseInstance | null = null
let _sqlite: Database.Database | null = null

/**
 * 初始化数据库
 */
export async function initDatabase(url: string): Promise<void> {
  const dbPath = url.replace('file:', '')
  
  // 确保目录存在
  const dir = dirname(dbPath)
  if (dir && dir !== '.' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  
  _sqlite = new Database(dbPath)
  _sqlite.pragma('journal_mode = WAL')
  
  _db = drizzle(_sqlite, { schema })
  
  console.log(`[Database] Connected to SQLite: ${dbPath}`)
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
  return 'sqlite'
}

/**
 * 运行数据库迁移/同步
 */
export async function runMigrations(): Promise<void> {
  if (!_db || !_sqlite) {
    throw new Error('Database not initialized')
  }
  
  console.log(`[Database] Syncing schema...`)
  
  // 简单的表创建（开发环境）
  // 生产环境应该使用 drizzle-kit generate + migrate
  _sqlite.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- API Keys table
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      scopes TEXT DEFAULT '["webhook"]',
      expires_at TEXT,
      last_used_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Review Templates table
    CREATE TABLE IF NOT EXISTS review_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      name TEXT NOT NULL,
      description TEXT,
      system_prompt TEXT NOT NULL,
      user_prompt_template TEXT NOT NULL,
      focus_areas TEXT DEFAULT '[]',
      severity_levels TEXT DEFAULT '[]',
      language TEXT DEFAULT 'zh-CN',
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Repositories table
    CREATE TABLE IF NOT EXISTS repositories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'gitea',
      access_token TEXT,
      webhook_secret TEXT,
      template_id TEXT REFERENCES review_templates(id),
      enabled INTEGER DEFAULT 1,
      review_count INTEGER DEFAULT 0,
      last_review_at TEXT,
      settings TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Reviews table
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL REFERENCES repositories(id),
      pr_number INTEGER NOT NULL,
      pr_title TEXT,
      pr_author TEXT,
      pr_url TEXT,
      status TEXT DEFAULT 'pending',
      decision TEXT,
      summary TEXT,
      comments_count INTEGER DEFAULT 0,
      model TEXT,
      error TEXT,
      duration_ms INTEGER,
      triggered_by TEXT,
      webhook_event_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );

    -- Webhook Logs table
    CREATE TABLE IF NOT EXISTS webhook_logs (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL REFERENCES repositories(id),
      event_type TEXT NOT NULL,
      delivery_id TEXT,
      payload TEXT,
      headers TEXT,
      processed INTEGER DEFAULT 0,
      review_id TEXT REFERENCES reviews(id),
      error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_repositories_user_id ON repositories(user_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_repository_id ON reviews(repository_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
    CREATE INDEX IF NOT EXISTS idx_webhook_logs_repository_id ON webhook_logs(repository_id);
  `)
  
  console.log(`[Database] Schema synced successfully`)
}

/**
 * 关闭数据库连接
 */
export async function closeDatabase(): Promise<void> {
  if (_sqlite) {
    _sqlite.close()
    _db = null
    _sqlite = null
    console.log(`[Database] Connection closed`)
  }
}
