/**
 * HTTP Server — Hono application assembly.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { apiKeyAuth } from "./middleware/auth.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { createChatRoutes } from "./routes/chat.js";
import { createAdminRoutes } from "./routes/admin.js";
import { createAuditRoutes } from "./routes/audit.js";
import type { InMemoryMessageBus } from "../core/message-bus.js";
import type { ToolRegistry } from "../core/tool-registry.js";
import type { IAuditLogger } from "../core/types.js";
import type { PolicyEngine } from "../governance/policy-engine.js";
import type { EscalationManager } from "../governance/escalation.js";

export interface ServerDependencies {
  messageBus: InMemoryMessageBus;
  toolRegistry: ToolRegistry;
  auditLogger: IAuditLogger;
  policyEngine: PolicyEngine;
  escalationManager: EscalationManager;
}

export function createServer(deps: ServerDependencies): Hono {
  const app = new Hono();

  // Global middleware
  app.use("*", cors());
  app.use("*", logger());
  app.use("*", apiKeyAuth());
  app.use("/api/*", rateLimit(60));

  // Routes
  app.route("/api/chat", createChatRoutes(deps.messageBus));
  app.route("/api/admin", createAdminRoutes(
    deps.toolRegistry,
    deps.policyEngine,
    deps.escalationManager,
    deps.messageBus,
  ));
  app.route("/api/audit", createAuditRoutes(deps.auditLogger));

  // Root health check
  app.get("/", (c) => {
    return c.json({
      name: "QDB Agent Framework",
      version: "1.0.0",
      status: "running",
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
