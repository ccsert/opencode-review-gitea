/**
 * Review 引擎 - 集成 AI 执行代码审查
 * 支持 OpenCode SDK 和直接 AI API 调用两种模式
 */

import type { GitProvider } from '../providers/types'
import type { ReviewTemplate, ReviewDecision, CreateReviewRequest, LineCommentRequest } from '../types'
import type { WebhookEvent } from '../events/types'
import { renderTemplate } from '../templates/renderer'
import { OpenCodeClient, type OpenCodeClientConfig } from '../ai/client'
import { DirectAIClient, type DirectAIConfig } from '../ai/direct-client'

export interface ReviewEngineConfig {
  /** OpenCode 服务器配置 */
  opencode?: {
    port?: number
    hostname?: string
    serverUrl?: string
  }
  /** 默认模型配置 */
  model?: {
    providerID: string
    modelID: string
  }
  /** AI 供应商 API Key */
  apiKey?: string
  /** AI 供应商 Base URL（可选，用于自定义端点） */
  baseUrl?: string
  /** 是否使用直接 AI 调用模式（绕过 OpenCode SDK） */
  useDirectMode?: boolean
  /** 调试模式 */
  debug?: boolean
}

export interface ReviewResult {
  success: boolean
  decision?: ReviewDecision
  summary?: string
  commentsCount?: number
  tokensUsed?: number
  durationMs?: number
  error?: string
}

export interface ReviewContext {
  provider: GitProvider
  repository: {
    owner: string
    repo: string
    fullName: string
  }
  pullRequest: {
    number: number
    title: string
    author: string
    baseBranch: string
    headBranch: string
  }
  template: ReviewTemplate
  config?: {
    language?: string
    style?: string
  }
}

/**
 * Review 引擎
 * 负责执行代码审查的核心逻辑
 */
export class ReviewEngine {
  private config: ReviewEngineConfig
  private aiClient: OpenCodeClient | null = null
  private directClient: DirectAIClient | null = null

  constructor(config: ReviewEngineConfig = {}) {
    this.config = {
      model: {
        providerID: 'deepseek',
        modelID: 'deepseek-chat',
      },
      debug: false,
      useDirectMode: true, // 默认使用直接模式，更可靠
      ...config,
    }

    // 如果提供了 API Key 且启用直接模式，使用直接 AI 客户端
    if (this.config.apiKey && this.config.useDirectMode !== false) {
      console.log('[ReviewEngine] Using direct AI mode')
      this.directClient = new DirectAIClient({
        provider: this.config.model?.providerID || 'deepseek',
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
        model: this.config.model?.modelID || 'deepseek-chat',
      })
    } else {
      // 否则使用 OpenCode SDK
      console.log('[ReviewEngine] Using OpenCode SDK mode')
      this.aiClient = new OpenCodeClient({
        hostname: config.opencode?.hostname,
        port: config.opencode?.port,
        serverUrl: config.opencode?.serverUrl,
        model: this.config.model,
      })
    }
  }

