/**
 * GitHub Provider 实现
 * 支持 GitHub.com 和 GitHub Enterprise
 */

import { BaseProvider } from "./base";
import type {
  ProviderType,
  ListRepositoriesParams,
  ListRepositoriesResponse,
  Organization,
  CreateWebhookRequest,
  Webhook,
} from "./types";
import type {
  Repository,
  PullRequest,
  ChangedFile,
  CreateReviewRequest,
  Review,
  Comment,
  LineCommentRequest,
  User,
} from "../types";
import type { WebhookEvent, BaseWebhookEvent } from "../events/types";

export class GitHubProvider extends BaseProvider {
  readonly name: ProviderType = "github";

  /**
   * GitHub 使用 Bearer token + 特殊 Accept 头 + API 版本头
   */
  protected getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  // ============ 仓库列表相关方法 ============

  async listUserRepositories(
    params: ListRepositoriesParams = {},
  ): Promise<ListRepositoriesResponse> {
    const page = params.page || 1;
    const perPage = params.perPage || 50;

    // GitHub API: GET /user/repos
    const data = await this.fetch<GitHubRepository[]>(
      `/user/repos?page=${page}&per_page=${perPage}&sort=updated&direction=desc`,
    );

    return {
      repositories: data.map((repo) => this.mapRepository(repo)),
      hasMore: data.length === perPage,
    };
  }

  async listUserOrganizations(): Promise<Organization[]> {
    // GitHub API: GET /user/orgs
    const data = await this.fetch<GitHubOrganization[]>("/user/orgs");

    return data.map((org) => ({
      id: org.id,
      name: org.login,
      fullName: org.login,
      description: org.description || undefined,
      avatarUrl: org.avatar_url,
      url: org.url,
    }));
  }

  async listOrganizationRepositories(
    org: string,
    params: ListRepositoriesParams = {},
  ): Promise<ListRepositoriesResponse> {
    const page = params.page || 1;
    const perPage = params.perPage || 50;

    // GitHub API: GET /orgs/{org}/repos
    const data = await this.fetch<GitHubRepository[]>(
      `/orgs/${org}/repos?page=${page}&per_page=${perPage}`,
    );

    return {
      repositories: data.map((repo) => this.mapRepository(repo)),
      hasMore: data.length === perPage,
    };
  }

  // ============ 仓库信息 ============

  async getRepository(owner: string, repo: string): Promise<Repository> {
    const data = await this.fetch<GitHubRepository>(`/repos/${owner}/${repo}`);
    return this.mapRepository(data);
  }

  // ============ PR 操作 ============

  async getPullRequest(
    owner: string,
    repo: string,
    number: number,
  ): Promise<PullRequest> {
    const data = await this.fetch<GitHubPullRequest>(
      `/repos/${owner}/${repo}/pulls/${number}`,
    );
    return this.mapPullRequest(data);
  }

