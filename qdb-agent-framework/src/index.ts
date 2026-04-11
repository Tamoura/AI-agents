/**
 * QDB Agent Framework — Application Entry Point.
 * Wires all components together and starts the HTTP server.
 */

import { serve } from "@hono/node-server";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync } from "node:fs";

// Core
import { AuditLogger } from "./core/audit-logger.js";
import { ToolRegistry } from "./core/tool-registry.js";
import { InMemoryMessageBus } from "./core/message-bus.js";
import { SQLiteStateStore } from "./core/state-store.js";
import { LLMRouter, CLASSIFICATION_RULE, REASONING_RULE } from "./core/llm-router.js";
import { GuardrailsEngine } from "./core/guardrails.js";
import { MemoryManager } from "./core/memory.js";
import { initializeObservability } from "./core/observability.js";

// Governance
import { PolicyEngine } from "./governance/policy-engine.js";
import { EscalationManager } from "./governance/escalation.js";
import { GovernanceAgent } from "./governance/governance-agent.js";

// Tools
import { manifest as cbsManifest, execute as cbsExecute } from "./tools/data/query-core-banking.js";
import { manifest as pbiManifest, execute as pbiExecute } from "./tools/data/query-power-bi.js";
import { manifest as ecmManifest, execute as ecmExecute } from "./tools/data/search-ecm.js";
import { manifest as ticketManifest, execute as ticketExecute } from "./tools/actions/create-ticket.js";
import { manifest as notifManifest, execute as notifExecute } from "./tools/actions/send-notification.js";
import { manifest as shariaManifest, execute as shariaExecute } from "./tools/compliance/check-sharia.js";
import { manifest as qcbManifest, execute as qcbExecute } from "./tools/compliance/validate-qcb-limits.js";
import { manifest as auditToolManifest, createExecutor as createAuditExecutor } from "./tools/compliance/log-audit-trail.js";

// Agents
import { RouterAgent } from "./agents/router/router-agent.js";
import { ITOpsAgent } from "./agents/it-operations/it-ops-agent.js";
import { PMOAgent } from "./agents/pmo/pmo-agent.js";

// API
import { createServer } from "./api/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  console.log("Starting QDB Agent Framework...");

  // ─── Data Directories ──────────────────────────────────────────────────
  const dataDir = join(__dirname, "..", "data");
  const auditDir = join(dataDir, "audit");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true });

  // ─── Core Infrastructure ───────────────────────────────────────────────
  const auditLogger = new AuditLogger(join(auditDir, "audit.db"));
  const toolRegistry = new ToolRegistry(auditLogger);
  const messageBus = new InMemoryMessageBus(auditLogger);
  const stateStore = new SQLiteStateStore(join(dataDir, "sessions.db"));

  // ─── New Best-in-Class Modules ──────────────────────────────────────────
  initializeObservability();

  const llmRouter = new LLMRouter([
    {
      provider: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultModel: "claude-sonnet-4-20250514",
      enabled: !!process.env.ANTHROPIC_API_KEY,
    },
    {
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      defaultModel: "gpt-4o",
      enabled: !!process.env.OPENAI_API_KEY,
    },
    {
      provider: "ollama",
      baseUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
      defaultModel: "llama3",
      enabled: !!process.env.OLLAMA_URL,
    },
  ]);
  llmRouter.addRoutingRule(CLASSIFICATION_RULE);
  llmRouter.addRoutingRule(REASONING_RULE);

  const guardrails = new GuardrailsEngine();
  const memoryManager = new MemoryManager(
    { maxTokens: 100_000, windowSize: 20, enableLongTermMemory: true },
    llmRouter,
  );

  console.log("Core infrastructure initialized.");
  console.log(`LLM providers: ${llmRouter.getAvailableProviders().join(", ") || "none (mock mode)"}`);
  console.log(`Guardrail rules: ${guardrails.getRuleNames().join(", ")}`);

  // ─── Register Tools ────────────────────────────────────────────────────
  const tools = [
    { manifest: cbsManifest, executor: cbsExecute },
    { manifest: pbiManifest, executor: pbiExecute },
    { manifest: ecmManifest, executor: ecmExecute },
    { manifest: ticketManifest, executor: ticketExecute },
    { manifest: notifManifest, executor: notifExecute },
    { manifest: shariaManifest, executor: shariaExecute },
    { manifest: qcbManifest, executor: qcbExecute },
    { manifest: auditToolManifest, executor: createAuditExecutor(auditLogger) },
  ];

  for (const { manifest, executor } of tools) {
    const result = toolRegistry.register(manifest, executor);
    if (!result.ok) {
      console.error(`Failed to register tool ${manifest.toolId}: ${result.error.message}`);
    } else {
      console.log(`Registered tool: ${manifest.toolId}`);
    }
  }

  // ─── Load Policies ─────────────────────────────────────────────────────
  const policyEngine = new PolicyEngine();
  const policiesDir = join(__dirname, "..", "policies");
  const policiesResult = policyEngine.loadFromDirectory(policiesDir);

  if (policiesResult.ok) {
    console.log(`Loaded ${policiesResult.value.length} agent policies.`);
  } else {
    console.error(`Failed to load policies: ${policiesResult.error.message}`);
  }

  // ─── Governance ────────────────────────────────────────────────────────
  const escalationManager = new EscalationManager(auditLogger);
  // GovernanceAgent is constructed for its side effects (policy enforcement is wired in via dependencies)
  new GovernanceAgent(policyEngine, auditLogger, escalationManager);

  // ─── Agent Dependencies ────────────────────────────────────────────────
  const agentDeps = {
    messageBus,
    toolRegistry,
    stateStore,
    auditLogger,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    llmRouter,
    guardrails,
    memory: memoryManager,
  };

  // ─── Initialize Agents ─────────────────────────────────────────────────
  const routerPolicy = policyEngine.getPolicy("router");
  const itOpsPolicy = policyEngine.getPolicy("it_operations");
  const pmoPolicy = policyEngine.getPolicy("pmo");

  if (!routerPolicy || !itOpsPolicy || !pmoPolicy) {
    console.error("Missing required agent policies. Ensure router, it_operations, and pmo policies are loaded.");
    process.exit(1);
  }

  const routerAgent = new RouterAgent(agentDeps, routerPolicy);
  const itOpsAgent = new ITOpsAgent(agentDeps, itOpsPolicy);
  const pmoAgent = new PMOAgent(agentDeps, pmoPolicy);

  await routerAgent.initialize();
  await itOpsAgent.initialize();
  await pmoAgent.initialize();

  console.log(`Agents initialized: ${messageBus.getRegisteredAgents().join(", ")}`);

  // ─── HTTP Server ───────────────────────────────────────────────────────
  const app = createServer({
    messageBus,
    toolRegistry,
    auditLogger,
    policyEngine,
    escalationManager,
    guardrails,
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`QDB Agent Framework running on http://localhost:${info.port}`);
    console.log(`  POST /api/chat          — Send a message`);
    console.log(`  GET  /api/admin/health   — System health`);
    console.log(`  GET  /api/admin/tools    — List tools`);
    console.log(`  GET  /api/admin/policies — List policies`);
    console.log(`  GET  /api/admin/agents   — List agents`);
    console.log(`  GET  /api/audit          — Query audit log`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    await routerAgent.shutdown();
    await itOpsAgent.shutdown();
    await pmoAgent.shutdown();
    auditLogger.close();
    stateStore.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