  /**
   * 执行代码审查
   */
  async executeReview(context: ReviewContext): Promise<ReviewResult> {
    const startTime = Date.now()

    try {
      // 1. 获取 PR Diff
      const { owner, repo } = context.repository
      const prNumber = context.pullRequest.number
      
      const diff = await context.provider.getPullRequestDiff(owner, repo, prNumber)
      const files = await context.provider.getPullRequestFiles(owner, repo, prNumber)

      if (!diff || diff.trim().length === 0) {
        return {
          success: true,
          decision: 'COMMENT',
          summary: '没有发现代码变更，跳过审查。',
          commentsCount: 0,
          durationMs: Date.now() - startTime,
        }
      }

      // 2. 构建审查 Prompt
      const systemPrompt = this.buildSystemPrompt(context)
      const userPrompt = this.buildUserPrompt(context, diff, files)

      // 3. 调用 AI 执行审查
      const aiResult = await this.callAI(systemPrompt, userPrompt)

      // 4. 解析 AI 响应
      const { decision, summary, comments } = this.parseAIResponse(aiResult, files)

      // 5. 提交 Review 到 Git 平台
      const review: CreateReviewRequest = {
        body: summary,
        decision,
        comments,
      }

      await context.provider.createReview(owner, repo, prNumber, review)

      return {
        success: true,
        decision,
        summary,
        commentsCount: comments?.length || 0,
        durationMs: Date.now() - startTime,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      if (this.config.debug) {
        console.error('Review failed:', error)
      }

      return {
        success: false,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      }
    }
  }

  /**
   * 构建 System Prompt
   */
  private buildSystemPrompt(context: ReviewContext): string {
    const templateContext = {
      repo: {
        name: context.repository.fullName,
        provider: 'gitea',
      },
      pr: {
        number: context.pullRequest.number,
        title: context.pullRequest.title,
        author: context.pullRequest.author,
        branch: {
          source: context.pullRequest.headBranch,
          target: context.pullRequest.baseBranch,
        },
      },
      files: {
        count: 0,
        list: [],
      },
      config: {
        language: context.config?.language || 'zh-CN',
        style: context.config?.style || 'detailed',
      },
      date: new Date().toISOString().split('T')[0],
    }

    return renderTemplate(context.template.systemPrompt, templateContext)
  }

  /**
   * 构建 User Prompt
   */
  private buildUserPrompt(
    context: ReviewContext, 
    diff: string,
    files: { filename: string }[]
  ): string {
    // 构建文件列表，标注变更类型
    const fileList = files.map(f => `- ${f.filename}`).join('\n')
    
    return `# Pull Request 代码审查

## 基本信息
| 项目 | 内容 |
|------|------|
| **标题** | ${context.pullRequest.title} |
| **作者** | ${context.pullRequest.author} |
| **分支** | \`${context.pullRequest.headBranch}\` → \`${context.pullRequest.baseBranch}\` |
| **变更文件数** | ${files.length} |

## 变更文件列表
${fileList}

## 代码变更 (Diff)

\`\`\`diff
${diff}
\`\`\`

---

## 审查任务

请仔细审查上述代码变更，识别潜在问题并提供建设性反馈。

### 输出要求

请严格按照以下 JSON 格式输出审查结果：

\`\`\`json
{
  "decision": "APPROVED",
  "summary": "代码变更整体良好。发现1个需关注的问题：文章存在性检查缺失。建议在创建评论前添加验证逻辑。",
  "comments": [
    {
      "path": "src/example.ts",
      "line": 42,
      "body": "**[BUG:HIGH]** 空指针异常风险\\n\\n**问题**: \`user.name\` 在 user 为 null 时会抛出异常\\n**影响**: 生产环境可能出现未捕获的异常\\n**建议**: 使用可选链 \`user?.name\` 或添加空值检查"
    }
  ]
}
\`\`\`

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| \`decision\` | string | **APPROVED** / **REQUEST_CHANGES** / **COMMENT** |
| \`summary\` | string | **简短的**审查总结（1-3句话），只概述主要发现和决策理由，不要详细展开 |
| \`comments\` | array | 行级评论数组，只针对有问题的代码行 |
| \`comments[].path\` | string | 完整的文件路径（必须与 diff 中的文件路径完全匹配） |
| \`comments[].line\` | number | 新文件中的行号（必须是 diff 中实际存在的行） |
| \`comments[].body\` | string | 评论内容，使用 **[CATEGORY:SEVERITY]** 格式开头 |

### 注意事项

1. **行号准确性**: line 必须是 diff 中新增或修改行的实际行号
2. **路径准确性**: path 必须与变更文件列表中的路径完全一致
3. **评论质量**: 每条评论必须包含问题描述、影响分析和修复建议
4. **避免噪音**: 不要对正确的代码或风格偏好进行不必要的评论
5. **JSON 格式**: 确保输出是有效的 JSON，不要添加额外的文字说明`
  }

  /**
   * 调用 AI 模型
   * 支持直接 AI 调用模式和 OpenCode SDK 模式
   */
  private async callAI(systemPrompt: string, userPrompt: string): Promise<string> {
    // 优先使用直接 AI 调用模式
    if (this.directClient) {
      return this.callDirectAI(systemPrompt, userPrompt)
    }
    
    // 否则使用 OpenCode SDK 模式
    return this.callOpenCodeAI(systemPrompt, userPrompt)
  }

  /**
   * 直接调用 AI API
   */
  private async callDirectAI(systemPrompt: string, userPrompt: string): Promise<string> {
    if (!this.directClient) {
      throw new Error('Direct AI client is not initialized')
    }

    try {
      console.log('[ReviewEngine] Using direct AI mode...')
      console.log('[ReviewEngine] Model config:', JSON.stringify(this.config.model))
      
      if (this.config.debug) {
        console.log('[ReviewEngine] System prompt length:', systemPrompt.length)
        console.log('[ReviewEngine] User prompt length:', userPrompt.length)
      }

      const result = await this.directClient.prompt(userPrompt, {
        systemPrompt,
      })

      console.log('[ReviewEngine] AI response received, length:', result.text.length)
      if (result.usage) {
        console.log('[ReviewEngine] Tokens used:', result.usage.totalTokens)
      }
      if (this.config.debug) {
        console.log('[ReviewEngine] AI response preview:', result.text.substring(0, 500))
      }

      return result.text
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[ReviewEngine] Direct AI call failed:', errorMessage)
      
      return JSON.stringify({
        decision: 'COMMENT',
        summary: `⚠️ AI 审查失败: ${errorMessage}\n\n请检查 API Key 是否正确且有效。`,
        comments: [],
      })
    }
  }

  /**
   * 使用 OpenCode SDK 调用 AI
   */
  private async callOpenCodeAI(systemPrompt: string, userPrompt: string): Promise<string> {
    if (!this.aiClient) {
      throw new Error('OpenCode client is not initialized')
    }

    try {
      // 确保客户端已连接
      if (!this.aiClient.connected) {
        console.log('[ReviewEngine] Connecting to OpenCode server...')
        await this.aiClient.connect()
        console.log('[ReviewEngine] Connected successfully')
      }

      // 调试：获取可用的 providers
      try {
        const providersInfo = await this.aiClient.getProviders()
        console.log('[ReviewEngine] Available providers:', JSON.stringify(providersInfo, null, 2).substring(0, 1000))
      } catch (e) {
        console.log('[ReviewEngine] Failed to get providers:', e)
      }

      if (this.config.debug) {
        console.log('[ReviewEngine] System prompt length:', systemPrompt.length)
        console.log('[ReviewEngine] User prompt length:', userPrompt.length)
      }

      console.log('[ReviewEngine] Model config:', JSON.stringify(this.config.model))
      console.log('[ReviewEngine] API Key provided:', !!this.config.apiKey)

      // 调用 AI
      console.log('[ReviewEngine] Calling AI model via OpenCode SDK...')
      const result = await this.aiClient.prompt(userPrompt, {
        systemPrompt,
        model: this.config.model,
        apiKey: this.config.apiKey,
      })

      console.log('[ReviewEngine] AI response received, length:', result.text.length)
      if (this.config.debug) {
        console.log('[ReviewEngine] AI response preview:', result.text.substring(0, 500))
      }

      return result.text
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[ReviewEngine] OpenCode AI call failed:', errorMessage)
      
      return JSON.stringify({
        decision: 'COMMENT',
        summary: `⚠️ AI 审查失败: ${errorMessage}\n\n请检查 OpenCode 配置和 API Key 是否正确。`,
        comments: [],
      })
    }
  }

  /**
   * 解析 AI 响应
   * 支持 JSON 格式和 Markdown 格式的响应
   */
  private parseAIResponse(
    response: string,
    files: { filename: string }[]
  ): {
    decision: ReviewDecision
    summary: string
    comments: LineCommentRequest[]
  } {
    console.log('[ReviewEngine] Parsing AI response, length:', response.length)
    
    // 处理空响应
    if (!response || response.trim().length === 0) {
      console.warn('[ReviewEngine] AI response is empty!')
      return {
        decision: 'COMMENT',
        summary: '⚠️ AI 未返回有效响应。请检查 OpenCode 配置、模型设置和 API Key 是否正确。\n\n可能的原因：\n- 模型配置错误\n- API Key 无效或已过期\n- 服务连接问题',
        comments: [],
      }
    }

    if (this.config.debug) {
      console.log('[ReviewEngine] AI response preview:', response.substring(0, 500))
    }

    // 尝试直接解析整个响应为 JSON（如果 AI 返回的是纯 JSON）
    try {
      const directParsed = JSON.parse(response.trim())
      if (directParsed.decision && directParsed.summary !== undefined) {
        console.log('[ReviewEngine] Parsed as direct JSON')
        return this.processReviewResult(directParsed, files)
      }
    } catch {
      // 不是纯 JSON，继续尝试其他格式
    }

    // 尝试从响应中提取 JSON 代码块
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/)
    
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1])
        console.log('[ReviewEngine] Parsed from JSON code block')
        return this.processReviewResult(parsed, files)
      } catch (parseError) {
        console.warn('[ReviewEngine] Failed to parse JSON code block:', parseError)
      }
    }

    // 回退：使用 Markdown 格式解析
    console.log('[ReviewEngine] Falling back to Markdown parsing')
    return this.parseMarkdownResponse(response)
  }

  /**
   * 处理解析后的 Review 结果
   */
  private processReviewResult(
    parsed: { decision?: string; summary?: string; comments?: Array<{ path?: string; line?: number; body?: string; side?: 'LEFT' | 'RIGHT' }> },
    files: { filename: string }[]
  ): {
    decision: ReviewDecision
    summary: string
    comments: LineCommentRequest[]
  } {
    // 验证并清理 decision
    let decision: ReviewDecision = 'COMMENT'
    if (parsed.decision === 'APPROVED') {
      decision = 'APPROVED'
    } else if (parsed.decision === 'REQUEST_CHANGES') {
      decision = 'REQUEST_CHANGES'
    }

    // 验证并清理 comments
    const validFiles = new Set(files.map(f => f.filename))
    const comments: LineCommentRequest[] = (parsed.comments || [])
      .filter((c) => {
        // 确保评论指向有效的文件
        if (!c.path || !c.line || !c.body) return false
        return validFiles.has(c.path)
      })
      .map((c) => ({
        path: c.path!,
        line: c.line!,
        body: c.body!,
        side: c.side || 'RIGHT',
      }))

    const summary = parsed.summary || '代码审查完成。'
    console.log('[ReviewEngine] Result:', { decision, summaryLength: summary.length, commentsCount: comments.length })

    return {
      decision,
      summary,
      comments,
    }
  }

  /**
   * 解析 Markdown 格式的 AI 响应（兼容旧格式）
   */
  private parseMarkdownResponse(response: string): {
    decision: ReviewDecision
    summary: string
    comments: LineCommentRequest[]
  } {
    // 解析决策
    let decision: ReviewDecision = 'COMMENT'
    const decisionMatch = response.match(/\*{0,2}决策\*{0,2}[：:]\s*(APPROVED|REQUEST_CHANGES|COMMENT)/i)
    if (decisionMatch) {
      const d = decisionMatch[1].toUpperCase()
      if (d === 'APPROVED') decision = 'APPROVED'
      else if (d === 'REQUEST_CHANGES') decision = 'REQUEST_CHANGES'
    } else if (response.toLowerCase().includes('approved')) {
      decision = 'APPROVED'
    } else if (response.toLowerCase().includes('request_changes') || response.toLowerCase().includes('request changes')) {
      decision = 'REQUEST_CHANGES'
    }

    // 提取总结
    const summaryMatch = response.match(/#{1,3}\s*总结\s*\n([\s\S]*?)(?=\n#{1,3}|$)/)
    const summary = summaryMatch ? summaryMatch[1].trim() : response.substring(0, 500)

    // 尝试提取行级评论（格式：文件:行号 - 内容）
    const comments: LineCommentRequest[] = []
    const commentPattern = /[-*]\s*`?([^`\n:]+):(\d+)`?\s*[-–:]\s*(.+?)(?=\n[-*]|\n\n|$)/g
    let match
    while ((match = commentPattern.exec(response)) !== null) {
      comments.push({
        path: match[1].trim(),
        line: parseInt(match[2], 10),
        body: match[3].trim(),
        side: 'RIGHT',
      })
    }

    return {
      decision,
      summary: summary || '代码审查完成。',
      comments,
    }
  }
}

/**
 * 创建 Review 引擎实例
 */
export function createReviewEngine(config?: ReviewEngineConfig): ReviewEngine {
  return new ReviewEngine(config)
}
