/**
 * Admin Routes — Agent management, tool registry, and system health.
 */

import { Hono } from "hono";
import type { ToolRegistry } from "../../core/tool-registry.js";
import type { PolicyEngine } from "../../governance/policy-engine.js";
import type { EscalationManager } from "../../governance/escalation.js";
import type { InMemoryMessageBus } from "../../core/message-bus.js";

export function createAdminRoutes(
  toolRegistry: ToolRegistry,
  policyEngine: PolicyEngine,
  escalationManager: EscalationManager,
  messageBus: InMemoryMessageBus,
): Hono {
  const app = new Hono();

  // System health
  app.get("/health", (c) => {
    return c.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      agents: messageBus.getRegisteredAgents(),
      tools: toolRegistry.listTools().length,
      policies: policyEngine.getAllPolicies().length,
    });
  });

  // List registered tools
  app.get("/tools", (c) => {
    const tools = toolRegistry.listTools();
    return c.json({
      count: tools.length,
      tools: tools.map((t) => ({
        toolId: t.toolId,
        displayName: t.displayName,
        operationType: t.operationType,
        dataClassification: t.dataClassification,
        authorizedAgents: t.authorizedAgents,
        requiresApproval: t.requiresApproval,
      })),
    });
  });

  // Get specific tool manifest
  app.get("/tools/:toolId", (c) => {
    const toolId = c.req.param("toolId");
    const manifest = toolRegistry.getManifest(toolId);
    if (!manifest) {
      return c.json({ error: `Tool "${toolId}" not found` }, 404);
    }
    return c.json(manifest);
  });

  // List loaded policies
  app.get("/policies", (c) => {
    const policies = policyEngine.getAllPolicies();
    return c.json({
      count: policies.length,
      policies: policies.map((p) => ({
        agentId: p.agentId,
        displayName: p.displayName,
        version: p.version,
        ownerTeam: p.ownerTeam,
        allowedTools: p.allowedTools.length,
        deniedTools: p.deniedTools.length,
        autonomyDefault: p.autonomy.defaultLevel,
        maxClassification: p.dataBoundaries.maxClassification,
      })),
    });
  });

  // Get specific agent policy
  app.get("/policies/:agentId", (c) => {
    const agentId = c.req.param("agentId");
    const policy = policyEngine.getPolicy(agentId);
    if (!policy) {
      return c.json({ error: `Policy for "${agentId}" not found` }, 404);
    }
    return c.json(policy);
  });

  // List pending approvals
  app.get("/approvals", (c) => {
    const agentId = c.req.query("agentId");
    const pending = escalationManager.getPendingApprovals(agentId);
    return c.json({ count: pending.length, approvals: pending });
  });

  // Resolve approval
  app.post("/approvals/:requestId/resolve", async (c) => {
    const requestId = c.req.param("requestId");
    const body = await c.req.json();
    const approved = body.approved === true;
    const resolvedBy = (body.resolvedBy as string) ?? "admin";

    const result = await escalationManager.resolveApproval(requestId, approved, resolvedBy);

    if (!result.ok) {
      return c.json({ error: result.error.message }, 400);
    }

    return c.json({ success: true, approval: result.value });
  });

  // List registered agents
  app.get("/agents", (c) => {
    const agents = messageBus.getRegisteredAgents();
    return c.json({ count: agents.length, agents });
  });

  return app;
}
