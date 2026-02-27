/**
 * MCP Server module
 * Exposes platform tools via the Model Context Protocol
 */

export {
  createMcpPlatformServer,
  type McpPlatformServerConfig,
  type McpPlatformServer,
} from "./server";

// Re-export MCP SDK transports for convenience
export {
  McpServer,
  StdioServerTransport,
  WebStandardStreamableHTTPServerTransport,
} from "./server";
