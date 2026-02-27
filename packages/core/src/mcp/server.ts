/**
 * MCP Server for the OpenCode Review Platform
 *
 * Wraps all Mastra platform tools as MCP protocol tools, exposing them via
 * the Model Context Protocol for use with Claude Desktop, OpenCode, and other MCP clients.
 *
 * Supports two transports:
 * - stdio: For local CLI integration (Claude Desktop, OpenCode)
 * - Streamable HTTP: For remote HTTP access (via server proxy route)
 *
 * Uses the WebStandard StreamableHTTP transport for framework-agnostic HTTP support
 * (works with Hono, Cloudflare Workers, Deno, Bun, etc.)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Tool } from "@mastra/core/tools";

import {
  createTemplateTools,
  type TemplateToolDeps,
} from "../ai/tools/platform/template-tools";
import {
  createRepoTools,
  type RepoToolDeps,
} from "../ai/tools/platform/repo-tools";
import {
  createReviewTools,
  type ReviewToolDeps,
} from "../ai/tools/platform/review-tools";
import {
  createAIConfigTools,
  type AIConfigToolDeps,
} from "../ai/tools/platform/ai-config-tools";
import {
  createWebhookTools,
  type WebhookToolDeps,
} from "../ai/tools/platform/webhook-tools";
import {
  createSystemTools,
  type SystemToolDeps,
} from "../ai/tools/platform/system-tools";
import type { PlatformToolContext } from "../ai/tools/platform/types";
import type { PlatformAgentDeps } from "../ai/platform-agent";

/**
 * Configuration for creating an MCP server
 */
export interface McpPlatformServerConfig {
  /** Platform context injected into every tool */
  ctx: PlatformToolContext;
  /** Dependency injection for all tool domains */
  deps: PlatformAgentDeps;
  /** Server name advertised to MCP clients */
  name?: string;
  /** Server version advertised to MCP clients */
  version?: string;
}

/**
 * Result of creating an MCP platform server
 */
export interface McpPlatformServer {
  /** The underlying McpServer instance */
  mcpServer: McpServer;
  /** Connect to a stdio transport (for CLI tools) */
  connectStdio: () => Promise<void>;
  /** Create a WebStandard Streamable HTTP transport for web server integration */
  createHttpTransport: (options?: {
    sessionIdGenerator?: () => string;
    enableJsonResponse?: boolean;
  }) => WebStandardStreamableHTTPServerTransport;
}

/**
 * Registers a single Mastra platform tool as an MCP tool.
 *
 * Maps the Mastra tool's id, description, and inputSchema to the MCP tool format.
 * The tool's execute function is called with the parsed input and the result
 * is returned as MCP text content.
 */
function registerMastraTool(
  mcpServer: McpServer,
  mastraTool: Tool<unknown, unknown>,
): void {
  const toolId = mastraTool.id;
  const description = mastraTool.description || `Platform tool: ${toolId}`;

  // Extract the Zod schema shape from the Mastra tool's inputSchema
  // Mastra tools use z.object({...}) which is a ZodObject with a .shape property
  const inputSchema = mastraTool.inputSchema;

  if (inputSchema && "shape" in inputSchema) {
    // Has a Zod object schema with a shape — pass the raw shape to MCP
    const shape =
      typeof inputSchema.shape === "function"
        ? inputSchema.shape()
        : inputSchema.shape;

    mcpServer.tool(
      toolId,
      description,
      shape as Record<string, import("zod").ZodTypeAny>,
      async (args) => {
        try {
          const result = await mastraTool.execute?.(args, {});
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: false,
                    error:
                      error instanceof Error ? error.message : String(error),
                    code: "INTERNAL_ERROR",
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }
      },
    );
  } else {
    // No input schema — register as zero-arg tool
    mcpServer.tool(toolId, description, async () => {
      try {
        const result = await mastraTool.execute?.({}, {});
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: false,
                  error: error instanceof Error ? error.message : String(error),
                  code: "INTERNAL_ERROR",
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    });
  }
}

/**
 * Creates an MCP server that exposes all platform management tools.
 *
 * The server wraps all Mastra platform tools (templates, repos, reviews,
 * AI config, webhooks, system) as MCP protocol tools, making them available
 * to any MCP-compatible client.
 *
 * @example Stdio transport (Claude Desktop / OpenCode)
 * ```typescript
 * const server = createMcpPlatformServer({
 *   ctx: { db, userId: 'user_123', userRole: 'admin' },
 *   deps: { template: templateDeps, repo: repoDeps, ... },
 * });
 * await server.connectStdio();
 * ```
 *
 * @example HTTP transport (Hono web server)
 * ```typescript
 * const server = createMcpPlatformServer({ ctx, deps });
 * const transport = server.createHttpTransport({
 *   sessionIdGenerator: () => crypto.randomUUID(),
 * });
 * await server.mcpServer.connect(transport);
 *
 * // In Hono route handler:
 * app.all('/mcp', async (c) => {
 *   const response = await transport.handleRequest(c.req.raw);
 *   return response;
 * });
 * ```
 */
export function createMcpPlatformServer(
  config: McpPlatformServerConfig,
): McpPlatformServer {
  const { ctx, deps, name, version } = config;

  // Create the MCP server
  const mcpServer = new McpServer({
    name: name ?? "opencode-review-platform",
    version: version ?? "0.1.0",
  });

  // Create all Mastra tool sets via dependency injection
  const templateTools = createTemplateTools(ctx, deps.template);
  const repoTools = createRepoTools(ctx, deps.repo);
  const reviewTools = createReviewTools(ctx, deps.review);
  const aiConfigTools = createAIConfigTools(ctx, deps.aiConfig);
  const webhookTools = createWebhookTools(ctx, deps.webhook);
  const systemTools = createSystemTools(ctx, deps.system);

  // Merge all tools into a single record
  const allTools: Record<string, Tool<unknown, unknown>> = {
    ...templateTools,
    ...repoTools,
    ...reviewTools,
    ...aiConfigTools,
    ...webhookTools,
    ...systemTools,
  } as Record<string, Tool<unknown, unknown>>;

  // Register each Mastra tool as an MCP tool
  for (const [, tool] of Object.entries(allTools)) {
    registerMastraTool(mcpServer, tool);
  }

  return {
    mcpServer,

    async connectStdio(): Promise<void> {
      const transport = new StdioServerTransport();
      await mcpServer.connect(transport);
    },

    createHttpTransport(options?: {
      sessionIdGenerator?: () => string;
      enableJsonResponse?: boolean;
    }): WebStandardStreamableHTTPServerTransport {
      return new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: options?.sessionIdGenerator,
        enableJsonResponse: options?.enableJsonResponse ?? false,
      });
    },
  };
}

export {
  McpServer,
  StdioServerTransport,
  WebStandardStreamableHTTPServerTransport,
};
