import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { AuditLogger } from "../../src/core/audit-logger.js";
import { ToolRegistry } from "../../src/core/tool-registry.js";
import { InMemoryMessageBus } from "../../src/core/message-bus.js";
import { SQLiteStateStore } from "../../src/core/state-store.js";
import { PolicyEngine } from "../../src/governance/policy-engine.js";
import { EscalationManager } from "../../src/governance/escalation.js";
import { createEnvelope } from "../../src/core/message-envelope.js";
import { DataClassification, AutonomyLevel } from "../../src/core/types.js";

// Tools
import { manifest as pbiManifest, execute as pbiExecute } from "../../src/tools/data/query-power-bi.js";
import { manifest as ecmManifest, execute as ecmExecute } from "../../src/tools/data/search-ecm.js";
import { manifest as ticketManifest, execute as ticketExecute } from "../../src/tools/actions/create-ticket.js";
import { manifest as notifManifest, execute as notifExecute } from "../../src/tools/actions/send-notification.js";
import { manifest as auditToolManifest, createExecutor } from "../../src/tools/compliance/log-audit-trail.js";

// Agents
import { RouterAgent } from "../../src/agents/router/router-agent.js";
import { ITOpsAgent } from "../../src/agents/it-operations/it-ops-agent.js";
import { PMOAgent } from "../../src/agents/pmo/pmo-agent.js";

const TEST_DB_DIR = join(process.cwd(), "tests", ".tmp");
const AUDIT_DB = join(TEST_DB_DIR, "e2e-audit.db");
const STATE_DB = join(TEST_DB_DIR, "e2e-state.db");

