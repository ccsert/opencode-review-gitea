import type {
  LoginInput,
  LoginResponse,
  User,
  Repository,
  CreateRepositoryInput,
  Template,
  CreateTemplateInput,
  UpdateTemplateInput,
  Review,
  ReviewStats,
  AgentChatInput,
  ApiResponse,
  PaginatedResponse,
  SystemHealth,
  SystemInfo,
} from "./types";

export interface OpenCodeReviewClientConfig {
  /** Base URL of the platform server (e.g. "https://review.example.com") */
  baseUrl: string;
  /** API key or JWT token for authentication */
  apiKey?: string;
  /** Custom fetch implementation (defaults to globalThis.fetch) */
  fetch?: typeof fetch;
}

export class OpenCodeReviewClient {
  private baseUrl: string;
  private apiKey?: string;
  private fetchFn: typeof fetch;

  constructor(config: OpenCodeReviewClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.fetchFn = config.fetch ?? globalThis.fetch;
  }

  /** Update the API key / JWT token */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    const response = await this.fetchFn(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: { message: response.statusText } }));
      throw new OpenCodeReviewError(
        (error as ApiResponse<unknown>).error?.message ?? response.statusText,
        (error as ApiResponse<unknown>).error?.code ?? "HTTP_ERROR",
        response.status,
      );
    }
    return response.json() as Promise<T>;
  }

  // ─── Auth ─────────────────────────────────────────
  readonly auth = {
    login: (input: LoginInput) =>
      this.request<ApiResponse<LoginResponse>>("POST", "/auth/login", input),
    me: () => this.request<ApiResponse<User>>("GET", "/auth/me"),
    refresh: (refreshToken: string) =>
      this.request<ApiResponse<{ token: string }>>("POST", "/auth/refresh", {
        refreshToken,
      }),
  };

  // ─── Repositories ─────────────────────────────────
  readonly repositories = {
    list: (params?: { page?: number; pageSize?: number }) => {
      const query = params
        ? `?page=${params.page ?? 1}&pageSize=${params.pageSize ?? 20}`
        : "";
      return this.request<PaginatedResponse<Repository>>(
        "GET",
        `/repositories${query}`,
      );
    },
    get: (id: string) =>
      this.request<ApiResponse<Repository>>("GET", `/repositories/${id}`),
    create: (input: CreateRepositoryInput) =>
      this.request<ApiResponse<Repository>>("POST", "/repositories", input),
    update: (id: string, input: Partial<CreateRepositoryInput>) =>
      this.request<ApiResponse<Repository>>(
        "PATCH",
        `/repositories/${id}`,
        input,
      ),
    delete: (id: string) =>
      this.request<ApiResponse<void>>("DELETE", `/repositories/${id}`),
    test: (id: string) =>
      this.request<ApiResponse<{ success: boolean }>>(
        "POST",
        `/repositories/${id}/test`,
      ),
  };

  // ─── Templates ────────────────────────────────────
  readonly templates = {
    list: () => this.request<ApiResponse<Template[]>>("GET", "/templates"),
    get: (id: string) =>
      this.request<ApiResponse<Template>>("GET", `/templates/${id}`),
    create: (input: CreateTemplateInput) =>
      this.request<ApiResponse<Template>>("POST", "/templates", input),
    update: (id: string, input: UpdateTemplateInput) =>
      this.request<ApiResponse<Template>>("PATCH", `/templates/${id}`, input),
    delete: (id: string) =>
      this.request<ApiResponse<void>>("DELETE", `/templates/${id}`),
  };

  // ─── Reviews ──────────────────────────────────────
  readonly reviews = {
    list: (params?: {
      page?: number;
      pageSize?: number;
      repositoryId?: string;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.page) searchParams.set("page", String(params.page));
      if (params?.pageSize)
        searchParams.set("pageSize", String(params.pageSize));
      if (params?.repositoryId)
        searchParams.set("repositoryId", params.repositoryId);
      const query = searchParams.toString()
        ? `?${searchParams.toString()}`
        : "";
      return this.request<PaginatedResponse<Review>>("GET", `/reviews${query}`);
    },
    get: (id: string) =>
      this.request<ApiResponse<Review>>("GET", `/reviews/${id}`),
    stats: () =>
      this.request<ApiResponse<ReviewStats>>("GET", "/reviews/stats"),
    retry: (id: string) =>
      this.request<ApiResponse<Review>>("POST", `/reviews/${id}/retry`),
  };

  // ─── System ───────────────────────────────────────
  readonly system = {
    health: () =>
      this.request<ApiResponse<SystemHealth>>("GET", "/system/health"),
    info: () => this.request<ApiResponse<SystemInfo>>("GET", "/system/info"),
    models: () => this.request<ApiResponse<unknown[]>>("GET", "/system/models"),
  };

  // ─── Agent Chat (SSE streaming) ───────────────────
  readonly agent = {
    /**
     * Send a chat message to the platform agent and receive a streaming response.
     * Returns an AsyncIterable of SSE events.
     */
    chat: (input: AgentChatInput): AsyncIterable<string> => {
      return this.streamAgentChat(input);
    },
  };

  private async *streamAgentChat(
    input: AgentChatInput,
  ): AsyncGenerator<string> {
    const url = `${this.baseUrl}/api/v1/agui/stream`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    const response = await this.fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        runId: crypto.randomUUID(),
        threadId: input.threadId ?? crypto.randomUUID(),
        messages: input.messages,
      }),
    });
    if (!response.ok) {
      throw new OpenCodeReviewError(
        "Agent chat failed",
        "AGENT_ERROR",
        response.status,
      );
    }
    if (!response.body) {
      throw new OpenCodeReviewError("No response body", "AGENT_ERROR", 0);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            yield line.slice(6);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

/** Custom error class for SDK errors */
export class OpenCodeReviewError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "OpenCodeReviewError";
  }
}
