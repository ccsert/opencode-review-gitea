/**
 * OpenCode SDK 客户端封装
 * 提供与 OpenCode 服务器通信的能力
 */

import { createOpencode, createOpencodeClient } from '@opencode-ai/sdk/v2'
import type { Session, Message, Part } from '@opencode-ai/sdk/v2'

export interface OpenCodeClientConfig {
  /** OpenCode 服务器主机名 */
  hostname?: string
  /** OpenCode 服务器端口 */
  port?: number
  /** 超时时间（毫秒） */
  timeout?: number
  /** 连接到已有服务器的 URL（可选，如果设置则不启动新服务器） */
  serverUrl?: string
  /** 默认模型配置 */
  model?: {
    providerID: string
    modelID: string
  }
}

export interface PromptOptions {
  /** 使用的模型 */
  model?: {
    providerID: string
    modelID: string
  }
  /** 使用的 Agent */
  agent?: string
  /** 系统提示词 */
  systemPrompt?: string
  /** 是否仅注入上下文（不触发 AI 响应） */
  noReply?: boolean
  /** API Key（如果需要设置） */
  apiKey?: string
}

export interface PromptResult {
  /** 响应文本 */
  text: string
  /** 原始消息部分 */
  parts: Part[]
  /** Session ID */
  sessionId: string
  /** Message ID */
  messageId: string
}

/**
 * OpenCode 客户端
 * 封装与 OpenCode 服务器的交互
 */
export class OpenCodeClient {
  private config: Required<Omit<OpenCodeClientConfig, 'serverUrl'>> & Pick<OpenCodeClientConfig, 'serverUrl'>
  private client: ReturnType<typeof createOpencodeClient> | null = null
  private serverInstance: { server: { close: () => void; url: string } } | null = null
  private isConnected = false

  constructor(config: OpenCodeClientConfig = {}) {
    // 确保有合理的默认值，避免 undefined 传递给 SDK
    this.config = {
      hostname: config.hostname || '127.0.0.1',
      port: config.port ?? 4096,
      timeout: config.timeout ?? 30000,
      serverUrl: config.serverUrl,
      model: config.model || {
        providerID: 'deepseek',
        modelID: 'deepseek/deepseek-chat',
      },
    }
  }

  /**
   * 连接到 OpenCode 服务器
   * 优先尝试连接到已有服务器，如果失败则启动新服务器
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return
    }

    const serverUrl = this.config.serverUrl || `http://${this.config.hostname}:${this.config.port}`

    try {
      // 首先尝试连接到已有服务器
      console.log(`[OpenCodeClient] Trying to connect to existing server at ${serverUrl}...`)
      this.client = createOpencodeClient({
        baseUrl: serverUrl,
      })

      // 验证连接 - 通过健康检查验证服务器可用性
      const health = await this.client.global.health()
      if (health.data?.healthy) {
        console.log(`[OpenCodeClient] Connected to existing server (version: ${health.data.version})`)
        this.isConnected = true
        return
      }
    } catch (connectError) {
      console.log(`[OpenCodeClient] No existing server found, will start a new one...`)
      this.client = null
    }

    // 如果指定了 serverUrl，则不启动新服务器，直接报错
    if (this.config.serverUrl) {
      throw new Error(`Failed to connect to OpenCode server at ${this.config.serverUrl}`)
    }

    try {
      // 启动新服务器并创建客户端
      console.log(`[OpenCodeClient] Starting new server on ${this.config.hostname}:${this.config.port}...`)
      const result = await createOpencode({
        hostname: this.config.hostname,
        port: this.config.port,
        timeout: this.config.timeout,
      })
      this.client = result.client
      this.serverInstance = result
      console.log(`[OpenCodeClient] Server started at ${result.server.url}`)

      this.isConnected = true
    } catch (error) {
      this.isConnected = false
      throw new Error(`Failed to connect to OpenCode server: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.serverInstance) {
      this.serverInstance.server.close()
      this.serverInstance = null
    }
    this.client = null
    this.isConnected = false
  }

  /**
   * 检查是否已连接
   */
  get connected(): boolean {
    return this.isConnected
  }

