/**
 * A2A (Agent-to-Agent) Protocol Endpoint
 *
 * Implements Google's A2A protocol for agent interoperability.
 * - POST /         — JSON-RPC 2.0 endpoint (tasks/send, tasks/get, tasks/cancel)
 * - GET  /card     — Agent Card describing capabilities
 *
 * @see https://a2a-protocol.org/latest/specification/
 */

import { Hono } from "hono";
import { ulid } from "ulid";

import { authMiddleware } from "../middleware/auth";
import { getPlatformAgent, mapUserRole } from "../services/agent-runtime";
import { getDatabase } from "../db/client";
import { agentThreads, agentMessages } from "../db/schema/index";
import { eq, and, desc } from "drizzle-orm";

// ─── Types ─────────────────────────────────────────────────────────────

/** JSON-RPC 2.0 request envelope */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 success response */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

/** JSON-RPC 2.0 error object */
interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** A2A Task status */
type TaskStatus = "submitted" | "working" | "completed" | "failed" | "canceled";

/** A2A Task object */
interface A2ATask {
  id: string;
  status: TaskStatus;
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
  metadata?: Record<string, unknown>;
}

/** A2A Message (user or agent turn) */
interface A2AMessage {
  role: "user" | "agent";
  parts: A2APart[];
}

/** A2A Part — text or data */
interface A2APart {
  type: "text" | "data";
  text?: string;
  data?: unknown;
  mimeType?: string;
}

/** A2A Artifact — output produced by the agent */
interface A2AArtifact {
  name?: string;
  description?: string;
  parts: A2APart[];
  index: number;
}

// ─── JSON-RPC Helpers ──────────────────────────────────────────────────

function jsonRpcSuccess(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: id ?? 0,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

// Standard JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
// A2A-specific error codes
const TASK_NOT_FOUND = -32001;
const TASK_NOT_CANCELABLE = -32002;

// ─── Route ─────────────────────────────────────────────────────────────

export const a2aRoutes = new Hono();

/**
 * GET /card — Agent Card
 *
 * Public endpoint (no auth required). Returns agent capabilities
 * in the A2A Agent Card format for discovery.
 */
a2aRoutes.get("/card", (c) => {
  const baseUrl =
    process.env.PUBLIC_URL ||
    `${c.req.header("x-forwarded-proto") || "http"}://${c.req.header("host")}`;

  return c.json({
    name: "OpenCode Review Platform Agent",
    description:
      "AI-powered code review platform agent that manages repositories, templates, reviews, AI configurations, webhooks, and system settings.",
    url: `${baseUrl}/api/v1/a2a`,
    version: "0.1.0",
    protocolVersion: "0.2.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    authentication: {
      schemes: ["apiKey"],
      credentials: null,
    },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    skills: [
      {
        id: "template-management",
        name: "Template Management",
        description:
          "Create, update, delete, and list review templates. Preview rendered templates.",
        tags: ["templates", "review"],
        examples: [
          "List all review templates",
          "Create a security-focused review template",
        ],
      },
      {
        id: "repository-management",
        name: "Repository Management",
        description:
          "Add, update, remove, and list repositories across Gitea, GitHub, and GitLab.",
        tags: ["repositories", "git"],
        examples: [
          "List all connected repositories",
          "Add a new GitHub repository",
        ],
      },
      {
        id: "review-operations",
        name: "Review Operations",
        description:
          "List reviews, get review details, view statistics, and trigger manual reviews.",
        tags: ["reviews", "code-review", "ai"],
        examples: [
          "Show recent code reviews",
          "What are the review statistics?",
        ],
      },
      {
        id: "ai-config",
        name: "AI Configuration",
        description:
          "Manage AI provider configurations including API keys, models, and connection testing.",
        tags: ["ai", "configuration"],
        examples: [
          "List configured AI providers",
          "Test the current AI provider connection",
        ],
      },
      {
        id: "webhook-management",
        name: "Webhook Management",
        description:
          "View webhook logs, manage webhook configurations, and check delivery status.",
        tags: ["webhooks", "integrations"],
        examples: ["Show recent webhook deliveries", "Check webhook health"],
      },
      {
        id: "system-management",
        name: "System Management",
        description:
          "Check system health, view platform info, and get system statistics.",
        tags: ["system", "monitoring"],
        examples: [
          "What is the system health status?",
          "Show platform statistics",
        ],
      },
    ],
  });
});

