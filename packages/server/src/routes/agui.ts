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
import { zValidator } from "@hono/zod-validator";
import { ulid } from "ulid";

import { MastraAgent } from "@ag-ui/mastra";
import { EventEncoder } from "@ag-ui/encoder";
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

// ---------------------------------------------------------------------------
// POST /agui — CopilotKit runtime endpoint
// ---------------------------------------------------------------------------
aguiRoutes.post("/", async (c: any) => {
  const userId = c.get("user").id as string;

  try {
    let aguiAgent: any;

    try {
      const agent = await getPlatformAgent(userId);

      // Wrap in MastraAgent for AG-UI compatibility
      aguiAgent = new MastraAgent({
        agentId: "platform-agent",
        description:
          "AI-powered platform management agent for OpenCode Review. Manages templates, repositories, reviews, webhooks, AI configs, and system operations.",
        agent,
        resourceId: userId,
      });
    } catch (providerError) {
      // No AI provider configured — use stub so CopilotKit can discover
      // the agent and show a user-friendly message instead of 500.
      console.warn(
        "[AG-UI] Using stub agent — no AI provider:",
        providerError instanceof Error
          ? providerError.message
          : providerError,
      );
      aguiAgent = new StubPlatformAgent() as any;
    }

    // Create CopilotKit runtime with the agent (real or stub)
    const runtime = new CopilotRuntime({
      agents: {
        "platform-agent": aguiAgent,
      },
    });

    // Build the handler
    const handler = copilotRuntimeNodeHttpEndpoint({
      endpoint: "/api/v1/agui",
      runtime,
      serviceAdapter: new ExperimentalEmptyAdapter(),
    });

    // CopilotKit handler accepts raw Request and returns Response
    const response = await handler(c.req.raw);
    return response;
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
});

// ---------------------------------------------------------------------------
// POST /agui/stream — Raw AG-UI SSE endpoint
// ---------------------------------------------------------------------------
aguiRoutes.post(
  "/stream",
  zValidator("json", aguiInputSchema),
  async (c: any) => {
    const userId = c.get("user").id as string;
    const input = c.req.valid("json") as z.infer<typeof aguiInputSchema>;
    const db = getDatabase();

    try {
      let agent;
      try {
        agent = await getPlatformAgent(userId);
      } catch (providerError) {
        // No AI provider — return a stub SSE response with a friendly message
        const encoder = new EventEncoder();
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
            await stream.writeSSE({ event: event.type, data: encoder.encodeSSE(event) });
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
        // Auto-create thread on first message
        const firstUserMsg = input.messages.find((m) => m.role === "user");
        const title =
          firstUserMsg?.content?.slice(0, 100) || "New conversation";

        await db.insert(agentThreads).values({
          id: input.threadId,
          userId,
          title,
          metadata: {},
        });
      }

      // Persist incoming user messages
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

      // Wrap in MastraAgent
      const mastraAgent = new MastraAgent({
        agentId: "platform-agent",
        description:
          "AI-powered platform management agent for OpenCode Review.",
        agent,
        resourceId: userId,
      });

      // Build RunAgentInput
      const runInput: RunAgentInput = {
        threadId: input.threadId,
        runId: input.runId,
        messages: input.messages as any,
        tools: input.tools as any,
        context: input.context as any,
        state: input.state,
        forwardedProps: input.forwardedProps,
      };

      // Get the RxJS Observable of AG-UI events
      const eventStream = mastraAgent.run(runInput);
      const encoder = new EventEncoder();

      // Collect assistant response for persistence
      let assistantContent = "";
      let assistantMessageId = "";
      const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown>; result?: unknown }> = [];
      const toolResults: Array<{ toolCallId: string; content: unknown }> = [];

      // Stream SSE response
      return streamSSE(c, async (stream) => {
        await new Promise<void>((resolve, reject) => {
          eventStream.subscribe({
            next: (event: BaseEvent) => {
              // Collect text content for persistence
              if (event.type === "TEXT_MESSAGE_START") {
                assistantMessageId = (event as any).messageId || ulid();
              } else if (event.type === "TEXT_MESSAGE_CONTENT") {
                assistantContent += (event as any).delta || "";
              } else if (event.type === "TOOL_CALL_START") {
                toolCalls.push({
                  id: (event as any).toolCallId || "",
                  name: (event as any).toolCallName || "",
                  args: {},
                });
              } else if (event.type === "TOOL_CALL_ARGS") {
                const lastCall = toolCalls[toolCalls.length - 1];
                if (lastCall) {
                  // Accumulate raw args string then parse at end
                  (lastCall as any)._rawArgs =
                    ((lastCall as any)._rawArgs || "") +
                    ((event as any).delta || "");
                  try {
                    lastCall.args = JSON.parse((lastCall as any)._rawArgs);
                  } catch {
                    // partial JSON, will be parsed on completion
                  }
                }
              } else if (event.type === "TOOL_CALL_RESULT") {
                toolResults.push({
                  toolCallId: (event as any).toolCallId,
                  content: (event as any).content,
                });
              }

              // Encode and send SSE event
              const sseData = encoder.encodeSSE(event);
              stream
                .writeSSE({
                  event: event.type,
                  data: sseData,
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
              // Persist assistant response
              if (assistantContent || toolCalls.length > 0) {
                try {
                  // Clean up internal raw args before persisting
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
                  console.error(
                    "[AG-UI] Failed to persist assistant message:",
                    persistError,
                  );
                }
              }

              // Update thread timestamp
              try {
                await db
                  .update(agentThreads)
                  .set({ updatedAt: new Date() })
                  .where(eq(agentThreads.id, input.threadId));
              } catch (updateError) {
                console.error(
                  "[AG-UI] Failed to update thread timestamp:",
                  updateError,
                );
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
  },
);