  /**
   * 发送 prompt 并获取 AI 响应
   */
  async prompt(userMessage: string, options: PromptOptions = {}): Promise<PromptResult> {
    if (!this.client || !this.isConnected) {
      throw new Error('OpenCode client is not connected. Call connect() first.')
    }

    // 如果提供了 API Key，先设置认证
    const model = options.model || this.config.model
    console.log(`[OpenCodeClient] Using model:`, JSON.stringify(model))
    
    if (options.apiKey && model?.providerID) {
      try {
        console.log(`[OpenCodeClient] Setting API key for provider: ${model.providerID}`)
        const authResult = await this.client.auth.set({
          providerID: model.providerID,
          auth: { type: 'api', key: options.apiKey },
        })
        console.log(`[OpenCodeClient] Auth set result:`, JSON.stringify(authResult))
      } catch (authError) {
        console.warn(`[OpenCodeClient] Failed to set API key:`, authError)
        // 继续尝试，可能已经有凭证
      }
    } else {
      console.log(`[OpenCodeClient] No API key provided or no provider ID. apiKey present: ${!!options.apiKey}, providerID: ${model?.providerID}`)
    }

    // 创建新 session
    const session = await this.client.session.create({
      title: 'Code Review Session',
    })

    if (!session.data) {
      throw new Error('Failed to create session')
    }

    const sessionId = session.data.id
    console.log(`[OpenCodeClient] Created session: ${sessionId}`)

    try {
      // 如果有系统提示词，先注入上下文
      if (options.systemPrompt) {
        console.log(`[OpenCodeClient] Injecting system prompt...`)
        const sysResult = await this.client.session.prompt({
          sessionID: sessionId,
          noReply: true,
          parts: [{ type: 'text', text: options.systemPrompt }],
        })
        console.log(`[OpenCodeClient] System prompt injected, result:`, JSON.stringify(sysResult.data || sysResult.error).substring(0, 500))
      }

      // 发送用户消息并获取 AI 响应
      console.log(`[OpenCodeClient] Sending prompt with model:`, JSON.stringify(model))
      
      // 尝试使用同步 prompt 方法
      const response = await this.client.session.prompt({
        sessionID: sessionId,
        model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
        agent: options.agent,
        noReply: options.noReply,
        parts: [{ type: 'text', text: userMessage }],
      })

      console.log(`[OpenCodeClient] Raw response:`, JSON.stringify(response).substring(0, 2000))

      // 如果 prompt 返回空响应，尝试使用 promptAsync + 轮询
      if (!response.data || Object.keys(response.data).length === 0) {
        console.log(`[OpenCodeClient] Empty prompt response, trying async method...`)
        
        // 使用异步方式发送
        await this.client.session.promptAsync({
          sessionID: sessionId,
          model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
          agent: options.agent,
          noReply: options.noReply,
          parts: [{ type: 'text', text: userMessage }],
        })

        // 等待并轮询获取消息
        const maxWaitTime = 120000 // 2 分钟
        const pollInterval = 2000 // 2 秒
        const startTime = Date.now()
        
        while (Date.now() - startTime < maxWaitTime) {
          // 检查会话状态
          const statusResult = await this.client.session.status()
          const sessionStatuses = statusResult.data as Record<string, { type: string }> | undefined
          const sessionStatus = sessionStatuses?.[sessionId]
          console.log(`[OpenCodeClient] Session status:`, sessionStatus?.type)
          
          // 如果会话空闲，获取消息
          if (sessionStatus?.type === 'idle') {
            const messagesResult = await this.client.session.messages({ sessionID: sessionId })
            console.log(`[OpenCodeClient] Messages count:`, messagesResult.data?.length)
            
            if (messagesResult.data && messagesResult.data.length > 0) {
              // 获取最后一条助手消息
              const lastMessage = messagesResult.data[messagesResult.data.length - 1]
              if (lastMessage && lastMessage.parts) {
                const textParts = lastMessage.parts.filter((p: Part) => p.type === 'text') as (Part & { type: 'text'; text: string })[]
                const text = textParts.map(p => p.text).join('\n')
                
                if (text.length > 0) {
                  console.log(`[OpenCodeClient] Got async response, length:`, text.length)
                  return {
                    text,
                    parts: lastMessage.parts,
                    sessionId,
                    messageId: lastMessage.info?.id || '',
                  }
                }
              }
            }
          }
          
          // 等待后重试
          await new Promise(resolve => setTimeout(resolve, pollInterval))
        }
        
        throw new Error('Timeout waiting for AI response')
      }

      // 此处 response.data 已经非空（因为上面的 if 分支已处理空情况）

      // 调试：打印响应结构
      console.log('[OpenCodeClient] Response data keys:', Object.keys(response.data))
      console.log('[OpenCodeClient] Response data:', JSON.stringify(response.data, null, 2).substring(0, 1000))

      // 提取文本响应 - 支持多种响应结构
      let text = ''
      const parts = response.data.parts || []

      // 方式1: 直接从 parts 中提取文本
      if (parts.length > 0) {
        const textParts = parts.filter((p): p is Part & { type: 'text' } => p.type === 'text')
        text = textParts.map(p => 'text' in p ? p.text : '').join('\n')
      }

      // 方式2: 如果 parts 为空，尝试从 response.data.text 获取
      if (!text && 'text' in response.data && typeof response.data.text === 'string') {
        text = response.data.text
      }

      // 方式3: 如果还是空，尝试从 response.data.content 获取
      if (!text && 'content' in response.data && typeof response.data.content === 'string') {
        text = response.data.content
      }

      // 方式4: 如果有 message 字段，尝试从中提取
      if (!text && 'message' in response.data) {
        const msg = response.data.message as { content?: string; text?: string; parts?: Part[] }
        if (typeof msg?.content === 'string') {
          text = msg.content
        } else if (typeof msg?.text === 'string') {
          text = msg.text
        } else if (Array.isArray(msg?.parts)) {
          const msgTextParts = msg.parts.filter((p): p is Part & { type: 'text' } => p.type === 'text')
          text = msgTextParts.map(p => 'text' in p ? p.text : '').join('\n')
        }
      }

      console.log('[OpenCodeClient] Extracted text length:', text.length)
      if (text.length > 0) {
        console.log('[OpenCodeClient] Text preview:', text.substring(0, 200))
      }

      return {
        text,
        parts,
        sessionId,
        messageId: response.data.info?.id || '',
      }
    } finally {
      // 清理 session（可选，保持服务器整洁）
      try {
        await this.client.session.delete({
          sessionID: sessionId,
        })
      } catch {
        // 忽略清理错误
      }
    }
  }

