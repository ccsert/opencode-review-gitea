/**
 * Agent Runtime Service
 * Server-side glue that wires PlatformAgent with real Drizzle DB queries.
 * Implements all ToolDeps interfaces and caches Agent instances per user.
 */

import { eq, and, desc, sql, gte, lte, count } from "drizzle-orm";
import { ulid } from "ulid";
import { getDatabase, getDatabaseType } from "../db/client";
import {
  repositories,
  reviews,
  aiProviders,
  reviewTemplates,
  webhookLogs,
  users,
} from "../db/schema/index";
import {
  createPlatformAgent,
  getAllSystemTemplates,
  type PlatformAgentDeps,
} from "@opencode-review/core";
import type { PlatformToolContext } from "@opencode-review/core";
import type { TemplateToolDeps } from "@opencode-review/core";
import type { RepoToolDeps } from "@opencode-review/core";
import type { ReviewToolDeps } from "@opencode-review/core";
import type { AIConfigToolDeps } from "@opencode-review/core";
import type { WebhookToolDeps } from "@opencode-review/core";
import type { SystemToolDeps } from "@opencode-review/core";
import { decrypt, isEncrypted, encrypt } from "../utils/crypto";

// Agent instance cache keyed by `${userId}:${aiProviderUpdatedAt}`
const agentCache = new Map<string, ReturnType<typeof createPlatformAgent>>();

/**
 * Get or create a Platform Agent for a given user.
 * Uses the user's default AI provider and caches the agent instance.
 */
export async function getPlatformAgent(
  userId: string,
): Promise<ReturnType<typeof createPlatformAgent>> {
  const db = getDatabase();

  // Find the user's default AI provider
  let [aiProvider] = await db
    .select()
    .from(aiProviders)
    .where(and(eq(aiProviders.userId, userId), eq(aiProviders.isDefault, true)))
    .limit(1);

  // Fallback: any enabled provider for this user
  if (!aiProvider) {
    [aiProvider] = await db
      .select()
      .from(aiProviders)
      .where(
        and(eq(aiProviders.userId, userId), eq(aiProviders.isEnabled, true)),
      )
      .limit(1);
  }

  if (!aiProvider) {
    throw new Error(
      "No AI provider configured. Please add an AI provider in Settings.",
    );
  }

  // Cache key includes updatedAt to invalidate on config change
  const cacheKey = `${userId}:${aiProvider.id}:${aiProvider.updatedAt?.toISOString() ?? aiProvider.createdAt.toISOString()}`;

  if (agentCache.has(cacheKey)) {
    return agentCache.get(cacheKey)!;
  }

  // Decrypt API key
  const apiKey =
    aiProvider.apiKey && isEncrypted(aiProvider.apiKey)
      ? decrypt(aiProvider.apiKey)
      : (aiProvider.apiKey ?? "");

  const modelId = aiProvider.defaultModel ?? "deepseek-chat";

  // Look up user for role mapping
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const userRole = mapUserRole(user?.role ?? "user");

  // Build PlatformToolContext
  const ctx: PlatformToolContext = {
    db: { query: <T>(fn: () => Promise<T>) => fn() },
    userId,
    userRole,
  };

  // Build all ToolDeps
  const deps: PlatformAgentDeps = {
    template: buildTemplateDeps(),
    repo: buildRepoDeps(),
    review: buildReviewDeps(),
    aiConfig: buildAIConfigDeps(),
    webhook: buildWebhookDeps(),
    system: buildSystemDeps(),
  };

  const agent = createPlatformAgent({
    model: `${aiProvider.provider}/${modelId}`,
    apiKey,
    baseUrl: aiProvider.baseUrl ?? undefined,
    ctx,
    deps,
  });

  // Evict oldest if cache too large
  if (agentCache.size > 50) {
    const firstKey = agentCache.keys().next().value;
    if (firstKey) {
      agentCache.delete(firstKey);
    }
  }
  agentCache.set(cacheKey, agent);

  // Update last used
  await db
    .update(aiProviders)
    .set({ lastUsedAt: new Date() })
    .where(eq(aiProviders.id, aiProvider.id));

  return agent;
}

