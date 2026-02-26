/**
 * Review Executor Service
 * Extracted from webhooks.ts — handles ReviewEngine creation and review execution
 */

import { eq } from "drizzle-orm";
import { getDatabase } from "../db/client";
import {
  repositories,
  reviews,
  aiProviders,
  reviewTemplates,
  platformCredentials,
} from "../db/schema/index";
import {
  createProvider,
  ReviewEngine,
  getDefaultTemplate,
  type WebhookEvent,
  type ReviewTemplate,
  type ReviewCategory,
  type ReviewSeverity,
} from "@opencode-review/core";
import { decrypt, isEncrypted } from "../utils/crypto";

// ReviewEngine 实例缓存（按配置缓存）
export const reviewEngineCache = new Map<string, ReviewEngine>();

/**
 * 获取或创建 ReviewEngine 实例
 * 支持从数据库读取用户的 AI 供应商配置
 */
export async function getReviewEngineForUser(
  userId: string,
): Promise<ReviewEngine> {
  const db = getDatabase();

  // 查找用户的默认 AI 供应商
  let [aiProvider] = await db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.userId, userId))
    .orderBy(aiProviders.isDefault)
    .limit(1);

  // 如果用户没有配置 AI 供应商，使用环境变量配置
  if (!aiProvider) {
    console.log(
      "[ReviewEngine] No AI provider configured for user, using environment config",
    );
    return getDefaultReviewEngine();
  }

  // 创建缓存键
  const cacheKey = `${aiProvider.id}:${aiProvider.updatedAt?.toISOString() || aiProvider.createdAt.toISOString()}`;

  // 检查缓存
  if (reviewEngineCache.has(cacheKey)) {
    return reviewEngineCache.get(cacheKey)!;
  }

  console.log(
    `[ReviewEngine] Creating engine for AI provider: ${aiProvider.name} (${aiProvider.provider})`,
  );

  // 构建模型 ID - 直接模式不需要 provider 前缀
  const modelID = aiProvider.defaultModel || "deepseek-chat";

  const apiKey =
    aiProvider.apiKey && isEncrypted(aiProvider.apiKey)
      ? decrypt(aiProvider.apiKey)
      : aiProvider.apiKey || "";

  const engine = new ReviewEngine({
    provider: aiProvider.provider,
    model: modelID,
    apiKey,
    baseUrl: aiProvider.baseUrl || undefined,
    debug: process.env.NODE_ENV !== "production",
  });

  // 更新最后使用时间
  await db
    .update(aiProviders)
    .set({ lastUsedAt: new Date() })
    .where(eq(aiProviders.id, aiProvider.id));

  // 缓存引擎（限制缓存大小）
  if (reviewEngineCache.size > 100) {
    const firstKey = reviewEngineCache.keys().next().value;
    if (firstKey) {
      reviewEngineCache.delete(firstKey);
    }
  }
  reviewEngineCache.set(cacheKey, engine);

  return engine;
}

/**
 * 获取默认的 ReviewEngine（使用环境变量配置）
 */
export function getDefaultReviewEngine(): ReviewEngine {
  const cacheKey = "default";

  if (reviewEngineCache.has(cacheKey)) {
    return reviewEngineCache.get(cacheKey)!;
  }

  const engine = new ReviewEngine({
    provider: process.env.OPENCODE_PROVIDER_ID || "deepseek",
    model: process.env.OPENCODE_MODEL_ID || "deepseek-chat",
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: process.env.OPENCODE_BASE_URL || undefined,
    debug: process.env.NODE_ENV !== "production",
  });

  reviewEngineCache.set(cacheKey, engine);
  return engine;
}

/**
 * 异步执行 Review
 */
