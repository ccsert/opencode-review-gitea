/**
 * Review 引擎 - 集成 OpenCode SDK 执行代码审查
 */

import type { GitProvider } from '../providers/types'
import type { ReviewTemplate, ReviewDecision, CreateReviewRequest, LineCommentRequest } from '../types'
import type { WebhookEvent } from '../events/types'
import { renderTemplate } from '../templates/renderer'
import { OpenCodeClient, type OpenCodeClientConfig } from '../ai/client'

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
  private aiClient: OpenCodeClient

  constructor(config: ReviewEngineConfig = {}) {
    this.config = {
      model: {
        providerID: 'opencode',
        modelID: 'deepseek/deepseek-chat',
      },
      debug: false,
      ...config,
    }

    // 初始化 AI 客户端
    this.aiClient = new OpenCodeClient({
      hostname: config.opencode?.hostname,
      port: config.opencode?.port,
      serverUrl: config.opencode?.serverUrl,
      model: this.config.model,
    })
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
    return `请审查以下 Pull Request:

## PR 信息
- 标题: ${context.pullRequest.title}
- 作者: ${context.pullRequest.author}
- 分支: ${context.pullRequest.headBranch} → ${context.pullRequest.baseBranch}

## 变更文件
${files.map(f => `- ${f.filename}`).join('\n')}

## 代码 Diff
\`\`\`diff
${diff}
\`\`\`

请按照指定格式进行审查，并给出你的决策（APPROVED/REQUEST_CHANGES/COMMENT）。

## 输出格式要求

请使用以下 JSON 格式输出审查结果：

\`\`\`json
{
  "decision": "APPROVED|REQUEST_CHANGES|COMMENT",
  "summary": "审查总结内容",
  "comments": [
    {
      "path": "文件路径",
      "line": 行号,
      "body": "评论内容，使用 **[CATEGORY:SEVERITY]** 格式标记问题类型"
    }
  ]
}
\`\`\`

其中：
- decision: 必须是 APPROVED、REQUEST_CHANGES 或 COMMENT 之一
- summary: 整体审查总结
- comments: 行级评论数组，每个评论必须指定 path（文件路径）、line（行号）和 body（评论内容）
- 评论中使用标签格式：**[CATEGORY:SEVERITY]**
  - CATEGORY: BUG, SECURITY, PERFORMANCE, STYLE, DOCS, TEST, LOGIC, REFACTOR
  - SEVERITY: CRITICAL, HIGH, MEDIUM, LOW`
  }

  /**
   * 调用 AI 模型
   * 使用 OpenCode SDK 执行代码审查
   */
  private async callAI(systemPrompt: string, userPrompt: string): Promise<string> {
    try {
      // 确保客户端已连接
      if (!this.aiClient.connected) {
        await this.aiClient.connect()
      }

      if (this.config.debug) {
        console.log('[ReviewEngine] Connecting to OpenCode server...')
        console.log('[ReviewEngine] System prompt:', systemPrompt.substring(0, 200) + '...')
        console.log('[ReviewEngine] User prompt:', userPrompt.substring(0, 200) + '...')
      }

      // 调用 AI
      const result = await this.aiClient.prompt(userPrompt, {
        systemPrompt,
        model: this.config.model,
      })

      if (this.config.debug) {
        console.log('[ReviewEngine] AI response:', result.text.substring(0, 500) + '...')
      }

      return result.text
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[ReviewEngine] AI call failed:', errorMessage)
      
      // 返回一个安全的默认响应
      return JSON.stringify({
        decision: 'COMMENT',
        summary: `AI 审查暂时不可用: ${errorMessage}`,
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
    // 尝试从响应中提取 JSON
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/)
    
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1])
        
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
          .filter((c: { path?: string; line?: number; body?: string }) => {
            // 确保评论指向有效的文件
            if (!c.path || !c.line || !c.body) return false
            return validFiles.has(c.path)
          })
          .map((c: { path: string; line: number; body: string; side?: 'LEFT' | 'RIGHT' }) => ({
            path: c.path,
            line: c.line,
            body: c.body,
            side: c.side || 'RIGHT',
          }))

        return {
          decision,
          summary: parsed.summary || '代码审查完成。',
          comments,
        }
      } catch (parseError) {
        if (this.config.debug) {
          console.warn('[ReviewEngine] Failed to parse JSON response:', parseError)
        }
        // 继续使用 Markdown 解析
      }
    }

    // 回退：使用 Markdown 格式解析
    return this.parseMarkdownResponse(response)
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
