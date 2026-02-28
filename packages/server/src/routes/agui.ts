/**
 * AG-UI SSE Endpoint
 *
 * Two sub-endpoints for agent interaction:
 * - POST /           — CopilotKit runtime endpoint (for CopilotKit frontend)
 * - POST /stream     — Raw AG-UI SSE endpoint (for non-CopilotKit clients)
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { ulid } from "ulid";
import { Observable } from "rxjs";

import { MastraAgent } from "@ag-ui/mastra";
import type { RunAgentInput, BaseEvent } from "@ag-ui/core";
import { EventType } from "@ag-ui/core";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from "@copilotkit/runtime";

import { authMiddleware } from "../middleware/auth";
import { getPlatformAgent } from "../services/agent-runtime";
import { getDatabase } from "../db/client";
import { agentThreads, agentMessages } from "../db/schema/index";
import { eq, and } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Stub agent — used when no AI provider is configured so CopilotKit can still
// discover the agent and return a user-friendly error message.
// ---------------------------------------------------------------------------
class StubPlatformAgent {
  agentId = "platform-agent";
  description =
    "AI-powered platform management agent for OpenCode Review. Manages templates, repositories, reviews, webhooks, AI configs, and system operations.";

  clone() {
    return new StubPlatformAgent();
  }

  run(input: RunAgentInput) {
    const { Observable } = require("rxjs") as typeof import("rxjs");
    return new Observable<BaseEvent>((subscriber: { next: (v: BaseEvent) => void; complete: () => void }) => {
      const messageId = `stub-${Date.now()}`;
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      subscriber.next({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
      } as any);
      subscriber.next({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta:
          "⚠️ No AI provider configured. Please go to **Settings → AI Providers** to add and configure an AI provider before using the agent.",
      } as any);
      subscriber.next({
        type: EventType.TEXT_MESSAGE_END,
        messageId,
      } as any);
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      subscriber.complete();
    });
  }
}

export const aguiRoutes = new Hono();
aguiRoutes.use("/*", authMiddleware);

// ---------------------------------------------------------------------------
// Input validation schema for the raw AG-UI stream endpoint
// ---------------------------------------------------------------------------
const aguiInputSchema = z.object({
  threadId: z.string().min(1),
  runId: z.string().min(1),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["user", "assistant", "system", "developer", "tool"]),
      content: z.string().optional(),
      name: z.string().optional(),
      toolCalls: z.array(z.any()).optional(),
      toolCallId: z.string().optional(),
    }),
  ),
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        parameters: z.any().optional(),
      }),
    )
    .optional()
    .default([]),
  context: z.array(z.any()).optional().default([]),
  state: z.any().optional(),
  forwardedProps: z.any().optional(),
});

type AguiInput = z.infer<typeof aguiInputSchema>;

function createAguiEventNormalizer() {
  const emittedTextIdByOriginalId = new Map<string, string>();
  const needsRestartByOriginalId = new Set<string>();
  let activeOriginalTextId = "";
  let activeEmittedTextId = "";
  let activeTextIsOpen = false;

  const ensureEmittedId = (originalId: string): string => {
    if (!originalId) return ulid();
    const existing = emittedTextIdByOriginalId.get(originalId);
    if (existing) return existing;
    emittedTextIdByOriginalId.set(originalId, originalId);
    return originalId;
  };

  const closeActiveTextIfNeeded = (): BaseEvent[] => {
    if (!activeTextIsOpen || !activeEmittedTextId) return [];
    activeTextIsOpen = false;
    return [
      {
        type: EventType.TEXT_MESSAGE_END,
        messageId: activeEmittedTextId,
      } as any,
    ];
  };

  const process = (event: BaseEvent): BaseEvent[] => {
    const out: BaseEvent[] = [];

    if (event.type === EventType.TEXT_MESSAGE_START) {
      const originalId = ((event as any).messageId || "") as string;

      if (needsRestartByOriginalId.has(originalId)) {
        const restartedId = ulid();
        emittedTextIdByOriginalId.set(originalId, restartedId);
        needsRestartByOriginalId.delete(originalId);
      }

      const emittedId = ensureEmittedId(originalId);
      activeOriginalTextId = originalId;
      activeEmittedTextId = emittedId;
      activeTextIsOpen = true;
      out.push({ ...(event as any), messageId: emittedId } as any);
      return out;
    }

    if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
      const originalId = ((event as any).messageId || "") as string;

      if (needsRestartByOriginalId.has(originalId)) {
        const restartedId = ulid();
        emittedTextIdByOriginalId.set(originalId, restartedId);
        needsRestartByOriginalId.delete(originalId);
      }

      const emittedId = ensureEmittedId(originalId);

      if (!activeTextIsOpen || activeEmittedTextId !== emittedId) {
        activeOriginalTextId = originalId;
        activeEmittedTextId = emittedId;
        activeTextIsOpen = true;
        out.push({
          type: EventType.TEXT_MESSAGE_START,
          messageId: emittedId,
          role: "assistant",
        } as any);
      }

      out.push({ ...(event as any), messageId: emittedId } as any);
      return out;
    }

    if (event.type === EventType.TEXT_MESSAGE_END) {
      const originalId = ((event as any).messageId || "") as string;
      const emittedId = ensureEmittedId(originalId);

      if (activeTextIsOpen && activeEmittedTextId === emittedId) {
        out.push({ ...(event as any), messageId: emittedId } as any);
        activeTextIsOpen = false;
      }
      return out;
    }

    if (event.type === EventType.TOOL_CALL_START) {
      const originalParentId = ((event as any).parentMessageId || "") as string;
      const emittedParentId = originalParentId
        ? ensureEmittedId(originalParentId)
        : originalParentId;

      if (
        originalParentId &&
        activeTextIsOpen &&
        originalParentId === activeOriginalTextId
      ) {
        out.push(...closeActiveTextIfNeeded());
        needsRestartByOriginalId.add(originalParentId);
      }

      out.push({ ...(event as any), parentMessageId: emittedParentId } as any);
      return out;
    }

    if (event.type === EventType.RUN_FINISHED) {
      out.push(...closeActiveTextIfNeeded());
      out.push(event);
      return out;
    }

    out.push(event);
    return out;
  };

  return { process, closeActiveTextIfNeeded };
}

function normalizeAguiEventStream(source: any) {
  return new Observable<BaseEvent>((subscriber) => {
    const normalizer = createAguiEventNormalizer();

    const subscription = source.subscribe({
      next: (event: BaseEvent) => {
        const events = normalizer.process(event);
        for (const outEvent of events) {
          subscriber.next(outEvent);
        }
      },
      error: (err: unknown) => subscriber.error(err),
      complete: () => {
        const trailing = normalizer.closeActiveTextIfNeeded();
        for (const outEvent of trailing) {
          subscriber.next(outEvent);
        }
        subscriber.complete();
      },
    });

    return () => subscription.unsubscribe();
  });
}

function withNormalizedAgentEvents<T extends { [key: string]: any }>(agent: T): T {
  const target = agent as any;

  if (target.__aguiNormalized === true) {
    return target as T;
  }

  const originalRun =
    typeof target.run === "function" ? target.run.bind(target) : undefined;
  const originalConnect =
    typeof target.connect === "function" ? target.connect.bind(target) : undefined;
  const originalClone =
    typeof target.clone === "function" ? target.clone.bind(target) : undefined;

  if (originalRun) {
    target.run = (input: RunAgentInput) => normalizeAguiEventStream(originalRun(input));
  }

  if (originalConnect) {
    target.connect = (input: RunAgentInput) =>
      normalizeAguiEventStream(originalConnect(input));
  }

  if (originalClone) {
    target.clone = (...args: unknown[]) => {
      const cloned = originalClone(...args);
      return withNormalizedAgentEvents(cloned);
    };
  }

  target.__aguiNormalized = true;
  return target as T;
}

function normalizeAguiInput(rawBody: unknown): AguiInput {
  const root = (rawBody ?? {}) as Record<string, unknown>;
  const candidate =
    (root.input as Record<string, unknown> | undefined) ||
    (root.data as Record<string, unknown> | undefined) ||
    root;

  const rawMessages = Array.isArray(candidate.messages)
    ? candidate.messages
    : [];

  const messages = rawMessages
    .map((msg: unknown) => {
      const m = (msg ?? {}) as Record<string, unknown>;
      const role = typeof m.role === "string" ? m.role : "user";
      const normalizedRole =
        role === "assistant" ||
        role === "system" ||
        role === "developer" ||
        role === "tool"
          ? role
          : "user";

      return {
        id: typeof m.id === "string" && m.id ? m.id : ulid(),
        role: normalizedRole as "user" | "assistant" | "system" | "developer" | "tool",
        content: typeof m.content === "string" ? m.content : "",
        name: typeof m.name === "string" ? m.name : undefined,
        toolCalls: Array.isArray(m.toolCalls) ? m.toolCalls : undefined,
        toolCallId: typeof m.toolCallId === "string" ? m.toolCallId : undefined,
      };
    })
    .filter(Boolean);

  const normalized = {
    threadId:
      (typeof candidate.threadId === "string" && candidate.threadId) ||
      (typeof (candidate.thread as Record<string, unknown> | undefined)?.id === "string"
        ? ((candidate.thread as Record<string, unknown>).id as string)
        : "") ||
      ulid(),
    runId:
      (typeof candidate.runId === "string" && candidate.runId) ||
      (typeof (candidate.run as Record<string, unknown> | undefined)?.id === "string"
        ? ((candidate.run as Record<string, unknown>).id as string)
        : "") ||
      ulid(),
    messages,
    tools: Array.isArray(candidate.tools) ? candidate.tools : [],
    context: Array.isArray(candidate.context) ? candidate.context : [],
    state: candidate.state,
    forwardedProps: candidate.forwardedProps,
  };

  const parsed = aguiInputSchema.safeParse(normalized);
  if (parsed.success) return parsed.data;

  return {
    threadId: ulid(),
    runId: ulid(),
    messages: [],
    tools: [],
    context: [],
    state: undefined,
    forwardedProps: undefined,
  };
}

async function executeAguiStream(c: any, userId: string, input: AguiInput) {
  const db = getDatabase();

  try {
    let agent;
    try {
      agent = await getPlatformAgent(userId);
    } catch (providerError) {
      // No AI provider — return a stub SSE response with a friendly message
      return streamSSE(c, async (stream) => {
        const messageId = `stub-${Date.now()}`;
        const events: BaseEvent[] = [
          { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent,
          { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as any,
          { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: "⚠️ No AI provider configured. Please go to **Settings → AI Providers** to add and configure an AI provider before using the agent." } as any,
          { type: EventType.TEXT_MESSAGE_END, messageId } as any,
          { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId } as BaseEvent,
        ];
        for (const event of events) {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        }
      });
    }

    // Ensure thread exists in DB
    const [existingThread] = await db
      .select()
      .from(agentThreads)
      .where(
        and(
          eq(agentThreads.id, input.threadId),
          eq(agentThreads.userId, userId),
        ),
      )
      .limit(1);

    if (!existingThread) {
      const firstUserMsg = input.messages.find((m) => m.role === "user");
      const title = firstUserMsg?.content?.slice(0, 100) || "New conversation";

      await db.insert(agentThreads).values({
        id: input.threadId,
        userId,
        title,
        metadata: {},
      });
    }

    for (const msg of input.messages) {
      if (msg.role === "user") {
        await db
          .insert(agentMessages)
          .values({
            id: msg.id || ulid(),
            threadId: input.threadId,
            role: msg.role,
            content: msg.content || "",
            metadata: {},
          })
          .onConflictDoNothing();
      }
    }

    const mastraAgent = new MastraAgent({
      agentId: "platform-agent",
      description: "AI-powered platform management agent for OpenCode Review.",
      agent,
      resourceId: userId,
    });

    const runInput: RunAgentInput = {
      threadId: input.threadId,
      runId: input.runId,
      messages: input.messages as any,
      tools: input.tools as any,
      context: input.context as any,
      state: input.state,
      forwardedProps: input.forwardedProps,
    };

    const normalizedMastraAgent = withNormalizedAgentEvents(mastraAgent);
    const eventStream = normalizedMastraAgent.run(runInput);

    let assistantContent = "";
    let assistantMessageId = "";
    const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown>; result?: unknown }> = [];

    return streamSSE(c, async (stream) => {
      await new Promise<void>((resolve, reject) => {
        eventStream.subscribe({
          next: (event: BaseEvent) => {
            const outgoingEvent: BaseEvent | Record<string, unknown> = event;

            if ((outgoingEvent as any).type === "TEXT_MESSAGE_START") {
              assistantMessageId = (outgoingEvent as any).messageId || ulid();
            } else if ((outgoingEvent as any).type === "TEXT_MESSAGE_CONTENT") {
              assistantContent += (outgoingEvent as any).delta || "";
            } else if ((outgoingEvent as any).type === "TOOL_CALL_START") {
              toolCalls.push({
                id: (outgoingEvent as any).toolCallId || "",
                name: (outgoingEvent as any).toolCallName || "",
                args: {},
              });
            } else if ((outgoingEvent as any).type === "TOOL_CALL_ARGS") {
              const lastCall = toolCalls[toolCalls.length - 1];
              if (lastCall) {
                (lastCall as any)._rawArgs =
                  ((lastCall as any)._rawArgs || "") +
                  ((outgoingEvent as any).delta || "");
                try {
                  lastCall.args = JSON.parse((lastCall as any)._rawArgs);
                } catch {
                  // partial JSON, ignore until complete
                }
              }
            }

            stream
              .writeSSE({
                event: (outgoingEvent as any).type,
                data: JSON.stringify(outgoingEvent),
              })
              .catch((err: Error) => {
                console.error("[AG-UI] SSE write error:", err);
              });
          },
          error: (err: Error) => {
            console.error("[AG-UI] Stream error:", err);
            stream
              .writeSSE({
                event: "RUN_ERROR",
                data: JSON.stringify({
                  type: "RUN_ERROR",
                  message: err.message,
                  timestamp: Date.now(),
                }),
              })
              .catch(() => {});
            reject(err);
          },
          complete: async () => {
            if (assistantContent || toolCalls.length > 0) {
              try {
                const cleanedToolCalls = toolCalls.map(({ id, name, args, result }) => ({ id, name, args, result }));
                await db.insert(agentMessages).values({
                  id: assistantMessageId || ulid(),
                  threadId: input.threadId,
                  role: "assistant",
                  content: assistantContent,
                  toolCalls: cleanedToolCalls.length > 0 ? cleanedToolCalls : undefined,
                  metadata: { runId: input.runId },
                });
              } catch (persistError) {
                console.error("[AG-UI] Failed to persist assistant message:", persistError);
              }
            }

            try {
              await db
                .update(agentThreads)
                .set({ updatedAt: new Date() })
                .where(eq(agentThreads.id, input.threadId));
            } catch (updateError) {
              console.error("[AG-UI] Failed to update thread timestamp:", updateError);
            }

            resolve();
          },
        });
      });
    });
  } catch (error) {
    console.error("[AG-UI] Stream endpoint error:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "AGENT_STREAM_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Agent stream execution failed",
        },
      },
      500,
    );
  }
}

// ---------------------------------------------------------------------------
// POST /agui — CopilotKit-compatible endpoint (normalized to raw AG-UI stream)
// ---------------------------------------------------------------------------
async function handleCopilotRuntimeRequest(c: any) {
  const userId = c.get("user").id as string;

  try {
    let aguiAgent: any;

    try {
      const agent = await getPlatformAgent(userId);
      aguiAgent = withNormalizedAgentEvents(new MastraAgent({
        agentId: "platform-agent",
        description:
          "AI-powered platform management agent for OpenCode Review. Manages templates, repositories, reviews, webhooks, AI configs, and system operations.",
        agent,
        resourceId: userId,
      }));
    } catch (providerError) {
      console.warn(
        "[AG-UI] Using stub agent — no AI provider:",
        providerError instanceof Error
          ? providerError.message
          : providerError,
      );
      aguiAgent = withNormalizedAgentEvents(new StubPlatformAgent() as any);
    }

    const runtime = new CopilotRuntime({
      agents: {
        "platform-agent": aguiAgent,
      },
    });

    const handler = copilotRuntimeNodeHttpEndpoint({
      endpoint: "/api/v1/agui",
      runtime,
      serviceAdapter: new ExperimentalEmptyAdapter(),
    });

    return await handler(c.req.raw);
  } catch (error) {
    console.error("[AG-UI] CopilotKit endpoint error:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "AGENT_ERROR",
          message:
            error instanceof Error ? error.message : "Agent execution failed",
        },
      },
      500,
    );
  }
}

aguiRoutes.all("/", handleCopilotRuntimeRequest);
aguiRoutes.all("/info", handleCopilotRuntimeRequest);
aguiRoutes.all("/transcribe", handleCopilotRuntimeRequest);
aguiRoutes.all("/agents/:agentId", handleCopilotRuntimeRequest);
aguiRoutes.all("/agents/:agentId/*", handleCopilotRuntimeRequest);

aguiRoutes.post("/sync-stream", async (c: any) => {
  const userId = c.get("user").id as string;
  const rawBody = await c.req.json().catch(() => ({}));
  const input = normalizeAguiInput(rawBody);
  return executeAguiStream(c, userId, input);
});

// ---------------------------------------------------------------------------
// POST /agui/stream — Raw AG-UI SSE endpoint
// ---------------------------------------------------------------------------
aguiRoutes.post("/stream", async (c: any) => {
  const userId = c.get("user").id as string;
  const rawBody = await c.req.json().catch(() => ({}));
  const input = normalizeAguiInput(rawBody);
  return executeAguiStream(c, userId, input);
});