export async function executeReviewAsync(
  reviewId: string,
  repo: typeof repositories.$inferSelect,
  event: WebhookEvent,
  provider: ReturnType<typeof createProvider>,
) {
  const db = getDatabase();
  const startTime = Date.now();

  try {
    // 更新状态为 processing
    await db
      .update(reviews)
      .set({ status: "processing" })
      .where(eq(reviews.id, reviewId));

    const [owner, repoName] = repo.name.split("/");
    const prNumber = event.pullRequest.number;

    console.log(
      `[Review] Starting AI review for PR #${prNumber} in ${repo.name}`,
    );

    // 获取审查模板：优先使用仓库关联的模板，否则使用默认模板
    let template: ReviewTemplate = getDefaultTemplate();

    if (repo.templateId) {
      const [customTemplate] = await db
        .select()
        .from(reviewTemplates)
        .where(eq(reviewTemplates.id, repo.templateId));

      if (customTemplate) {
        console.log(`[Review] Using custom template: ${customTemplate.name}`);
        template = {
          id: customTemplate.id,
          name: customTemplate.name,
          description: customTemplate.description || "",
          systemPrompt: customTemplate.systemPrompt,
          categories: (customTemplate.categories || [
            "BUG",
            "SECURITY",
            "PERFORMANCE",
            "STYLE",
          ]) as ReviewCategory[],
          severities: (customTemplate.severities || [
            "CRITICAL",
            "HIGH",
            "MEDIUM",
            "LOW",
          ]) as ReviewSeverity[],
          isSystem: customTemplate.isSystem,
          isDefault: customTemplate.isDefault,
        };
      }
    }

    // 获取 ReviewEngine 实例（使用用户配置的 AI 供应商）
    const engine = await getReviewEngineForUser(repo.userId);

    // 执行 AI 审查
    const result = await engine.executeReview({
      provider,
      repository: {
        owner,
        repo: repoName,
        fullName: repo.name,
      },
      pullRequest: {
        number: prNumber,
        title: event.pullRequest.title,
        author: event.pullRequest.author.login,
        baseBranch: event.pullRequest.base?.ref || "main",
        headBranch: event.pullRequest.head?.ref || "unknown",
      },
      template,
      config: {
        language: "zh-CN",
        style: "detailed",
      },
    });

    if (!result.success) {
      throw new Error(result.error || "Review execution failed");
    }

    // 更新 Review 记录
    await db
      .update(reviews)
      .set({
        status: "completed",
        decision: result.decision || "COMMENT",
        summary: result.summary,
        commentsCount: result.commentsCount || 0,
        model: process.env.OPENCODE_MODEL_ID || "deepseek/deepseek-chat",
        tokensUsed: result.tokensUsed,
        durationMs: result.durationMs || Date.now() - startTime,
        completedAt: new Date(),
      })
      .where(eq(reviews.id, reviewId));

    // 更新仓库统计
    await db
      .update(repositories)
      .set({
        reviewCount: repo.reviewCount + 1,
        lastReviewAt: new Date(),
      })
      .where(eq(repositories.id, repo.id));

    console.log(
      `[Review] Completed review ${reviewId} in ${result.durationMs || Date.now() - startTime}ms`,
    );
  } catch (error) {
    console.error(`[Review] Failed:`, error);

    await db
      .update(reviews)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        completedAt: new Date(),
      })
      .where(eq(reviews.id, reviewId));
  }
}

/**
 * Simplified review execution for retry — creates its own provider and fetches PR event data
 */
export async function executeReviewForRetry(
  reviewId: string,
  repo: typeof repositories.$inferSelect,
): Promise<void> {
  const db = getDatabase();

  // Get access token
  let accessToken =
    repo.accessToken && isEncrypted(repo.accessToken)
      ? decrypt(repo.accessToken)
      : repo.accessToken;

  if (repo.platformCredentialId) {
    const [platform] = await db
      .select()
      .from(platformCredentials)
      .where(eq(platformCredentials.id, repo.platformCredentialId));
    if (platform) {
      accessToken =
        platform.accessToken && isEncrypted(platform.accessToken)
          ? decrypt(platform.accessToken)
          : platform.accessToken;
    }
  }

  if (!accessToken) {
    throw new Error("Repository has no access token configured");
  }

  // Get the review record to find PR info
  const [review] = await db
    .select()
    .from(reviews)
    .where(eq(reviews.id, reviewId));

  if (!review) {
    throw new Error(`Review ${reviewId} not found`);
  }

  // Create provider
  const baseUrl = new URL(repo.url).origin;
  const provider = createProvider({
    type: repo.provider as "gitea" | "github" | "gitlab",
    baseUrl,
    token: accessToken,
  });

  // Get PR to build event-like context
  const [owner, repoName] = repo.name.split("/");
  const pr = await provider.getPullRequest(owner, repoName, review.prNumber);

  // Build a minimal WebhookEvent for executeReviewAsync
  const event: WebhookEvent = {
    id: `retry-${reviewId}`,
    type: 'pull_request.opened',
    provider: repo.provider as 'gitea' | 'github' | 'gitlab',
    repository: {
      fullName: repo.name,
      url: repo.url,
    },
    sender: { id: 0, login: pr.author.login, avatarUrl: '' },
    pullRequest: pr,
    timestamp: new Date(),
  };

  await executeReviewAsync(reviewId, repo, event, provider);
}
