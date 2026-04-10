/**
 * State Store — Agent session state management (SQLite v1).
 * Tracks agent sessions, conversation history, and state data.
 * Production: swap for Azure Cosmos DB adapter.
 */

import Database from "better-sqlite3";
import {
  type AgentSession,
  type IStateStore,
  type Result,
  type LLMMessage,
  AgentStatus,
  Ok,
  Err,
  ErrorCodes,
} from "./types.js";

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS agent_sessions (
    session_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    user_id TEXT,
    started_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT '{}',
    messages TEXT NOT NULL DEFAULT '[]'
  )
`;

const CREATE_INDEXES_SQL = [
  `CREATE INDEX IF NOT EXISTS idx_sessions_agent ON agent_sessions(agent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_status ON agent_sessions(status)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON agent_sessions(expires_at)`,
];

export class SQLiteStateStore implements IStateStore {
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

  async createSession(session: AgentSession): Promise<Result<void>> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO agent_sessions (session_id, agent_id, user_id, started_at, expires_at, status, state, messages)
        VALUES (@sessionId, @agentId, @userId, @startedAt, @expiresAt, @status, @state, @messages)
      `);

      stmt.run({
        sessionId: session.sessionId,
        agentId: session.agentId,
        userId: session.userId ?? null,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        status: session.status,
        state: JSON.stringify(session.state),
        messages: JSON.stringify(session.messages),
      });

      return Ok(undefined);
    } catch (error) {
      return Err({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `Failed to create session: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async getSession(sessionId: string): Promise<Result<AgentSession | null>> {
    try {
      const row = this.db
        .prepare("SELECT * FROM agent_sessions WHERE session_id = ?")
        .get(sessionId) as SessionRow | undefined;

      if (!row) return Ok(null);

      return Ok(rowToSession(row));
    } catch (error) {
      return Err({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `Failed to get session: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async updateSession(
    sessionId: string,
    updates: Partial<Pick<AgentSession, "status" | "state" | "messages">>,
  ): Promise<Result<void>> {
    try {
      const setClauses: string[] = [];
      const params: Record<string, unknown> = { sessionId };

      if (updates.status !== undefined) {
        setClauses.push("status = @status");
        params.status = updates.status;
      }
      if (updates.state !== undefined) {
        setClauses.push("state = @state");
        params.state = JSON.stringify(updates.state);
      }
      if (updates.messages !== undefined) {
        setClauses.push("messages = @messages");
        params.messages = JSON.stringify(updates.messages);
      }

      if (setClauses.length === 0) return Ok(undefined);

      const sql = `UPDATE agent_sessions SET ${setClauses.join(", ")} WHERE session_id = @sessionId`;
      const result = this.db.prepare(sql).run(params);

      if (result.changes === 0) {
        return Err({
          code: ErrorCodes.AGENT_NOT_FOUND,
          message: `Session "${sessionId}" not found.`,
        });
      }

      return Ok(undefined);
    } catch (error) {
      return Err({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `Failed to update session: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async deleteSession(sessionId: string): Promise<Result<void>> {
    try {
      this.db.prepare("DELETE FROM agent_sessions WHERE session_id = ?").run(sessionId);
      return Ok(undefined);
    } catch (error) {
      return Err({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `Failed to delete session: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async getActiveSessions(agentId: string): Promise<Result<AgentSession[]>> {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM agent_sessions WHERE agent_id = ? AND status NOT IN (?, ?)`,
        )
        .all(agentId, AgentStatus.TERMINATED, AgentStatus.ERROR) as SessionRow[];

      return Ok(rows.map(rowToSession));
    } catch (error) {
      return Err({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `Failed to get active sessions: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async cleanExpiredSessions(): Promise<Result<number>> {
    try {
      const now = new Date().toISOString();
      const result = this.db
        .prepare("DELETE FROM agent_sessions WHERE expires_at < ?")
        .run(now);

      return Ok(result.changes);
    } catch (error) {
      return Err({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `Failed to clean expired sessions: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  close(): void {
    this.db.close();
  }
}

// ─── Row Mapping ────────────────────────────────────────────────────────────

interface SessionRow {
  session_id: string;
  agent_id: string;
  user_id: string | null;
  started_at: string;
  expires_at: string;
  status: string;
  state: string;
  messages: string;
}

function rowToSession(row: SessionRow): AgentSession {
  return {
    sessionId: row.session_id,
    agentId: row.agent_id,
    userId: row.user_id ?? undefined,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    status: row.status as AgentStatus,
    state: JSON.parse(row.state) as Record<string, unknown>,
    messages: JSON.parse(row.messages) as LLMMessage[],
  };
}