/**
 * Invalidate cached agent for a user (e.g. after AI provider config change)
 */
export function invalidateAgentCache(userId?: string): void {
  if (!userId) {
    agentCache.clear();
    return;
  }
  for (const key of agentCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      agentCache.delete(key);
    }
  }
}

// ─── Role Mapping ─────────────────────────────────────────────────────

export function mapUserRole(dbRole: string): "admin" | "member" | "viewer" {
  switch (dbRole) {
    case "admin":
      return "admin";
    case "user":
      return "member";
    default:
      return "viewer";
  }
}

// ─── Platform Context Builder ─────────────────────────────────────────

/**
 * Build a PlatformToolContext and PlatformAgentDeps for a given user.
 * Used by the MCP HTTP proxy route to create per-request context.
 */
export function buildPlatformContext(
  userId: string,
  userRole: "admin" | "member" | "viewer" = "member",
): { ctx: PlatformToolContext; deps: PlatformAgentDeps } {
  const ctx: PlatformToolContext = {
    db: { query: <T>(fn: () => Promise<T>) => fn() },
    userId,
    userRole,
  };

  const deps: PlatformAgentDeps = {
    template: buildTemplateDeps(),
    repo: buildRepoDeps(),
    review: buildReviewDeps(),
    aiConfig: buildAIConfigDeps(),
    webhook: buildWebhookDeps(),
    system: buildSystemDeps(),
  };

  return { ctx, deps };
}

// ─── Template ToolDeps ────────────────────────────────────────────────

function buildTemplateDeps(): TemplateToolDeps {
  const systemTemplates = getAllSystemTemplates();

  return {
    listTemplates: async (userId: string) => {
      const db = getDatabase();
      const userTemplates = await db
        .select({
          id: reviewTemplates.id,
          name: reviewTemplates.name,
          description: reviewTemplates.description,
          isSystem: reviewTemplates.isSystem,
          isDefault: reviewTemplates.isDefault,
          categories: reviewTemplates.categories,
          severities: reviewTemplates.severities,
          createdAt: reviewTemplates.createdAt,
        })
        .from(reviewTemplates)
        .where(eq(reviewTemplates.userId, userId));

      // Include system templates
      const sysEntries = systemTemplates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description ?? null,
        isSystem: true,
        isDefault: t.isDefault,
        categories: t.categories as string[],
        severities: t.severities as string[],
        createdAt: null as Date | null,
      }));

      return [...sysEntries, ...userTemplates];
    },

    getTemplate: async (id: string) => {
      // Check system templates first
      const sys = systemTemplates.find((t) => t.id === id);
      if (sys) {
        return {
          id: sys.id,
          name: sys.name,
          description: sys.description ?? null,
          systemPrompt: sys.systemPrompt,
          isSystem: true,
          isDefault: sys.isDefault,
          categories: sys.categories as string[],
          severities: sys.severities as string[],
          createdAt: null,
          updatedAt: null,
        };
      }

      const db = getDatabase();
      const [tpl] = await db
        .select()
        .from(reviewTemplates)
        .where(eq(reviewTemplates.id, id));

      if (!tpl) return null;

      return {
        id: tpl.id,
        name: tpl.name,
        description: tpl.description,
        systemPrompt: tpl.systemPrompt,
        isSystem: tpl.isSystem,
        isDefault: tpl.isDefault,
        categories: tpl.categories,
        severities: tpl.severities,
        createdAt: tpl.createdAt,
        updatedAt: tpl.updatedAt,
      };
    },

    createTemplate: async (data) => {
      const db = getDatabase();
      const id = ulid();
      await db.insert(reviewTemplates).values({
        id,
        userId: data.userId,
        name: data.name,
        description: data.description ?? null,
        systemPrompt: data.systemPrompt,
        categories: data.categories ?? [
          "BUG",
          "SECURITY",
          "PERFORMANCE",
          "STYLE",
        ],
        severities: data.severities ?? ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
      });
      return { id, name: data.name };
    },

    updateTemplate: async (id, data) => {
      const db = getDatabase();
      const [existing] = await db
        .select({ id: reviewTemplates.id })
        .from(reviewTemplates)
        .where(eq(reviewTemplates.id, id));

      if (!existing) return null;

      // If setting as default, unset other defaults first
      if (data.isDefault) {
        const [tpl] = await db
          .select({ userId: reviewTemplates.userId })
          .from(reviewTemplates)
          .where(eq(reviewTemplates.id, id));
        if (tpl?.userId) {
          await db
            .update(reviewTemplates)
            .set({ isDefault: false })
            .where(eq(reviewTemplates.userId, tpl.userId));
        }
      }

      await db
        .update(reviewTemplates)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(reviewTemplates.id, id));

      return { id, updated: true };
    },

    deleteTemplate: async (id) => {
      const db = getDatabase();
      // Check existence first (PGlite delete doesn't return rowCount)
      const [existing] = await db
        .select({ id: reviewTemplates.id })
        .from(reviewTemplates)
        .where(
          and(eq(reviewTemplates.id, id), eq(reviewTemplates.isSystem, false)),
        );

      if (!existing) return false;

      await db
        .delete(reviewTemplates)
        .where(
          and(eq(reviewTemplates.id, id), eq(reviewTemplates.isSystem, false)),
        );
      return true;
    },

    isSystemTemplate: (id: string) => {
      return systemTemplates.some((t) => t.id === id);
    },
  };
}

