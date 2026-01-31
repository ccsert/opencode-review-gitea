/**
 * Review 引擎 - 集成 OpenCode SDK 执行代码审查
 */

import type { GitProvider } from '../providers/types'
import type { ReviewTemplate, ReviewDecision, CreateReviewRequest } from '../types'
import type { WebhookEvent } from '../events/types'
import { renderTemplate } from '../templates/renderer'

export interface ReviewEngineConfig {
  /** OpenCode 服务器配置 */
  opencode?: {
    port?: number
    hostname?: string
  }
  /** 默认模型 */
  model?: string
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

  constructor(config: ReviewEngineConfig = {}) {
    this.config = {
      model: 'deepseek/deepseek-chat',
      debug: false,
      ...config,
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
      // TODO: 集成 @opencode-ai/sdk
      // 暂时返回模拟结果
      const aiResult = await this.callAI(systemPrompt, userPrompt)

      // 4. 解析 AI 响应
      const { decision, summary, comments } = this.parseAIResponse(aiResult)

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

请按照指定格式进行审查，并给出你的决策（APPROVED/REQUEST_CHANGES/COMMENT）。`
  }

  /**
   * 调用 AI 模型
   * TODO: 使用 @opencode-ai/sdk 实现
   */
  private async callAI(systemPrompt: string, userPrompt: string): Promise<string> {
    // 临时实现：返回模拟响应
    // 后续将替换为 OpenCode SDK 调用
    console.log('[ReviewEngine] AI call with prompts:')
    console.log('System:', systemPrompt.substring(0, 100) + '...')
    console.log('User:', userPrompt.substring(0, 100) + '...')
    
    return `## 审查结果

**决策**: COMMENT

### 总结
代码看起来不错，有一些小建议可以考虑。

### 评论
暂无行级评论。
`
  }

  /**
   * 解析 AI 响应
   */
  private parseAIResponse(response: string): {
    decision: ReviewDecision
    summary: string
    comments?: { path: string; line: number; body: string }[]
  } {
    // 解析决策
    let decision: ReviewDecision = 'COMMENT'
    if (response.includes('APPROVED') || response.includes('approved')) {
      decision = 'APPROVED'
    } else if (response.includes('REQUEST_CHANGES') || response.includes('request changes')) {
      decision = 'REQUEST_CHANGES'
    }

    // 提取总结
    const summaryMatch = response.match(/### 总结\n([\s\S]*?)(?=\n###|$)/)
    const summary = summaryMatch ? summaryMatch[1].trim() : response

    // TODO: 解析行级评论

    return {
      decision,
      summary,
      comments: [],
    }
  }
}

/**
 * 创建 Review 引擎实例
 */
export function createReviewEngine(config?: ReviewEngineConfig): ReviewEngine {
  return new ReviewEngine(config)
}