/**
 * POST / — JSON-RPC 2.0 endpoint
 *
 * A2A protocol methods:
 * - tasks/send      — Send a message to the agent, get response
 * - tasks/get       — Get task status and history
 * - tasks/cancel    — Cancel a running task
 */
a2aRoutes.post("/", authMiddleware, async (c) => {
  // Parse JSON-RPC request
  let rpcRequest: JsonRpcRequest;
  try {
    rpcRequest = await c.req.json<JsonRpcRequest>();
  } catch {
    return c.json(jsonRpcError(null, PARSE_ERROR, "Parse error: invalid JSON"));
  }

  // Validate JSON-RPC envelope
  if (
    rpcRequest.jsonrpc !== "2.0" ||
    !rpcRequest.method ||
    rpcRequest.id === undefined
  ) {
    return c.json(
      jsonRpcError(
        rpcRequest?.id ?? null,
        INVALID_REQUEST,
        "Invalid Request: missing jsonrpc, method, or id",
      ),
    );
  }

  const { id, method, params } = rpcRequest;
  const user = c.get("user");

  try {
    switch (method) {
      case "tasks/send":
        return c.json(
          await handleTasksSend(id, params ?? {}, user.id, user.role),
        );

      case "tasks/get":
        return c.json(await handleTasksGet(id, params ?? {}, user.id));

      case "tasks/cancel":
        return c.json(await handleTasksCancel(id, params ?? {}, user.id));

      default:
        return c.json(
          jsonRpcError(id, METHOD_NOT_FOUND, `Method not found: ${method}`),
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error(`[A2A] Error handling ${method}:`, err);
    return c.json(jsonRpcError(id, INTERNAL_ERROR, message));
  }
});

// ─── Method Handlers ───────────────────────────────────────────────────

/**
 * tasks/send — Create or continue a task by sending a message.
 *
 * Params:
 * - id?:       Existing task ID to continue (optional — new task if omitted)
 * - message:   { role: "user", parts: [{ type: "text", text: "..." }] }
 * - metadata?: Arbitrary metadata
 */
async function handleTasksSend(
  rpcId: string | number,
  params: Record<string, unknown>,
  userId: string,
  userRole: string,
): Promise<JsonRpcResponse> {
  const message = params.message as A2AMessage | undefined;
  if (!message?.parts?.length) {
    return jsonRpcError(
      rpcId,
      INVALID_PARAMS,
      "Missing or empty message.parts",
    );
  }

  // Extract text from user message parts
  const userText = message.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("\n");

  if (!userText) {
    return jsonRpcError(
      rpcId,
      INVALID_PARAMS,
      "No text content in message parts",
    );
  }

  const db = getDatabase();
  const taskId = (params.id as string) ?? ulid();
  const isNewTask = !params.id;

  // Create or retrieve thread
  let threadId: string;
  if (isNewTask) {
    threadId = ulid();
    await db.insert(agentThreads).values({
      id: threadId,
      userId,
      title: userText.slice(0, 100),
      metadata: { a2a: true, taskId },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  } else {
    // Find existing thread for this task
    const [existingThread] = await db
      .select()
      .from(agentThreads)
      .where(and(eq(agentThreads.userId, userId)))
      .limit(100);

    // Search for thread with matching taskId in metadata
    const threads = await db
      .select()
      .from(agentThreads)
      .where(eq(agentThreads.userId, userId));

    const matched = threads.find(
      (t) =>
        t.metadata &&
        typeof t.metadata === "object" &&
        (t.metadata as Record<string, unknown>).taskId === taskId,
    );

    if (!matched) {
      return jsonRpcError(rpcId, TASK_NOT_FOUND, `Task not found: ${taskId}`);
    }
    threadId = matched.id;
  }

  // Store user message
  const userMsgId = ulid();
  await db.insert(agentMessages).values({
    id: userMsgId,
    threadId,
    role: "user",
    content: userText,
    createdAt: new Date(),
  });

  // Get agent and generate response
  const agent = await getPlatformAgent(userId);
  const mappedRole = mapUserRole(userRole);

  // Build conversation history from thread
  const previousMessages = await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.threadId, threadId))
    .orderBy(agentMessages.createdAt);

  const conversationMessages = previousMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Execute agent
  const agentResponse = await agent.generate(conversationMessages);
  const responseText =
    typeof agentResponse.text === "string"
      ? agentResponse.text
      : JSON.stringify(agentResponse.text);

  // Store agent response
  const agentMsgId = ulid();
  await db.insert(agentMessages).values({
    id: agentMsgId,
    threadId,
    role: "assistant",
    content: responseText,
    createdAt: new Date(),
  });

  // Update thread timestamp
  await db
    .update(agentThreads)
    .set({ updatedAt: new Date() })
    .where(eq(agentThreads.id, threadId));

  // Build A2A task response
  const task: A2ATask = {
    id: taskId,
    status: "completed",
    artifacts: [
      {
        name: "response",
        parts: [{ type: "text", text: responseText }],
        index: 0,
      },
    ],
    history: [
      message,
      {
        role: "agent",
        parts: [{ type: "text", text: responseText }],
      },
    ],
    metadata: {
      threadId,
      userId,
    },
  };

  return jsonRpcSuccess(rpcId, task);
}

/**
 * tasks/get — Retrieve a task by ID.
 *
 * Params:
 * - id: Task ID
 */
async function handleTasksGet(
  rpcId: string | number,
  params: Record<string, unknown>,
  userId: string,
): Promise<JsonRpcResponse> {
  const taskId = params.id as string;
  if (!taskId) {
    return jsonRpcError(rpcId, INVALID_PARAMS, "Missing required param: id");
  }

  const db = getDatabase();

  // Find thread with matching taskId
  const threads = await db
    .select()
    .from(agentThreads)
    .where(eq(agentThreads.userId, userId));

  const matched = threads.find(
    (t) =>
      t.metadata &&
      typeof t.metadata === "object" &&
      (t.metadata as Record<string, unknown>).taskId === taskId,
  );

  if (!matched) {
    return jsonRpcError(rpcId, TASK_NOT_FOUND, `Task not found: ${taskId}`);
  }

  // Get messages for this thread
  const messages = await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.threadId, matched.id))
    .orderBy(agentMessages.createdAt);

  // Build history
  const history: A2AMessage[] = messages.map((m) => ({
    role: m.role === "user" ? ("user" as const) : ("agent" as const),
    parts: [{ type: "text" as const, text: m.content }],
  }));

  // Last assistant message is the artifact
  const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
  const artifacts: A2AArtifact[] = lastAssistant
    ? [
        {
          name: "response",
          parts: [{ type: "text", text: lastAssistant.content }],
          index: 0,
        },
      ]
    : [];

  const task: A2ATask = {
    id: taskId,
    status: lastAssistant ? "completed" : "submitted",
    artifacts,
    history,
    metadata: {
      threadId: matched.id,
      userId,
      createdAt: matched.createdAt?.toISOString(),
      updatedAt: matched.updatedAt?.toISOString(),
    },
  };

  return jsonRpcSuccess(rpcId, task);
}

