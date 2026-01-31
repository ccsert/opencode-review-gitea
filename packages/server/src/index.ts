/**
 * OpenCode Review Platform - Server
 * 
 * Hono + Bun HTTP 服务器
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

import { authRoutes } from './routes/auth'
import { repoRoutes } from './routes/repos'
import { templateRoutes } from './routes/templates'
import { reviewRoutes } from './routes/reviews'
import { webhookRoutes } from './routes/webhooks'
import { systemRoutes } from './routes/system'
import { apiKeyRoutes } from './routes/api-keys'
import { 
  errorMiddleware, 
  notFoundHandler, 
  loggerMiddleware, 
  requestIdMiddleware,
  corsConfig 
} from './middleware/error'
import { initDatabase, runMigrations } from './db/client'

// 环境变量
const PORT = parseInt(process.env.PORT || '3000', 10)
const HOST = process.env.HOST || '0.0.0.0'
const DATABASE_URL = process.env.DATABASE_URL || 'file:./data/review.db'

// 创建应用
const app = new Hono()

// 全局中间件
app.use('*', requestIdMiddleware)
app.use('*', loggerMiddleware)
app.use('*', secureHeaders())
app.use('*', cors(corsConfig))
app.use('*', errorMiddleware)

// API 路由
const api = new Hono()
  .route('/auth', authRoutes)
  .route('/repositories', repoRoutes)
  .route('/templates', templateRoutes)
  .route('/reviews', reviewRoutes)
  .route('/webhooks', webhookRoutes)
  .route('/api-keys', apiKeyRoutes)
  .route('/system', systemRoutes)

app.route('/api/v1', api)

// 健康检查（根路径）
app.get('/', (c) => c.json({ 
  name: 'OpenCode Review Platform',
  version: '0.1.0',
  status: 'running',
}))

// 404 处理
app.notFound(notFoundHandler)

// 静态文件服务（生产环境）
// TODO: 添加前端静态文件服务

// 启动服务器
async function start() {
  try {
    // 初始化数据库
    await initDatabase(DATABASE_URL)
    
    // 运行迁移
    await runMigrations()
    
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 OpenCode Review Platform                             ║
║                                                           ║
║   Server running at http://${HOST}:${PORT}                    ║
║   API endpoint: http://${HOST}:${PORT}/api/v1                 ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `)
    
    // Bun.serve 返回一个 Server 对象
    const server = Bun.serve({
      port: PORT,
      hostname: HOST,
      fetch: app.fetch,
    })
    
    console.log(`[Server] Listening on ${server.hostname}:${server.port}`)
  } catch (error: any) {
    // 如果端口已被占用，可能是 Bun 的 hot reload 已经启动了服务
    if (error?.code === 'EADDRINUSE') {
      console.log(`[Server] Port ${PORT} already in use (possibly by Bun hot reload)`)
      console.log(`[Server] App is available at http://${HOST}:${PORT}`)
    } else {
      console.error('Failed to start server:', error)
      process.exit(1)
    }
  }
}

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down...')
  process.exit(0)
})

// 启动
start()

export default app
export type AppType = typeof api
