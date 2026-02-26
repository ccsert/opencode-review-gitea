/**
 * Review Engine — Mastra Agent + structured output
 * Simplified from 544 lines to ~150 lines
 */

import type { GitProvider } from "../providers/types";
import type {
  ReviewDecision,
  CreateReviewRequest,
  ReviewTemplate,
} from "../types";
import { renderTemplate } from "../templates/renderer";
import { createReviewAgent } from "../ai/agent";
import { reviewResultSchema, type ReviewOutput } from "../ai/schemas";
import { resolveModelId } from "../ai/provider";
import { ReviewContextEnricher } from "./enricher";

export interface ReviewEngineConfig {
  apiKey: string;
  baseUrl?: string;
  provider: string; // e.g. 'deepseek', 'openai', 'anthropic'
  model: string; // e.g. 'deepseek-chat', 'gpt-4o'
  debug?: boolean;
}

export interface ReviewResult {
  success: boolean;
  decision?: ReviewDecision;
  summary?: string;
  commentsCount?: number;
  tokensUsed?: number;
  durationMs?: number;
  error?: string;
}

export interface ReviewContext {
  provider: GitProvider;
  repository: {
    owner: string;
    repo: string;
    fullName: string;
  };
  pullRequest: {
    number: number;
    title: string;
    author: string;
    baseBranch: string;
    headBranch: string;
  };
  template: ReviewTemplate;
  config?: {
    language?: string;
    style?: string;
  };
}

/**
 * Review Engine — orchestrates AI code review via Mastra Agent
 */
export class ReviewEngine {
  private config: ReviewEngineConfig;
  private enricher: ReviewContextEnricher;

  constructor(config: ReviewEngineConfig) {
    this.config = config;
    this.enricher = new ReviewContextEnricher();
  }

  async executeReview(context: ReviewContext): Promise<ReviewResult> {
    const startTime = Date.now();

    try {
      // 1. Get PR diff
      const { owner, repo } = context.repository;
      const prNumber = context.pullRequest.number;
      const diff = await context.provider.getPullRequestDiff(
        owner,
        repo,
        prNumber,
      );

      if (!diff || diff.trim().length === 0) {
        return {
          success: true,
          decision: "COMMENT",
          summary: "No code changes detected, skipping review.",
          commentsCount: 0,
          durationMs: Date.now() - startTime,
        };
      }

      // 2. Enrich context (extensible pipeline)
      const changedFiles: string[] = [];
      const enrichments = await this.enricher.enrich({
        owner,
        repo,
        pullNumber: prNumber,
        diff,
        changedFiles,
      });
      const enrichmentText = this.enricher.formatForPrompt(enrichments);

      // 3. Build prompts
      const systemPrompt = this.buildSystemPrompt(context);
      const userPrompt = this.buildUserPrompt(context, diff, enrichmentText);

      // 4. Create agent and generate structured output
      const modelId = resolveModelId({
        provider: this.config.provider,
        model: this.config.model,
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
      });

      const agent = createReviewAgent({
        model: modelId,
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
        instructions: systemPrompt,
        provider: context.provider,
      });

      if (this.config.debug) {
        console.log("[ReviewEngine] Using model:", modelId);
        console.log(
          "[ReviewEngine] System prompt length:",
          systemPrompt.length,
        );
        console.log("[ReviewEngine] User prompt length:", userPrompt.length);
      }

      const result = await agent.generate(userPrompt, {
        maxSteps: 3,
        structuredOutput: {
          schema: reviewResultSchema,
        },
      });

      const parsed = reviewResultSchema.safeParse(result.object);
      if (!parsed.success) {
        if (this.config.debug) {
          console.error(
            "[ReviewEngine] AI output validation failed:",
            parsed.error.format(),
          );
        }
        return {
          success: false,
          error: `AI output validation failed: ${parsed.error.message}`,
          durationMs: Date.now() - startTime,
        };
      }
      const output: ReviewOutput = parsed.data;

      // 5. Submit review to Git platform
      const review: CreateReviewRequest = {
        body: output.summary,
        decision: output.decision,
        comments: output.comments.map((c) => ({
          path: c.path,
          line: c.line,
          body: c.body,
          side: "RIGHT" as const,
        })),
      };

      await context.provider.createReview(owner, repo, prNumber, review);

      return {
        success: true,
        decision: output.decision,
        summary: output.summary,
        commentsCount: output.comments.length,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (this.config.debug) {
        console.error("[ReviewEngine] Review failed:", error);
      }

      return {
        success: false,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }

  private buildSystemPrompt(context: ReviewContext): string {
    const templateContext = {
      repo: {
        name: context.repository.fullName,
        provider: "gitea",
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
        language: context.config?.language || "zh-CN",
        style: context.config?.style || "detailed",
      },
      date: new Date().toISOString().split("T")[0],
    };

    return renderTemplate(context.template.systemPrompt, templateContext);
  }

  private buildUserPrompt(
    context: ReviewContext,
    diff: string,
    enrichmentText: string,
  ): string {
    return `## Pull Request Review

**Title**: ${context.pullRequest.title}
**Author**: ${context.pullRequest.author}
**Branch**: \`${context.pullRequest.headBranch}\` → \`${context.pullRequest.baseBranch}\`

## Code Changes (Diff)

\`\`\`diff
${diff}
\`\`\`
${enrichmentText}

Please review the above code changes carefully. Identify potential issues and provide constructive feedback.
Your response will be parsed as structured data — provide decision, summary, and line-level comments.`;
  }
}

export function createReviewEngine(config: ReviewEngineConfig): ReviewEngine {
  return new ReviewEngine(config);
}
