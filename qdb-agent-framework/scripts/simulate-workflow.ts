/**
 * Simulate Workflow — End-to-end workflow simulation.
 * Run: npm run simulate
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync } from "node:fs";

import { AuditLogger } from "../src/core/audit-logger.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { InMemoryMessageBus } from "../src/core/message-bus.js";
import { SQLiteStateStore } from "../src/core/state-store.js";
import { PolicyEngine } from "../src/governance/policy-engine.js";
import { createEnvelope } from "../src/core/message-envelope.js";
import { DataClassification } from "../src/core/types.js";

import { manifest as pbiManifest, execute as pbiExecute } from "../src/tools/data/query-power-bi.js";
import { manifest as ecmManifest, execute as ecmExecute } from "../src/tools/data/search-ecm.js";
import { manifest as ticketManifest, execute as ticketExecute } from "../src/tools/actions/create-ticket.js";
import { manifest as notifManifest, execute as notifExecute } from "../src/tools/actions/send-notification.js";
import { manifest as auditToolManifest, createExecutor } from "../src/tools/compliance/log-audit-trail.js";

import { RouterAgent } from "../src/agents/router/router-agent.js";
import { ITOpsAgent } from "../src/agents/it-operations/it-ops-agent.js";
import { PMOAgent } from "../src/agents/pmo/pmo-agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function simulate() {
  console.log("=== QDB Agent Framework — Workflow Simulation ===\n");

  // Setup
  const dataDir = join(__dirname, "..", "data");
  if (!existsSync(join(dataDir, "audit"))) mkdirSync(join(dataDir, "audit"), { recursive: true });

  const auditLogger = new AuditLogger(join(dataDir, "audit", "sim-audit.db"));
  const toolRegistry = new ToolRegistry(auditLogger);
  const messageBus = new InMemoryMessageBus(auditLogger);
  const stateStore = new SQLiteStateStore(join(dataDir, "sim-sessions.db"));
  const policyEngine = new PolicyEngine();
  policyEngine.loadFromDirectory(join(__dirname, "..", "policies"));

  // Register tools
  toolRegistry.register(pbiManifest, pbiExecute);
  toolRegistry.register(ecmManifest, ecmExecute);
  toolRegistry.register(ticketManifest, ticketExecute);
  toolRegistry.register(notifManifest, notifExecute);
  toolRegistry.register(auditToolManifest, createExecutor(auditLogger));

  // Initialize agents
  const deps = { messageBus, toolRegistry, stateStore, auditLogger };
  const router = new RouterAgent(deps, policyEngine.getPolicy("router")!);
  const itOps = new ITOpsAgent(deps, policyEngine.getPolicy("it_operations")!);
  const pmo = new PMOAgent(deps, policyEngine.getPolicy("pmo")!);

  await router.initialize();
  await itOps.initialize();
  await pmo.initialize();

  console.log("Agents online:", messageBus.getRegisteredAgents().join(", "));

  // Simulate user messages
  const scenarios = [
    { message: "What is the current service health status and monitoring uptime?", description: "IT Service Health Query" },
    { message: "Show me the project delivery milestone status", description: "PMO Project Status" },
    { message: "There is a network outage incident affecting the server", description: "IT Incident Report" },
    { message: "I need the disaster recovery playbook for Azure failover", description: "DR Playbook Request" },
  ];

  for (const scenario of scenarios) {
    console.log(`\n--- Scenario: ${scenario.description} ---`);
    console.log(`User: "${scenario.message}"`);

    const envelope = createEnvelope({
      sourceAgent: "api_gateway",
      targetAgent: "router",
      action: "user_message",
      payload: { message: scenario.message },
      dataClassification: DataClassification.INTERNAL,
      metadata: { sessionId: `sim-${Date.now()}`, userId: "sim-user" },
      ttlSeconds: 60,
    });

    if (!envelope.ok) {
      console.error("Failed to create envelope:", envelope.error.message);
      continue;
    }

    const result = await messageBus.request(envelope.value, 30_000);

    if (result.ok) {
      const payload = result.value.payload as {
        response?: { message?: string; success?: boolean; toolsInvoked?: string[]; escalated?: boolean };
      };
      console.log(`Response: ${payload.response?.message?.slice(0, 200)}`);
      console.log(`  Success: ${payload.response?.success}`);
      console.log(`  Tools: ${payload.response?.toolsInvoked?.join(", ") ?? "none"}`);
      console.log(`  Escalated: ${payload.response?.escalated ?? false}`);
    } else {
      console.error(`  Failed: ${result.error.message}`);
    }
  }

  // Show audit trail
  console.log("\n--- Audit Trail Summary ---");
  const auditResult = await auditLogger.query({ limit: 20 });
  if (auditResult.ok) {
    console.log(`Total audit entries: ${auditResult.value.length}`);
    for (const entry of auditResult.value.slice(0, 10)) {
      console.log(`  [${entry.outcome}] ${entry.agentId}: ${entry.action} — ${entry.outputSummary.slice(0, 80)}`);
    }
  }

  // Cleanup
  await router.shutdown();
  await itOps.shutdown();
  await pmo.shutdown();
  auditLogger.close();
  stateStore.close();

  console.log("\n=== Simulation Complete ===");
}

simulate().catch(console.error);