// ─── Repo ToolDeps ────────────────────────────────────────────────────

function buildRepoDeps(): RepoToolDeps {
  return {
    listRepos: async (userId: string) => {
      const db = getDatabase();
      const rows = await db
        .select({
          id: repositories.id,
          name: repositories.name,
          provider: repositories.provider,
          enabled: repositories.enabled,
          reviewCount: repositories.reviewCount,
          lastReviewAt: repositories.lastReviewAt,
        })
        .from(repositories)
        .where(eq(repositories.userId, userId))
        .orderBy(desc(repositories.createdAt));

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        fullName: r.name, // name is already in "owner/repo" format
        provider: r.provider,
        isActive: r.enabled,
        reviewCount: r.reviewCount,
        lastReviewAt: r.lastReviewAt,
      }));
    },

    getRepo: async (id: string) => {
      const db = getDatabase();
      const [repo] = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, id));

      if (!repo) return null;

      return {
        id: repo.id,
        name: repo.name,
        fullName: repo.name,
        provider: repo.provider,
        isActive: repo.enabled,
        config: (repo.config ?? {}) as Record<string, unknown>,
        createdAt: repo.createdAt,
        updatedAt: repo.updatedAt,
      };
    },

    configureRepo: async (id, config) => {
      const db = getDatabase();
      const [existing] = await db
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.id, id));

      if (!existing) return null;

      await db
        .update(repositories)
        .set({
          config: config as typeof repositories.$inferSelect.config,
          updatedAt: new Date(),
        })
        .where(eq(repositories.id, id));

      return { id, updated: true };
    },

    getRepoStats: async (id: string) => {
      const db = getDatabase();
      const [repo] = await db
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.id, id));

      if (!repo) return null;

      const [stats] = await db
        .select({
          totalReviews: count(),
          completedReviews: count(
            sql`CASE WHEN ${reviews.status} = 'completed' THEN 1 END`,
          ),
          failedReviews: count(
            sql`CASE WHEN ${reviews.status} = 'failed' THEN 1 END`,
          ),
          avgResponseTime: sql<number>`AVG(${reviews.durationMs})`.as(
            "avgResponseTime",
          ),
        })
        .from(reviews)
        .where(eq(reviews.repositoryId, id));

      const [lastReview] = await db
        .select({ lastReviewAt: reviews.createdAt })
        .from(reviews)
        .where(eq(reviews.repositoryId, id))
        .orderBy(desc(reviews.createdAt))
        .limit(1);

      return {
        totalReviews: Number(stats?.totalReviews ?? 0),
        completedReviews: Number(stats?.completedReviews ?? 0),
        failedReviews: Number(stats?.failedReviews ?? 0),
        avgResponseTime: stats?.avgResponseTime
          ? Number(stats.avgResponseTime)
          : undefined,
        lastReviewAt: lastReview?.lastReviewAt ?? null,
      };
    },
  };
}

