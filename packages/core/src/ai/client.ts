/**
 * OpenCode SDK 客户端封装
 * 提供与 OpenCode 服务器通信的能力
 */

import { createOpencode, createOpencodeClient } from '@opencode-ai/sdk'
import type { Session, Message, Part } from '@opencode-ai/sdk'

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
  private config: OpenCodeClientConfig
  private client: ReturnType<typeof createOpencodeClient> | null = null
  private serverInstance: { server: { close: () => void; url: string } } | null = null
  private isConnected = false

  constructor(config: OpenCodeClientConfig = {}) {
    this.config = {
      hostname: '127.0.0.1',
      port: 4096,
      timeout: 30000,
      model: {
        providerID: 'opencode',
        modelID: 'deepseek/deepseek-chat',
      },
      ...config,
    }
  }

  /**
   * 连接到 OpenCode 服务器
   * 如果提供了 serverUrl，则连接到已有服务器
   * 否则启动新的服务器实例
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return
    }

    try {
      if (this.config.serverUrl) {
        // 连接到已有服务器
        this.client = createOpencodeClient({
          baseUrl: this.config.serverUrl,
        })
      } else {
        // 启动新服务器并创建客户端
        const result = await createOpencode({
          hostname: this.config.hostname,
          port: this.config.port,
          timeout: this.config.timeout,
        })
        this.client = result.client
        this.serverInstance = result
      }

      // 验证连接 - 通过获取项目列表验证服务器可用性
      // OpenCode SDK 没有 health 端点，使用 project.list 作为替代
      await this.client.project.list()

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

    // 创建新 session
    const session = await this.client.session.create({
      body: { title: 'Code Review Session' },
    })

    if (!session.data) {
      throw new Error('Failed to create session')
    }

    const sessionId = session.data.id

    try {
      // 如果有系统提示词，先注入上下文
      if (options.systemPrompt) {
        await this.client.session.prompt({
          path: { id: sessionId },
          body: {
            noReply: true,
            parts: [{ type: 'text', text: options.systemPrompt }],
          },
        })
      }

      // 发送用户消息并获取 AI 响应
      const model = options.model || this.config.model
      const response = await this.client.session.prompt({
        path: { id: sessionId },
        body: {
          model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined,
          agent: options.agent,
          noReply: options.noReply,
          parts: [{ type: 'text', text: userMessage }],
        },
      })

      if (!response.data) {
        throw new Error('No response from AI')
      }

      // 提取文本响应
      const parts = response.data.parts || []
      const textParts = parts.filter((p): p is Part & { type: 'text' } => p.type === 'text')
      const text = textParts.map(p => 'text' in p ? p.text : '').join('\n')

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
          path: { id: sessionId },
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
