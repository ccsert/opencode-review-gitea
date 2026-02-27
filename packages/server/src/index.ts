/**
 * OpenCode Review Platform - Server
 *
 * Hono + Node.js HTTP server
 */

import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { existsSync } from "fs";
import { join } from "path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

import { authRoutes } from "./routes/auth";
import { repoRoutes } from "./routes/repos";
import { templateRoutes } from "./routes/templates";
import { reviewRoutes } from "./routes/reviews";
import { webhookRoutes } from "./routes/webhooks";
import { systemRoutes } from "./routes/system";
import { apiKeyRoutes } from "./routes/api-keys";
import { platformRoutes } from "./routes/platforms";
import { aiProviderRoutes } from "./routes/ai-providers";
import { aguiRoutes } from "./routes/agui";
import { agentThreadRoutes } from "./routes/agent-threads";
import {
  errorMiddleware,
  notFoundHandler,
  loggerMiddleware,
  requestIdMiddleware,
  corsConfig,
} from "./middleware/error";
import { initDatabase, runMigrations, seedDatabase } from "./db/client";

// Environment variables
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const DATABASE_URL = process.env.DATABASE_URL || "pglite:./data/review";

// Static files configuration
const SERVE_STATIC = process.env.SERVE_STATIC !== "false"; // enabled by default
const STATIC_DIR =
  process.env.STATIC_DIR || join(import.meta.dirname, "../../web/dist");

// Create app
const app = new Hono();

// Global middleware
app.use("*", requestIdMiddleware);
app.use("*", loggerMiddleware);
app.use("*", secureHeaders());
app.use("*", cors(corsConfig));
app.use("*", errorMiddleware);

// API routes
const api = new Hono()
  .route("/auth", authRoutes)
  .route("/repositories", repoRoutes)
  .route("/templates", templateRoutes)
  .route("/reviews", reviewRoutes)
  .route("/webhooks", webhookRoutes)
  .route("/api-keys", apiKeyRoutes)
  .route("/platforms", platformRoutes)
  .route("/ai-providers", aiProviderRoutes)
  .route("/system", systemRoutes)
  .route("/agui", aguiRoutes)
  .route("/agent-threads", agentThreadRoutes);

app.route("/api/v1", api);

// Health check (root path - only in standalone mode)
if (!SERVE_STATIC) {
  app.get("/", (c) =>
    c.json({
      name: "OpenCode Review Platform",
      version: "0.1.0",
      status: "running",
    }),
  );
}

// 404 handlers (API routes)
app.get("/api/*", notFoundHandler);
app.post("/api/*", notFoundHandler);
app.put("/api/*", notFoundHandler);
app.delete("/api/*", notFoundHandler);

// Static file serving (production)
if (SERVE_STATIC && existsSync(STATIC_DIR)) {
  console.log(`[Static] Serving static files from: ${STATIC_DIR}`);
  app.use("/assets/*", serveStatic({ root: STATIC_DIR }));

  // SPA fallback — serve index.html for non-API routes
  app.get("*", async (c) => {
    const indexPath = join(STATIC_DIR, "index.html");
    if (existsSync(indexPath)) {
      const { readFileSync } = await import("fs");
      return c.html(readFileSync(indexPath, "utf-8"));
    }
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'index.html not found',
      },
    }, 404)
  });
} else if (SERVE_STATIC) {
  console.log(`[Static] Static directory not found: ${STATIC_DIR}`);
  console.log(
    `[Static] Run 'pnpm run build' in packages/web to build the frontend`,
  );

  app.get("/", (c) =>
    c.json({
      name: "OpenCode Review Platform",
      version: "0.1.0",
      status: "running",
      message: 'Frontend not built. Run "pnpm run build" in packages/web',
    }),
  );
}

// Start server
async function start() {
  try {
    // Validate required environment variables
    const requiredEnvVars = ["JWT_SECRET"] as const;
    const missing = requiredEnvVars.filter((v) => !process.env[v]);
    if (missing.length > 0) {
      console.error(
        `❌ Missing required environment variables: ${missing.join(", ")}`,
      );
      console.error("See docker/.env.example for configuration reference.");
      process.exit(1);
    }

    // Warn about optional-but-important vars
    if (!process.env.ENCRYPTION_KEY) {
      console.warn(
        "⚠️  ENCRYPTION_KEY not set — stored tokens/API keys will NOT be encrypted.",
      );
      console.warn(
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    }
    // Initialize database
    await initDatabase(DATABASE_URL);

    // Run migrations
    await runMigrations();

    // Initialize default data
    await seedDatabase();

    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 OpenCode Review Platform                             ║
║                                                           ║
║   Server running at http://${HOST}:${PORT}                    ║
║   API endpoint: http://${HOST}:${PORT}/api/v1                 ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);

    serve({
      fetch: app.fetch,
      port: PORT,
      hostname: HOST,
    });

    console.log(`[Server] Listening on ${HOST}:${PORT}`);
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "EADDRINUSE") {
      console.log(`[Server] Port ${PORT} already in use`);
      console.log(`[Server] App is available at http://${HOST}:${PORT}`);
    } else {
      console.error("Failed to start server:", error);
      process.exit(1);
    }
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n[Server] Shutting down...");
  process.exit(0);
});

// Start
start();

export default app;
export type AppType = typeof api;