  async getPullRequestDiff(
    owner: string,
    repo: string,
    number: number,
  ): Promise<string> {
    const url = `${this.baseUrl}/repos/${owner}/${repo}/pulls/${number}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github.diff",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to get PR diff: ${response.status}`);
      }

      return response.text();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(
          `PR diff request timed out after 60s: ${owner}/${repo}#${number}`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async getPullRequestFiles(
    owner: string,
    repo: string,
    number: number,
  ): Promise<ChangedFile[]> {
    const data = await this.fetch<GitHubChangedFile[]>(
      `/repos/${owner}/${repo}/pulls/${number}/files`,
    );
    return data.map((file) => this.mapChangedFile(file));
  }

  // ============ Review 操作 ============

  async createReview(
    owner: string,
    repo: string,
    number: number,
    review: CreateReviewRequest,
  ): Promise<Review> {
    // 构建评论数组（GitHub 格式）
    const comments = (review.comments || []).map((comment) => ({
      path: comment.path,
      position: comment.line,
      body: comment.body,
    }));

    const data = await this.fetch<GitHubReview>(
      `/repos/${owner}/${repo}/pulls/${number}/reviews`,
      {
        method: "POST",
        body: JSON.stringify({
          body: review.body,
          event: this.mapDecisionToEvent(review.decision),
          comments: comments.length > 0 ? comments : undefined,
        }),
      },
    );
    return this.mapReview(data);
  }

  async createComment(
    owner: string,
    repo: string,
    number: number,
    body: string,
  ): Promise<Comment> {
    // GitHub 使用 issues endpoint 创建普通评论
    const data = await this.fetch<GitHubComment>(
      `/repos/${owner}/${repo}/issues/${number}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body }),
      },
    );
    return this.mapComment(data);
  }

  async createLineComment(
    owner: string,
    repo: string,
    number: number,
    comment: LineCommentRequest,
  ): Promise<Comment> {
    // 先获取 PR 的 head SHA（commit_id 是必需的）
    const pr = await this.fetch<GitHubPullRequest>(
      `/repos/${owner}/${repo}/pulls/${number}`,
    );

    const data = await this.fetch<GitHubComment>(
      `/repos/${owner}/${repo}/pulls/${number}/comments`,
      {
        method: "POST",
        body: JSON.stringify({
          body: comment.body,
          path: comment.path,
          line: comment.line,
          side: comment.side || "RIGHT",
          commit_id: pr.head.sha,
        }),
      },
    );
    return this.mapComment(data);
  }

  // ============ Webhook 签名验证 ============

  verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    // GitHub 签名格式: X-Hub-Signature-256: sha256=<hex>
    // 需要剥离 sha256= 前缀
    if (!signature || !secret) {
      return false;
    }

    let hash: string;
    if (signature.startsWith("sha256=")) {
      hash = signature.slice(7);
    } else {
      hash = signature;
    }
    return this.verifyHmacSha256(payload, hash, secret);
  }

  // ============ Webhook 管理 ============

  async createWebhook(
    owner: string,
    repo: string,
    webhook: CreateWebhookRequest,
  ): Promise<Webhook> {
    // GitHub API: POST /repos/{owner}/{repo}/hooks
    const data = await this.fetch<GitHubHook>(`/repos/${owner}/${repo}/hooks`, {
      method: "POST",
      body: JSON.stringify({
        name: "web",
        active: webhook.active ?? true,
        config: {
          url: webhook.url,
          content_type: "json",
          secret: webhook.secret || "",
        },
        events: webhook.events || ["pull_request", "issue_comment"],
      }),
    });
    return this.mapWebhook(data);
  }

  async deleteWebhook(
    owner: string,
    repo: string,
    hookId: number,
  ): Promise<void> {
    // GitHub API: DELETE /repos/{owner}/{repo}/hooks/{hook_id}
    await this.fetch(`/repos/${owner}/${repo}/hooks/${hookId}`, {
      method: "DELETE",
    });
  }

  async listWebhooks(owner: string, repo: string): Promise<Webhook[]> {
    // GitHub API: GET /repos/{owner}/{repo}/hooks
    const data = await this.fetch<GitHubHook[]>(
      `/repos/${owner}/${repo}/hooks`,
    );
    return data.map((hook) => this.mapWebhook(hook));
  }

  // ============ Webhook 事件解析 ============

  parseWebhookEvent(
    payload: unknown,
    headers: Record<string, string>,
  ): WebhookEvent | null {
    const eventType = headers["x-github-event"] || headers["X-GitHub-Event"];
    const deliveryId =
      headers["x-github-delivery"] || headers["X-GitHub-Delivery"];

    if (!eventType) {
      return null;
    }

    const data = payload as GitHubWebhookPayload;

    const baseEvent: BaseWebhookEvent = {
      id: deliveryId || crypto.randomUUID(),
      timestamp: new Date(),
      provider: "github",
      repository: {
        fullName: data.repository.full_name,
        url: data.repository.html_url,
      },
      sender: {
        id: data.sender.id,
        login: data.sender.login,
        avatarUrl: data.sender.avatar_url,
      },
    };

    switch (eventType) {
      case "pull_request":
        return this.parsePullRequestEvent(data, baseEvent);
      case "issue_comment":
        if (data.issue?.pull_request) {
          return this.parseCommentEvent(data, baseEvent);
        }
        return null;
      default:
        return null;
    }
  }

  // ============ 私有辅助方法 ============

  private mapDecisionToEvent(decision: string): string {
    switch (decision) {
      case "APPROVED":
        return "APPROVE";
      case "REQUEST_CHANGES":
        return "REQUEST_CHANGES";
      default:
        return "COMMENT";
    }
  }

  private mapRepository(data: GitHubRepository): Repository {
    return {
      id: data.id,
      name: data.name,
      fullName: data.full_name,
      description: data.description || undefined,
      defaultBranch: data.default_branch,
      private: data.private,
      url: data.html_url,
    };
  }

  private mapPullRequest(data: GitHubPullRequest): PullRequest {
    return {
      id: data.id,
      number: data.number,
      title: data.title,
      body: data.body || undefined,
      state: this.mapPRState(data.state, data.merged),
      author: {
        id: data.user.id,
        login: data.user.login,
        avatarUrl: data.user.avatar_url,
      },
      base: {
        ref: data.base.ref,
        sha: data.base.sha,
      },
      head: {
        ref: data.head.ref,
        sha: data.head.sha,
      },
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  }

  private mapPRState(
    state: string,
    merged: boolean,
  ): "open" | "closed" | "merged" {
    if (merged) return "merged";
    switch (state) {
      case "open":
        return "open";
      case "closed":
        return "closed";
      default:
        return "open";
    }
  }

  private mapChangedFile(data: GitHubChangedFile): ChangedFile {
    return {
      filename: data.filename,
      status: this.mapFileStatus(data.status),
      additions: data.additions,
      deletions: data.deletions,
      patch: data.patch,
    };
  }

  private mapFileStatus(status: string): ChangedFile["status"] {
    switch (status) {
      case "added":
        return "added";
      case "removed":
        return "deleted";
      case "modified":
        return "modified";
      case "renamed":
        return "renamed";
      case "changed":
        return "modified";
      default:
        return "modified";
    }
  }

  private mapReview(data: GitHubReview): Review {
    return {
      id: data.id,
      body: data.body,
      state: this.mapReviewState(data.state),
      user: {
        id: data.user.id,
        login: data.user.login,
        avatarUrl: data.user.avatar_url,
      },
      submittedAt: new Date(data.submitted_at),
    };
  }

  private mapReviewState(state: string): Review["state"] {
    switch (state) {
      case "APPROVED":
        return "APPROVED";
      case "CHANGES_REQUESTED":
        return "REQUEST_CHANGES";
      case "COMMENTED":
        return "COMMENT";
      default:
        return "COMMENT";
    }
  }

  private mapComment(data: GitHubComment): Comment {
    return {
      id: data.id,
      body: data.body,
      user: {
        id: data.user.id,
        login: data.user.login,
        avatarUrl: data.user.avatar_url,
      },
      createdAt: new Date(data.created_at),
    };
  }

  private mapWebhook(data: GitHubHook): Webhook {
    return {
      id: data.id,
      type: data.name,
      active: data.active,
      url: data.config?.url || "",
      events: data.events || [],
      createdAt: new Date(data.created_at),
    };
  }

  private parsePullRequestEvent(
    data: GitHubWebhookPayload,
    baseEvent: BaseWebhookEvent,
  ): WebhookEvent | null {
    if (!data.pull_request) {
      return null;
    }

    const pr = this.mapPullRequest(data.pull_request);

    switch (data.action) {
      case "opened":
        return { ...baseEvent, type: "pull_request.opened", pullRequest: pr };
      case "synchronize":
        return {
          ...baseEvent,
          type: "pull_request.updated",
          pullRequest: pr,
          before: data.before,
        };
      case "closed":
        return {
          ...baseEvent,
          type: "pull_request.closed",
          pullRequest: pr,
          merged: data.pull_request.merged || false,
        };
      default:
        return null;
    }
  }

  private parseCommentEvent(
    data: GitHubWebhookPayload,
    baseEvent: BaseWebhookEvent,
  ): WebhookEvent | null {
    if (data.action !== "created" || !data.comment || !data.issue) {
      return null;
    }

    const body = data.comment.body || "";
    const triggers = this.extractTriggers(body);

    // 构造一个简化的 PullRequest 对象
    const pr: PullRequest = {
      id: data.issue.id,
      number: data.issue.number,
      title: data.issue.title || "",
      body: data.issue.body || undefined,
      state: "open",
      author: {
        id: data.issue.user?.id || 0,
        login: data.issue.user?.login || "",
        avatarUrl: data.issue.user?.avatar_url,
      },
      base: { ref: "", sha: "" },
      head: { ref: "", sha: "" },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return {
      ...baseEvent,
      type: "pull_request.comment",
      pullRequest: pr,
      comment: {
        id: data.comment.id,
        body: data.comment.body,
        user: {
          id: data.comment.user.id,
          login: data.comment.user.login,
          avatarUrl: data.comment.user.avatar_url,
        },
        createdAt: new Date(data.comment.created_at),
      },
      triggers,
    };
  }

  private extractTriggers(body: string): string[] {
    const triggers: string[] = [];
    if (/\/oc\b/i.test(body)) triggers.push("/oc");
    if (/\/opencode\b/i.test(body)) triggers.push("/opencode");
    return triggers;
  }
}

// ============ GitHub API 类型定义 ============

interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  default_branch: string;
  private: boolean;
  html_url: string;
}

interface GitHubOrganization {
  id: number;
  login: string;
  description: string | null;
  avatar_url: string;
  url: string;
}

interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: GitHubUser;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  created_at: string;
  updated_at: string;
  merged: boolean;
  merged_at: string | null;
}

interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
}

interface GitHubChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface GitHubReview {
  id: number;
  body: string;
  state: string;
  user: GitHubUser;
  submitted_at: string;
}

interface GitHubComment {
  id: number;
  body: string;
  user: GitHubUser;
  created_at: string;
}

interface GitHubHook {
  id: number;
  name: string;
  active: boolean;
  config: {
    url?: string;
    content_type?: string;
    secret?: string;
  };
  events: string[];
  created_at: string;
  updated_at: string;
}

interface GitHubWebhookPayload {
  action: string;
  repository: GitHubRepository;
  sender: GitHubUser;
  pull_request?: GitHubPullRequest;
  issue?: {
    id: number;
    number: number;
    title?: string;
    body?: string;
    user?: GitHubUser;
    pull_request?: object; // presence indicates it's a PR
  };
  comment?: GitHubComment;
  before?: string;
}