// ─── Review ToolDeps ──────────────────────────────────────────────────

function buildReviewDeps(): ReviewToolDeps {
  return {
    listReviews: async (userId, filters) => {
      const db = getDatabase();

      // Get user's repository IDs first
      const userRepos = await db
        .select({ id: repositories.id, name: repositories.name })
        .from(repositories)
        .where(eq(repositories.userId, userId));

      if (userRepos.length === 0) return [];

      const repoIdSet = new Set(userRepos.map((r) => r.id));
      const repoNameMap = new Map(userRepos.map((r) => [r.id, r.name]));

      // Build conditions
      const conditions = [
        sql`${reviews.repositoryId} IN (${sql.join(
          userRepos.map((r) => sql`${r.id}`),
          sql`, `,
        )})`,
      ];

      if (filters?.repositoryId) {
        conditions.push(eq(reviews.repositoryId, filters.repositoryId));
      }
      if (filters?.status) {
        conditions.push(sql`${reviews.status} = ${filters.status}`);
      }
      if (filters?.startDate) {
        conditions.push(gte(reviews.createdAt, new Date(filters.startDate)));
      }
      if (filters?.endDate) {
        conditions.push(lte(reviews.createdAt, new Date(filters.endDate)));
      }

      const rows = await db
        .select()
        .from(reviews)
        .where(and(...conditions))
        .orderBy(desc(reviews.createdAt))
        .limit(filters?.limit ?? 50)
        .offset(filters?.offset ?? 0);

      return rows
        .filter((r) => repoIdSet.has(r.repositoryId))
        .map((r) => ({
          id: r.id,
          repositoryId: r.repositoryId,
          repositoryName: repoNameMap.get(r.repositoryId),
          prNumber: r.prNumber,
          prTitle: r.prTitle ?? undefined,
          prAuthor: r.prAuthor ?? undefined,
          status: r.status,
          decision: r.decision,
          createdAt: r.createdAt,
        }));
    },

    getReview: async (id: string) => {
      const db = getDatabase();
      const [review] = await db
        .select()
        .from(reviews)
        .where(eq(reviews.id, id));

      if (!review) return null;

      return {
        id: review.id,
        repositoryId: review.repositoryId,
        prNumber: review.prNumber,
        prTitle: review.prTitle ?? undefined,
        prAuthor: review.prAuthor ?? undefined,
        status: review.status,
        decision: review.decision,
        summary: review.summary,
        comments: null, // Comments are embedded in summary for now
        createdAt: review.createdAt,
        completedAt: review.completedAt,
      };
    },

    triggerReview: async (data) => {
      const db = getDatabase();
      const reviewId = ulid();

      await db.insert(reviews).values({
        id: reviewId,
        repositoryId: data.repositoryId,
        prNumber: data.prNumber,
        status: "pending",
        triggeredBy: data.userId,
        createdAt: new Date(),
      });

      // Fire-and-forget: actual review execution is handled by the webhook flow
      // The agent will report the reviewId and status
      return { reviewId, status: "pending" };
    },

    getReviewSummary: async (userId, period) => {
      const db = getDatabase();

      // Get user's repos
      const userRepos = await db
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.userId, userId));

      if (userRepos.length === 0) {
        return {
          totalReviews: 0,
          completedReviews: 0,
          failedReviews: 0,
          approvedCount: 0,
          requestChangesCount: 0,
          commentCount: 0,
        };
      }

      const conditions = [
        sql`${reviews.repositoryId} IN (${sql.join(
          userRepos.map((r) => sql`${r.id}`),
          sql`, `,
        )})`,
      ];

      if (period?.startDate) {
        conditions.push(gte(reviews.createdAt, new Date(period.startDate)));
      }
      if (period?.endDate) {
        conditions.push(lte(reviews.createdAt, new Date(period.endDate)));
      }

      const [stats] = await db
        .select({
          totalReviews: count(),
          completedReviews: count(
            sql`CASE WHEN ${reviews.status} = 'completed' THEN 1 END`,
          ),
          failedReviews: count(
            sql`CASE WHEN ${reviews.status} = 'failed' THEN 1 END`,
          ),
          approvedCount: count(
            sql`CASE WHEN ${reviews.decision} = 'APPROVED' THEN 1 END`,
          ),
          requestChangesCount: count(
            sql`CASE WHEN ${reviews.decision} = 'REQUEST_CHANGES' THEN 1 END`,
          ),
          commentCount: count(
            sql`CASE WHEN ${reviews.decision} = 'COMMENT' THEN 1 END`,
          ),
          avgCompletionTime: sql<number>`AVG(${reviews.durationMs})`.as(
            "avgCompletionTime",
          ),
        })
        .from(reviews)
        .where(and(...conditions));

      return {
        totalReviews: Number(stats?.totalReviews ?? 0),
        completedReviews: Number(stats?.completedReviews ?? 0),
        failedReviews: Number(stats?.failedReviews ?? 0),
        approvedCount: Number(stats?.approvedCount ?? 0),
        requestChangesCount: Number(stats?.requestChangesCount ?? 0),
        commentCount: Number(stats?.commentCount ?? 0),
        avgCompletionTime: stats?.avgCompletionTime
          ? Number(stats.avgCompletionTime)
          : undefined,
      };
    },
  };
}

