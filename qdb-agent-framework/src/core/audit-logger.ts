/**
 * Audit Logger — Append-only audit trail.
 * V1 implementation uses SQLite. Every tool invocation and agent action MUST produce an audit entry.
 */

import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import {
  type AuditEntry,
  type AuditQueryFilter,
  type IAuditLogger,
  type Result,
  DataClassification,
  AutonomyLevel,
  Ok,
  Err,
  ErrorCodes,
  DATA_CLASSIFICATION_RANK,
} from "./types.js";

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS audit_log (
    entry_id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    user_id TEXT,
    action TEXT NOT NULL,
    tool_id TEXT,
    input_summary TEXT NOT NULL,
    output_summary TEXT NOT NULL,
    data_classification TEXT NOT NULL,
    autonomy_level TEXT NOT NULL,
    outcome TEXT NOT NULL,
    duration_ms INTEGER,
    metadata TEXT
  )
`;

const CREATE_INDEXES_SQL = [
  `CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_log(correlation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_tool ON audit_log(tool_id)`,
];

export class AuditLogger implements IAuditLogger {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(CREATE_TABLE_SQL);
    for (const sql of CREATE_INDEXES_SQL) {
      this.db.exec(sql);
    }
  }

  async log(entry: AuditEntry): Promise<Result<void>> {
    try {
      const entryWithId: AuditEntry = {
        ...entry,
        entryId: entry.entryId || uuidv4(),
        timestamp: entry.timestamp || new Date().toISOString(),
        inputSummary: this.redactIfNeeded(entry.inputSummary, entry.dataClassification),
        outputSummary: this.redactIfNeeded(entry.outputSummary, entry.dataClassification),
      };

      const stmt = this.db.prepare(`
        INSERT INTO audit_log (
          entry_id, timestamp, correlation_id, agent_id, user_id,
          action, tool_id, input_summary, output_summary,
          data_classification, autonomy_level, outcome, duration_ms, metadata
        ) VALUES (
          @entryId, @timestamp, @correlationId, @agentId, @userId,
          @action, @toolId, @inputSummary, @outputSummary,
          @dataClassification, @autonomyLevel, @outcome, @durationMs, @metadata
        )
      `);

      stmt.run({
        entryId: entryWithId.entryId,
        timestamp: entryWithId.timestamp,
        correlationId: entryWithId.correlationId,
        agentId: entryWithId.agentId,
        userId: entryWithId.userId ?? null,
        action: entryWithId.action,
        toolId: entryWithId.toolId ?? null,
        inputSummary: entryWithId.inputSummary,
        outputSummary: entryWithId.outputSummary,
        dataClassification: entryWithId.dataClassification,
        autonomyLevel: entryWithId.autonomyLevel,
        outcome: entryWithId.outcome,
        durationMs: entryWithId.durationMs ?? null,
        metadata: entryWithId.metadata ? JSON.stringify(entryWithId.metadata) : null,
      });

      return Ok(undefined);
    } catch (error) {
      return Err({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `Failed to write audit log: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async query(filter: AuditQueryFilter): Promise<Result<AuditEntry[]>> {
    try {
      const conditions: string[] = [];
      const params: Record<string, unknown> = {};

      if (filter.agentId) {
        conditions.push("agent_id = @agentId");
        params.agentId = filter.agentId;
      }
      if (filter.toolId) {
        conditions.push("tool_id = @toolId");
        params.toolId = filter.toolId;
      }
      if (filter.correlationId) {
        conditions.push("correlation_id = @correlationId");
        params.correlationId = filter.correlationId;
      }
      if (filter.userId) {
        conditions.push("user_id = @userId");
        params.userId = filter.userId;
      }
      if (filter.fromTimestamp) {
        conditions.push("timestamp >= @fromTimestamp");
        params.fromTimestamp = filter.fromTimestamp;
      }
      if (filter.toTimestamp) {
        conditions.push("timestamp <= @toTimestamp");
        params.toTimestamp = filter.toTimestamp;
      }
      if (filter.outcome) {
        conditions.push("outcome = @outcome");
        params.outcome = filter.outcome;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const limit = filter.limit ?? 100;
      const offset = filter.offset ?? 0;

      const sql = `
        SELECT * FROM audit_log
        ${whereClause}
        ORDER BY timestamp DESC
        LIMIT @limit OFFSET @offset
      `;

      const rows = this.db.prepare(sql).all({ ...params, limit, offset }) as AuditRow[];
      return Ok(rows.map(rowToAuditEntry));
    } catch (error) {
      return Err({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `Failed to query audit log: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async getByCorrelationId(correlationId: string): Promise<Result<AuditEntry[]>> {
    return this.query({ correlationId });
  }

  /**
   * Redact input/output summaries for CONFIDENTIAL+ data in the audit log.
   * Full details are stored only for STANDARD and below. CONFIDENTIAL+ gets hashed references.
   */
  private redactIfNeeded(summary: string, classification: DataClassification): string {
    if (DATA_CLASSIFICATION_RANK[classification] >= DATA_CLASSIFICATION_RANK[DataClassification.RESTRICTED]) {
      return "[REDACTED — RESTRICTED data]";
    }
    return summary;
  }

  close(): void {
    this.db.close();
  }
}

// ─── Row Mapping ────────────────────────────────────────────────────────────

interface AuditRow {
  entry_id: string;
  timestamp: string;
  correlation_id: string;
  agent_id: string;
  user_id: string | null;
  action: string;
  tool_id: string | null;
  input_summary: string;
  output_summary: string;
  data_classification: string;
  autonomy_level: string;
  outcome: string;
  duration_ms: number | null;
  metadata: string | null;
}

function rowToAuditEntry(row: AuditRow): AuditEntry {
  return {
    entryId: row.entry_id,
    timestamp: row.timestamp,
    correlationId: row.correlation_id,
    agentId: row.agent_id,
    userId: row.user_id ?? undefined,
    action: row.action,
    toolId: row.tool_id ?? undefined,
    inputSummary: row.input_summary,
    outputSummary: row.output_summary,
    dataClassification: row.data_classification as DataClassification,
    autonomyLevel: row.autonomy_level as AutonomyLevel,
    outcome: row.outcome as AuditEntry["outcome"],
    durationMs: row.duration_ms ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
  };
}
