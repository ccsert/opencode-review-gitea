/**
 * MCP HTTP Proxy Route
 *
 * Proxies MCP protocol requests to the platform's MCP server in stateless HTTP mode.
 * Each request creates a new MCP server + transport instance, authenticated via JWT/API key.
 *
 * Supports GET (SSE stream), POST (JSON-RPC), and DELETE (session close) via
 * WebStandardStreamableHTTPServerTransport.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { authMiddleware } from "../middleware/auth";
import { createMcpPlatformServer } from "@opencode-review/core";
import { buildPlatformContext, mapUserRole } from "../services/agent-runtime";

export const mcpRoutes = new Hono();

// All MCP routes require authentication
mcpRoutes.use("/*", authMiddleware);

/**
 * Handle an MCP HTTP request (stateless mode).
 * Creates a fresh MCP server + transport per request.
 */
async function handleMcpRequest(c: Context): Promise<Response> {
  const user = c.get("user");
  const { ctx, deps } = buildPlatformContext(user.id, mapUserRole(user.role));

  const server = createMcpPlatformServer({ ctx, deps });
  const transport = server.createHttpTransport({
    // Stateless mode — no session persistence needed
  });

  await server.mcpServer.connect(transport);
  const response = await transport.handleRequest(c.req.raw);
  return response;
}

// MCP protocol uses POST (JSON-RPC), GET (SSE stream), DELETE (session close)
mcpRoutes.post("/*", handleMcpRequest);
mcpRoutes.get("/*", handleMcpRequest);
mcpRoutes.delete("/*", handleMcpRequest);
