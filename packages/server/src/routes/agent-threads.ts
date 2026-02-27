/// <reference path="../types/shims.d.ts" />
/**
 * Agent Thread Management Routes
 *
 * CRUD endpoints for managing agent conversation threads:
 * - GET    /agent-threads        — list user's threads
 * - GET    /agent-threads/:id    — get thread with messages
 * - PATCH  /agent-threads/:id    — update thread title
 * - DELETE /agent-threads/:id    — delete thread
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { eq, and, desc } from "drizzle-orm";

import { getDatabase } from "../db/client";
import { agentThreads, agentMessages } from "../db/schema/index";
import { authMiddleware } from "../middleware/auth";

// Update thread schema
const updateThreadSchema = z.object({
  title: z.string().min(1, "Title is required").max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const agentThreadRoutes = new Hono();

// All routes require authentication
agentThreadRoutes.use("/*", authMiddleware);

/**
 * GET /agent-threads
 * List user's conversation threads (newest first)
 */
agentThreadRoutes.get("/", async (c: any) => {
  const db = getDatabase();
  const userId = c.get("user").id as string;
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const threads = await db
    .select()
    .from(agentThreads)
    .where(eq(agentThreads.userId, userId))
    .orderBy(desc(agentThreads.updatedAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    success: true,
    data: threads,
  });
});

/**
 * GET /agent-threads/:id
 * Get thread with its messages
 */
agentThreadRoutes.get("/:id", async (c: any) => {
  const db = getDatabase();
  const userId = c.get("user").id as string;
  const threadId = c.req.param("id") as string;

  // Get thread (scoped to user)
  const [thread] = await db
    .select()
    .from(agentThreads)
    .where(and(eq(agentThreads.id, threadId), eq(agentThreads.userId, userId)))
    .limit(1);

  if (!thread) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Thread not found" },
      },
      404,
    );
  }

  // Get messages ordered by creation time
  const messages = await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.threadId, threadId))
    .orderBy(agentMessages.createdAt);

  return c.json({
    success: true,
    data: {
      ...thread,
      messages,
    },
  });
});

/**
 * PATCH /agent-threads/:id
 * Update thread title/metadata
 */
agentThreadRoutes.patch(
  "/:id",
  zValidator("json", updateThreadSchema),
  async (c: any) => {
    const db = getDatabase();
    const userId = c.get("user").id as string;
    const threadId = c.req.param("id") as string;
    const input = c.req.valid("json") as z.infer<typeof updateThreadSchema>;

    // Verify ownership
    const [existing] = await db
      .select()
      .from(agentThreads)
      .where(
        and(eq(agentThreads.id, threadId), eq(agentThreads.userId, userId)),
      )
      .limit(1);

    if (!existing) {
      return c.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Thread not found" },
        },
        404,
      );
    }

    // Build update payload
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (input.title !== undefined) {
      updateData.title = input.title;
    }
    if (input.metadata !== undefined) {
      updateData.metadata = input.metadata;
    }

    await db
      .update(agentThreads)
      .set(updateData)
      .where(eq(agentThreads.id, threadId));

    // Return updated thread
    const [updated] = await db
      .select()
      .from(agentThreads)
      .where(eq(agentThreads.id, threadId))
      .limit(1);

    return c.json({
      success: true,
      data: updated,
    });
  },
);

/**
 * DELETE /agent-threads/:id
 * Delete a thread and all its messages (cascade)
 */
agentThreadRoutes.delete("/:id", async (c: any) => {
  const db = getDatabase();
  const userId = c.get("user").id as string;
  const threadId = c.req.param("id") as string;

  // Verify ownership before delete
  const [existing] = await db
    .select()
    .from(agentThreads)
    .where(and(eq(agentThreads.id, threadId), eq(agentThreads.userId, userId)))
    .limit(1);

  if (!existing) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Thread not found" },
      },
      404,
    );
  }

  // Delete thread (messages cascade via FK)
  await db.delete(agentThreads).where(eq(agentThreads.id, threadId));

  return c.json({
    success: true,
    data: { deleted: true },
  });
});
