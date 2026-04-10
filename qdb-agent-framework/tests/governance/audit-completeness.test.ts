import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { AuditLogger } from "../../src/core/audit-logger.js";
import { ToolRegistry } from "../../src/core/tool-registry.js";
import {
  DataClassification,
  OperationType,
  AutonomyLevel,
  AuditLevel,
  type ToolManifest,
  type ToolExecutor,
} from "../../src/core/types.js";

const TEST_DB_DIR = join(process.cwd(), "tests", ".tmp");
const TEST_DB_PATH = join(TEST_DB_DIR, "audit-completeness.db");

describe("Audit Completeness", () => {
  let auditLogger: AuditLogger;
  let registry: ToolRegistry;

  beforeEach(() => {
    if (!existsSync(TEST_DB_DIR)) mkdirSync(TEST_DB_DIR, { recursive: true });
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
    auditLogger = new AuditLogger(TEST_DB_PATH);
    registry = new ToolRegistry(auditLogger);
  });

  afterEach(() => {
    auditLogger.close();
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  });

  const testManifest: ToolManifest = {
    toolId: "qdb.data.audit_test",
    displayName: "Audit Test Tool",
    description: "Tool for testing audit completeness",
    version: "1.0.0",
    ownerTeam: "Test",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    outputSchema: { type: "object" },
    dataClassification: DataClassification.INTERNAL,
    operationType: OperationType.READ,
    authorizedAgents: ["it_operations"],
    requiresApproval: false,
    rateLimit: { maxPerMinute: 100 },
    timeoutMs: 5000,
    retryPolicy: { maxRetries: 1, backoff: "linear" },
    auditLevel: AuditLevel.FULL,
    shariaRelevance: false,
  };

  it("produces audit entry on successful tool execution", async () => {
    const executor: ToolExecutor = async () => ({
      success: true,
      data: { result: "ok" },
      metadata: { executionTimeMs: 5, timestamp: new Date().toISOString() },
    });

    registry.register(testManifest, executor);
    await registry.execute("qdb.data.audit_test", { id: "123" }, {
      requestingAgent: "it_operations",
      correlationId: "corr-audit-1",
      sessionId: "sess-1",
      dataClassification: DataClassification.INTERNAL,
    });

    const entries = await auditLogger.query({ correlationId: "corr-audit-1" });
    expect(entries.ok).toBe(true);
    if (entries.ok) {
      expect(entries.value.length).toBeGreaterThanOrEqual(1);
      const toolEntry = entries.value.find((e) => e.action === "tool_invocation");
      expect(toolEntry).toBeDefined();
      expect(toolEntry!.outcome).toBe("SUCCESS");
      expect(toolEntry!.toolId).toBe("qdb.data.audit_test");
      expect(toolEntry!.agentId).toBe("it_operations");
    }
  });

  it("produces audit entry on unauthorized access attempt", async () => {
    const executor: ToolExecutor = async () => ({
      success: true,
      data: {},
      metadata: { executionTimeMs: 5, timestamp: new Date().toISOString() },
    });

    registry.register(testManifest, executor);
    await registry.execute("qdb.data.audit_test", { id: "123" }, {
      requestingAgent: "unauthorized_agent",
      correlationId: "corr-audit-2",
      sessionId: "sess-1",
      dataClassification: DataClassification.INTERNAL,
    });

    const entries = await auditLogger.query({ correlationId: "corr-audit-2" });
    expect(entries.ok).toBe(true);
    if (entries.ok) {
      expect(entries.value.length).toBeGreaterThanOrEqual(1);
      const deniedEntry = entries.value.find((e) => e.outcome === "DENIED");
      expect(deniedEntry).toBeDefined();
    }
  });

  it("produces audit entry on input validation failure", async () => {
    const executor: ToolExecutor = async () => ({
      success: true,
      data: {},
      metadata: { executionTimeMs: 5, timestamp: new Date().toISOString() },
    });

    registry.register(testManifest, executor);
    await registry.execute("qdb.data.audit_test", {}, {
      requestingAgent: "it_operations",
      correlationId: "corr-audit-3",
      sessionId: "sess-1",
      dataClassification: DataClassification.INTERNAL,
    });

    const entries = await auditLogger.query({ correlationId: "corr-audit-3" });
    expect(entries.ok).toBe(true);
    if (entries.ok) {
      const deniedEntry = entries.value.find((e) => e.outcome === "DENIED");
      expect(deniedEntry).toBeDefined();
    }
  });

  it("produces audit entry on tool execution failure", async () => {
    const failingExecutor: ToolExecutor = async () => {
      throw new Error("Backend connection failed");
    };

    registry.register(testManifest, failingExecutor);
    await registry.execute("qdb.data.audit_test", { id: "123" }, {
      requestingAgent: "it_operations",
      correlationId: "corr-audit-4",
      sessionId: "sess-1",
      dataClassification: DataClassification.INTERNAL,
    });

    const entries = await auditLogger.query({ correlationId: "corr-audit-4" });
    expect(entries.ok).toBe(true);
    if (entries.ok) {
      const failEntry = entries.value.find((e) => e.outcome === "FAILURE");
      expect(failEntry).toBeDefined();
    }
  });

  it("every code path produces audit with required fields", async () => {
    const executor: ToolExecutor = async () => ({
      success: true,
      data: {},
      metadata: { executionTimeMs: 5, timestamp: new Date().toISOString() },
    });

    registry.register(testManifest, executor);
    await registry.execute("qdb.data.audit_test", { id: "123" }, {
      requestingAgent: "it_operations",
      correlationId: "corr-fields",
      sessionId: "sess-1",
      userId: "user-1",
      dataClassification: DataClassification.INTERNAL,
    });

    const entries = await auditLogger.query({ correlationId: "corr-fields" });
    expect(entries.ok).toBe(true);
    if (entries.ok) {
      for (const entry of entries.value) {
        // Required audit fields per governance rule #1
        expect(entry.timestamp).toBeDefined();
        expect(entry.agentId).toBeDefined();
        expect(entry.action).toBeDefined();
        expect(entry.dataClassification).toBeDefined();
        expect(entry.correlationId).toBeDefined();
        expect(entry.outcome).toBeDefined();
      }
    }
  });
});
