import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { AuditLogger } from "../../src/core/audit-logger.js";
import { DataClassification, AutonomyLevel } from "../../src/core/types.js";

const TEST_DB_DIR = join(process.cwd(), "tests", ".tmp");
const TEST_DB_PATH = join(TEST_DB_DIR, "test-audit.db");

describe("AuditLogger", () => {
  let logger: AuditLogger;

  beforeEach(() => {
    if (!existsSync(TEST_DB_DIR)) mkdirSync(TEST_DB_DIR, { recursive: true });
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
    logger = new AuditLogger(TEST_DB_PATH);
  });

  afterEach(() => {
    logger.close();
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  });

  it("logs an audit entry successfully", async () => {
    const result = await logger.log({
      entryId: "entry-001",
      timestamp: new Date().toISOString(),
      correlationId: "corr-001",
      agentId: "it_operations",
      userId: "user-1",
      action: "tool_invocation",
      toolId: "qdb.data.query_power_bi",
      inputSummary: "Query dashboard",
      outputSummary: "Success",
      dataClassification: DataClassification.INTERNAL,
      autonomyLevel: AutonomyLevel.AUTONOMOUS,
      outcome: "SUCCESS",
      durationMs: 150,
    });

    expect(result.ok).toBe(true);
  });

  it("persists and returns versions in force (policyVersion + modelId)", async () => {
    await logger.log({
      entryId: "entry-ver",
      timestamp: new Date().toISOString(),
      correlationId: "corr-ver",
      agentId: "it_operations",
      action: "tool_invocation",
      inputSummary: "x",
      outputSummary: "y",
      dataClassification: DataClassification.INTERNAL,
      autonomyLevel: AutonomyLevel.AUTONOMOUS,
      outcome: "SUCCESS",
      policyVersion: "1.2.0",
      modelId: "claude-fable-5",
    });

    const result = await logger.getByCorrelationId("corr-ver");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0].policyVersion).toBe("1.2.0");
      expect(result.value[0].modelId).toBe("claude-fable-5");
    }
  });

  it("migrates a pre-existing DB that lacks the version columns", async () => {
    // Simulate an old DB: drop the new columns by recreating the legacy schema, then reopen.
    logger.close();
    const Database = (await import("better-sqlite3")).default;
    const raw = new Database(TEST_DB_PATH);
    raw.exec("DROP TABLE IF EXISTS audit_log");
    raw.exec(`CREATE TABLE audit_log (
      entry_id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, correlation_id TEXT NOT NULL,
      agent_id TEXT NOT NULL, user_id TEXT, action TEXT NOT NULL, tool_id TEXT,
      input_summary TEXT NOT NULL, output_summary TEXT NOT NULL, data_classification TEXT NOT NULL,
      autonomy_level TEXT NOT NULL, outcome TEXT NOT NULL, duration_ms INTEGER, metadata TEXT)`);
    raw.close();

    // Reopening must add the missing columns without error, and new writes must carry versions.
    const migrated = new AuditLogger(TEST_DB_PATH);
    const write = await migrated.log({
      entryId: "e-mig", timestamp: new Date().toISOString(), correlationId: "c-mig",
      agentId: "pmo_delivery", action: "agent_action", inputSummary: "a", outputSummary: "b",
      dataClassification: DataClassification.INTERNAL, autonomyLevel: AutonomyLevel.NOTIFY,
      outcome: "SUCCESS", policyVersion: "2.0.0",
    });
    expect(write.ok).toBe(true);
    const read = await migrated.getByCorrelationId("c-mig");
    expect(read.ok && read.value[0].policyVersion).toBe("2.0.0");
    migrated.close();
  });

  it("queries entries by agentId", async () => {
    await logger.log({
      entryId: "entry-001",
      timestamp: new Date().toISOString(),
      correlationId: "corr-001",
      agentId: "it_operations",
      action: "test",
      inputSummary: "input",
      outputSummary: "output",
      dataClassification: DataClassification.INTERNAL,
      autonomyLevel: AutonomyLevel.AUTONOMOUS,
      outcome: "SUCCESS",
    });

    await logger.log({
      entryId: "entry-002",
      timestamp: new Date().toISOString(),
      correlationId: "corr-002",
      agentId: "pmo",
      action: "test",
      inputSummary: "input",
      outputSummary: "output",
      dataClassification: DataClassification.INTERNAL,
      autonomyLevel: AutonomyLevel.AUTONOMOUS,
      outcome: "SUCCESS",
    });

    const result = await logger.query({ agentId: "it_operations" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.agentId).toBe("it_operations");
    }
  });

  it("queries by correlationId", async () => {
    await logger.log({
      entryId: "entry-001",
      timestamp: new Date().toISOString(),
      correlationId: "corr-shared",
      agentId: "router",
      action: "classify",
      inputSummary: "input",
      outputSummary: "output",
      dataClassification: DataClassification.INTERNAL,
      autonomyLevel: AutonomyLevel.AUTONOMOUS,
      outcome: "SUCCESS",
    });

    await logger.log({
      entryId: "entry-002",
      timestamp: new Date().toISOString(),
      correlationId: "corr-shared",
      agentId: "it_operations",
      action: "process",
      inputSummary: "input",
      outputSummary: "output",
      dataClassification: DataClassification.INTERNAL,
      autonomyLevel: AutonomyLevel.AUTONOMOUS,
      outcome: "SUCCESS",
    });

    const result = await logger.getByCorrelationId("corr-shared");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }
  });

  it("redacts RESTRICTED data in summaries", async () => {
    await logger.log({
      entryId: "entry-restricted",
      timestamp: new Date().toISOString(),
      correlationId: "corr-001",
      agentId: "credit_assessment",
      action: "access_restricted",
      inputSummary: "Sensitive customer data request",
      outputSummary: "Full customer record returned",
      dataClassification: DataClassification.RESTRICTED,
      autonomyLevel: AutonomyLevel.APPROVE,
      outcome: "SUCCESS",
    });

    const result = await logger.query({ agentId: "credit_assessment" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]!.inputSummary).toContain("REDACTED");
      expect(result.value[0]!.outputSummary).toContain("REDACTED");
    }
  });
});