  /**
   * 获取可用的 providers 和模型
   */
  async getProviders(): Promise<{ providers: unknown[]; defaults: Record<string, string> }> {
    if (!this.client || !this.isConnected) {
      throw new Error('OpenCode client is not connected. Call connect() first.')
    }

    const result = await this.client.config.providers()
    return {
      providers: result.data?.providers || [],
      defaults: result.data?.default || {},
    }
  }

  /**
   * 获取可用的 agents
   */
  async getAgents(): Promise<unknown[]> {
    if (!this.client || !this.isConnected) {
      throw new Error('OpenCode client is not connected. Call connect() first.')
    }

    const result = await this.client.app.agents()
    return result.data || []
  }
}

/**
 * 创建 OpenCode 客户端实例
 */
export function createClient(config?: OpenCodeClientConfig): OpenCodeClient {
  return new OpenCodeClient(config)
}

// 单例客户端（可选，用于全局共享）
let globalClient: OpenCodeClient | null = null

/**
 * 获取或创建全局 OpenCode 客户端
 */
export function getGlobalClient(config?: OpenCodeClientConfig): OpenCodeClient {
  if (!globalClient) {
    globalClient = createClient(config)
  }
  return globalClient
}

/**
 * 重置全局客户端
 */
export async function resetGlobalClient(): Promise<void> {
  if (globalClient) {
    await globalClient.disconnect()
    globalClient = null
  }
}