describe("End-to-End Integration", () => {
  let auditLogger: AuditLogger;
  let toolRegistry: ToolRegistry;
  let messageBus: InMemoryMessageBus;
  let stateStore: SQLiteStateStore;
  let policyEngine: PolicyEngine;

  beforeAll(async () => {
    if (!existsSync(TEST_DB_DIR)) mkdirSync(TEST_DB_DIR, { recursive: true });
    for (const path of [AUDIT_DB, STATE_DB]) {
      if (existsSync(path)) unlinkSync(path);
    }

    // Initialize infrastructure
    auditLogger = new AuditLogger(AUDIT_DB);
    toolRegistry = new ToolRegistry(auditLogger);
    messageBus = new InMemoryMessageBus(auditLogger);
    stateStore = new SQLiteStateStore(STATE_DB);
    policyEngine = new PolicyEngine();

    // Load policies
    policyEngine.loadFromDirectory("./policies");

    // Register tools
    toolRegistry.register(pbiManifest, pbiExecute);
    toolRegistry.register(ecmManifest, ecmExecute);
    toolRegistry.register(ticketManifest, ticketExecute);
    toolRegistry.register(notifManifest, notifExecute);
    toolRegistry.register(auditToolManifest, createExecutor(auditLogger));

    // Initialize agents
    const deps = { messageBus, toolRegistry, stateStore, auditLogger };
    const routerPolicy = policyEngine.getPolicy("router")!;
    const itOpsPolicy = policyEngine.getPolicy("it_operations")!;
    const pmoPolicy = policyEngine.getPolicy("pmo")!;

    const router = new RouterAgent(deps, routerPolicy);
    const itOps = new ITOpsAgent(deps, itOpsPolicy);
    const pmo = new PMOAgent(deps, pmoPolicy);

    await router.initialize();
    await itOps.initialize();
    await pmo.initialize();
  });

  afterAll(() => {
    auditLogger.close();
    stateStore.close();
    for (const path of [AUDIT_DB, STATE_DB]) {
      if (existsSync(path)) unlinkSync(path);
    }
  });

  it("routes an IT service health query end-to-end", async () => {
    const envelope = createEnvelope({
      sourceAgent: "api_gateway",
      targetAgent: "router",
      action: "user_message",
      payload: { message: "Show me the service health status and monitoring uptime" },
      dataClassification: DataClassification.INTERNAL,
      metadata: { sessionId: "e2e-sess-1", userId: "user-1" },
      ttlSeconds: 60,
    });

    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;

    const result = await messageBus.request(envelope.value, 30_000);
    expect(result.ok).toBe(true);

    if (result.ok) {
      const payload = result.value.payload as { response?: { message?: string; success?: boolean } };
      expect(payload.response?.success).toBe(true);
      expect(payload.response?.message).toContain("Infrastructure Status");
    }
  });

  it("routes an incident report and creates a ticket", async () => {
    const envelope = createEnvelope({
      sourceAgent: "api_gateway",
      targetAgent: "router",
      action: "user_message",
      payload: { message: "There is a server outage incident affecting the network, it is not working" },
      dataClassification: DataClassification.INTERNAL,
      metadata: { sessionId: "e2e-sess-2", userId: "user-1" },
      ttlSeconds: 60,
    });

    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;

    const result = await messageBus.request(envelope.value, 30_000);
    expect(result.ok).toBe(true);

    if (result.ok) {
      const payload = result.value.payload as { response?: { message?: string; toolsInvoked?: string[] } };
      expect(payload.response?.message).toContain("Incident classified");
      expect(payload.response?.toolsInvoked).toContain("qdb.action.create_ticket");
    }
  });

  it("routes a PMO status query and retrieves project data", async () => {
    const envelope = createEnvelope({
      sourceAgent: "api_gateway",
      targetAgent: "router",
      action: "user_message",
      payload: { message: "Show me the project delivery milestone status report" },
      dataClassification: DataClassification.INTERNAL,
      metadata: { sessionId: "e2e-sess-3", userId: "user-1" },
      ttlSeconds: 60,
    });

    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;

    const result = await messageBus.request(envelope.value, 30_000);
    expect(result.ok).toBe(true);

    if (result.ok) {
      const payload = result.value.payload as { response?: { message?: string; success?: boolean } };
      expect(payload.response?.success).toBe(true);
      expect(payload.response?.message).toContain("Project Portfolio");
    }
  });

  it("produces audit trail entries for the entire chain", async () => {
    const envelope = createEnvelope({
      sourceAgent: "api_gateway",
      targetAgent: "router",
      action: "user_message",
      payload: { message: "Check the IT monitoring service health status dashboard" },
      dataClassification: DataClassification.INTERNAL,
      metadata: { sessionId: "e2e-sess-4", userId: "user-1" },
      ttlSeconds: 60,
    });

    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;

    const corrId = envelope.value.correlationId;
    await messageBus.request(envelope.value, 30_000);

    // Check audit trail
    const auditEntries = await auditLogger.getByCorrelationId(corrId);
    expect(auditEntries.ok).toBe(true);
    if (auditEntries.ok) {
      // Should have multiple entries: message publish, router processing, agent processing, tool invocations
      expect(auditEntries.value.length).toBeGreaterThanOrEqual(2);

      // Verify all entries have required fields
      for (const entry of auditEntries.value) {
        expect(entry.timestamp).toBeDefined();
        expect(entry.agentId).toBeDefined();
        expect(entry.correlationId).toBe(corrId);
      }
    }
  });

  it("DR playbook query returns relevant documents", async () => {
    const envelope = createEnvelope({
      sourceAgent: "api_gateway",
      targetAgent: "router",
      action: "user_message",
      payload: { message: "I need the disaster recovery playbook for Azure" },
      dataClassification: DataClassification.INTERNAL,
      metadata: { sessionId: "e2e-sess-5", userId: "user-1" },
      ttlSeconds: 60,
    });

    expect(envelope.ok).toBe(true);
    if (!envelope.ok) return;

    const result = await messageBus.request(envelope.value, 30_000);
    expect(result.ok).toBe(true);

    if (result.ok) {
      const payload = result.value.payload as { response?: { message?: string; data?: { playbooks?: unknown[] } } };
      expect(payload.response?.message).toContain("playbook");
      expect(payload.response?.data?.playbooks?.length).toBeGreaterThan(0);
    }
  });
});