// ─── AI Config ToolDeps ───────────────────────────────────────────────

function buildAIConfigDeps(): AIConfigToolDeps {
  return {
    listProviders: async (userId: string) => {
      const db = getDatabase();
      const rows = await db
        .select({
          id: aiProviders.id,
          name: aiProviders.name,
          provider: aiProviders.provider,
          baseUrl: aiProviders.baseUrl,
          models: aiProviders.models,
          defaultModel: aiProviders.defaultModel,
          isDefault: aiProviders.isDefault,
          isEnabled: aiProviders.isEnabled,
          lastUsedAt: aiProviders.lastUsedAt,
        })
        .from(aiProviders)
        .where(eq(aiProviders.userId, userId))
        .orderBy(desc(aiProviders.isDefault));

      return rows;
    },

    getProvider: async (id: string) => {
      const db = getDatabase();
      const [provider] = await db
        .select()
        .from(aiProviders)
        .where(eq(aiProviders.id, id));

      if (!provider) return null;

      return {
        id: provider.id,
        name: provider.name,
        provider: provider.provider,
        baseUrl: provider.baseUrl,
        models: provider.models,
        defaultModel: provider.defaultModel,
        isDefault: provider.isDefault,
        isEnabled: provider.isEnabled,
        config: (provider.config ?? {}) as Record<string, unknown>,
        lastUsedAt: provider.lastUsedAt,
        createdAt: provider.createdAt,
      };
    },

    configureProvider: async (userId, data) => {
      const db = getDatabase();
      const id = ulid();

      // Encrypt API key if provided
      const encryptedApiKey = data.apiKey ? encrypt(data.apiKey) : null;

      // If setting as default, unset other defaults first
      if (data.isDefault) {
        await db
          .update(aiProviders)
          .set({ isDefault: false })
          .where(eq(aiProviders.userId, userId));
      }

      await db.insert(aiProviders).values({
        id,
        userId,
        name: data.name,
        provider: data.provider,
        baseUrl: data.baseUrl ?? null,
        apiKey: encryptedApiKey,
        models: data.models ?? [],
        defaultModel: data.defaultModel ?? null,
        isDefault: data.isDefault ?? false,
        config: data.config ?? {},
      });

      return {
        id,
        name: data.name,
        provider: data.provider,
        isDefault: data.isDefault ?? false,
      };
    },

    testProvider: async (params) => {
      try {
        const baseUrl = params.baseUrl ?? "https://api.openai.com/v1";
        const response = await fetch(`${baseUrl}/models`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${params.apiKey ?? ""}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          return {
            connected: false,
            message: `Connection failed: HTTP ${response.status} ${response.statusText}`,
          };
        }

        const body = (await response.json()) as {
          data?: Array<{ id: string }>;
        };
        const models = body.data?.map((m) => m.id) ?? [];

        return {
          connected: true,
          models: models.slice(0, 20),
          message: `Connected successfully. Found ${models.length} models.`,
        };
      } catch (error) {
        return {
          connected: false,
          message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

// ─── Webhook ToolDeps ─────────────────────────────────────────────────

function buildWebhookDeps(): WebhookToolDeps {
  return {
    listWebhooks: async (repoId: string) => {
      const db = getDatabase();

      // If repoId is "all", list for all repos
      const condition =
        repoId === "all" ? undefined : eq(repositories.id, repoId);

      const rows = await db
        .select({
          id: repositories.id,
          repositoryId: repositories.id,
          repositoryName: repositories.name,
          provider: repositories.provider,
          webhookStatus: repositories.webhookStatus,
          webhookSecret: repositories.webhookSecret,
          enabled: repositories.enabled,
        })
        .from(repositories)
        .where(condition);

      const publicUrl = process.env.PUBLIC_URL ?? "http://localhost:3000";

      return rows.map((r) => ({
        id: r.id,
        repositoryId: r.repositoryId,
        repositoryName: r.repositoryName,
        provider: r.provider,
        webhookUrl: `${publicUrl}/api/v1/webhooks/${r.provider}/${r.id}`,
        webhookStatus: r.webhookStatus ?? "pending",
        secretConfigured: !!r.webhookSecret,
        enabled: r.enabled,
      }));
    },

    registerWebhook: async (repoId, _userId) => {
      const db = getDatabase();
      const publicUrl = process.env.PUBLIC_URL ?? "http://localhost:3000";
      const webhookUrl = `${publicUrl}/api/v1/webhooks`;

      // For now, just update the status — actual provider.createWebhook
      // requires platform credential access which is handled in routes/repos.ts
      const [repo] = await db
        .select()
        .from(repositories)
        .where(eq(repositories.id, repoId));

      if (!repo) {
        throw new Error(`Repository ${repoId} not found`);
      }

      const fullWebhookUrl = `${webhookUrl}/${repo.provider}/${repo.id}`;

      await db
        .update(repositories)
        .set({
          webhookStatus: "pending" as const,
          updatedAt: new Date(),
        })
        .where(eq(repositories.id, repoId));

      return {
        id: repo.id,
        webhookUrl: fullWebhookUrl,
        webhookStatus: "pending",
      };
    },

    deleteWebhook: async (repoId, _userId) => {
      const db = getDatabase();

      await db
        .update(repositories)
        .set({
          webhookId: null,
          webhookStatus: "pending" as const,
          webhookError: null,
          webhookSecret: null,
          updatedAt: new Date(),
        })
        .where(eq(repositories.id, repoId));

      return { deleted: true };
    },

    getWebhookHistory: async (repoId, options) => {
      const db = getDatabase();

      const [totalResult] = await db
        .select({ total: count() })
        .from(webhookLogs)
        .where(eq(webhookLogs.repositoryId, repoId));

      const rows = await db
        .select({
          id: webhookLogs.id,
          eventType: webhookLogs.eventType,
          deliveryId: webhookLogs.deliveryId,
          processed: webhookLogs.processed,
          reviewId: webhookLogs.reviewId,
          error: webhookLogs.error,
          createdAt: webhookLogs.createdAt,
        })
        .from(webhookLogs)
        .where(eq(webhookLogs.repositoryId, repoId))
        .orderBy(desc(webhookLogs.createdAt))
        .limit(options?.limit ?? 20)
        .offset(options?.offset ?? 0);

      return {
        items: rows,
        total: Number(totalResult?.total ?? 0),
      };
    },
  };
}

// ─── System ToolDeps ──────────────────────────────────────────────────

function buildSystemDeps(): SystemToolDeps {
  return {
    getHealth: async () => {
      try {
        const db = getDatabase();
        // Simple connectivity check
        await db.select({ id: users.id }).from(users).limit(1);

        const packageJson = await import("../../../../package.json").catch(
          () => ({ version: "unknown" }),
        );

        return {
          status: "healthy" as const,
          database: getDatabaseType(),
          version: (packageJson as { version?: string }).version ?? "unknown",
        };
      } catch (error) {
        return {
          status: "unhealthy" as const,
          database: getDatabaseType(),
          version: "unknown",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    getConfig: async () => {
      return {
        providers: ["gitea", "github", "gitlab"],
        features: {
          webhookAutoRegister: true,
          customTemplates: true,
          aiProviderConfig: true,
          multiUser: false, // Reserved for future
        },
        limits: {
          maxReposPerUser: 100,
          maxTemplatesPerUser: 50,
          maxAIProvidersPerUser: 10,
        },
      };
    },

    getDashboardData: async (userId: string) => {
      const db = getDatabase();

      // Repo count
      const [repoCountResult] = await db
        .select({ count: count() })
        .from(repositories)
        .where(eq(repositories.userId, userId));

      // Review stats
      const userRepos = await db
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.userId, userId));

      let reviewCount = 0;
      let completedReviews = 0;
      let failedReviews = 0;

      if (userRepos.length > 0) {
        const [stats] = await db
          .select({
            total: count(),
            completed: count(
              sql`CASE WHEN ${reviews.status} = 'completed' THEN 1 END`,
            ),
            failed: count(
              sql`CASE WHEN ${reviews.status} = 'failed' THEN 1 END`,
            ),
          })
          .from(reviews)
          .where(
            sql`${reviews.repositoryId} IN (${sql.join(
              userRepos.map((r) => sql`${r.id}`),
              sql`, `,
            )})`,
          );

        reviewCount = Number(stats?.total ?? 0);
        completedReviews = Number(stats?.completed ?? 0);
        failedReviews = Number(stats?.failed ?? 0);
      }

      // Recent activity (last 10 reviews)
      const recentReviews =
        userRepos.length > 0
          ? await db
              .select({
                id: reviews.id,
                status: reviews.status,
                prNumber: reviews.prNumber,
                prTitle: reviews.prTitle,
                repositoryId: reviews.repositoryId,
                createdAt: reviews.createdAt,
              })
              .from(reviews)
              .where(
                sql`${reviews.repositoryId} IN (${sql.join(
                  userRepos.map((r) => sql`${r.id}`),
                  sql`, `,
                )})`,
              )
              .orderBy(desc(reviews.createdAt))
              .limit(10)
          : [];

      const recentActivity = recentReviews.map((r) => ({
        id: r.id,
        type: "review" as string,
        description: `Review ${r.status} for PR #${r.prNumber}${r.prTitle ? `: ${r.prTitle}` : ""}`,
        createdAt: r.createdAt,
      }));

      return {
        repoCount: Number(repoCountResult?.count ?? 0),
        reviewCount,
        completedReviews,
        failedReviews,
        recentActivity,
      };
    },
  };
}