/**
 * tasks/cancel — Cancel a task.
 *
 * In this implementation, tasks are synchronous (no background work),
 * so cancel simply marks the thread metadata as canceled.
 *
 * Params:
 * - id: Task ID to cancel
 */
async function handleTasksCancel(
  rpcId: string | number,
  params: Record<string, unknown>,
  userId: string,
): Promise<JsonRpcResponse> {
  const taskId = params.id as string;
  if (!taskId) {
    return jsonRpcError(rpcId, INVALID_PARAMS, "Missing required param: id");
  }

  const db = getDatabase();

  // Find thread with matching taskId
  const threads = await db
    .select()
    .from(agentThreads)
    .where(eq(agentThreads.userId, userId));

  const matched = threads.find(
    (t) =>
      t.metadata &&
      typeof t.metadata === "object" &&
      (t.metadata as Record<string, unknown>).taskId === taskId,
  );

  if (!matched) {
    return jsonRpcError(rpcId, TASK_NOT_FOUND, `Task not found: ${taskId}`);
  }

  // Check if already completed — can't cancel a completed task
  const messages = await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.threadId, matched.id));

  const hasAssistantResponse = messages.some((m) => m.role === "assistant");
  if (hasAssistantResponse) {
    return jsonRpcError(
      rpcId,
      TASK_NOT_CANCELABLE,
      "Task already completed and cannot be canceled",
    );
  }

  // Mark as canceled in metadata
  await db
    .update(agentThreads)
    .set({
      metadata: {
        ...((matched.metadata as Record<string, unknown>) ?? {}),
        canceled: true,
      },
      updatedAt: new Date(),
    })
    .where(eq(agentThreads.id, matched.id));

  const task: A2ATask = {
    id: taskId,
    status: "canceled",
    metadata: {
      threadId: matched.id,
      userId,
    },
  };

  return jsonRpcSuccess(rpcId, task);
}
