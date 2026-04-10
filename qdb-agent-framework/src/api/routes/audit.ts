/**
 * Audit Routes — Query the immutable audit trail.
 */

import { Hono } from "hono";
import type { IAuditLogger } from "../../core/types.js";

export function createAuditRoutes(auditLogger: IAuditLogger): Hono {
  const app = new Hono();

  // Query audit log with filters
  app.get("/", async (c) => {
    const result = await auditLogger.query({
      agentId: c.req.query("agentId"),
      toolId: c.req.query("toolId"),
      correlationId: c.req.query("correlationId"),
      userId: c.req.query("userId"),
      fromTimestamp: c.req.query("from"),
      toTimestamp: c.req.query("to"),
      outcome: c.req.query("outcome") as "SUCCESS" | "FAILURE" | "DENIED" | "ESCALATED" | undefined,
      limit: c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : 50,
      offset: c.req.query("offset") ? parseInt(c.req.query("offset")!, 10) : 0,
    });

    if (!result.ok) {
      return c.json({ error: result.error.message }, 500);
    }

    return c.json({ count: result.value.length, entries: result.value });
  });

  // Get audit entries by correlation ID
  app.get("/correlation/:correlationId", async (c) => {
    const correlationId = c.req.param("correlationId");
    const result = await auditLogger.getByCorrelationId(correlationId);

    if (!result.ok) {
      return c.json({ error: result.error.message }, 500);
    }

    return c.json({ count: result.value.length, entries: result.value });
  });

  return app;
}
