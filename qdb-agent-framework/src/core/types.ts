/**
 * QDB Agent Framework — Shared types, enums, and interfaces.
 * All core abstractions used across the framework are defined here.
 */

import { z } from "zod";

// ─── Enums ──────────────────────────────────────────────────────────────────

export enum DataClassification {
  PUBLIC = "PUBLIC",
  INTERNAL = "INTERNAL",
  CONFIDENTIAL = "CONFIDENTIAL",
  RESTRICTED = "RESTRICTED",
}

export const DATA_CLASSIFICATION_RANK: Record<DataClassification, number> = {
  [DataClassification.PUBLIC]: 0,
  [DataClassification.INTERNAL]: 1,
  [DataClassification.CONFIDENTIAL]: 2,
  [DataClassification.RESTRICTED]: 3,
};

export enum AutonomyLevel {
  AUTONOMOUS = "L0_AUTONOMOUS",
  NOTIFY = "L1_NOTIFY",
  APPROVE = "L2_APPROVE",
  MANUAL = "L3_MANUAL",
}

export const AUTONOMY_LEVEL_RANK: Record<AutonomyLevel, number> = {
  [AutonomyLevel.AUTONOMOUS]: 0,
  [AutonomyLevel.NOTIFY]: 1,
  [AutonomyLevel.APPROVE]: 2,
  [AutonomyLevel.MANUAL]: 3,
};

export enum OperationType {
  READ = "READ",
  MUTATE = "MUTATE",
}

export enum AuditLevel {
  MINIMAL = "MINIMAL",
  STANDARD = "STANDARD",
  FULL = "FULL",
}

export enum AgentStatus {
  IDLE = "IDLE",
  PROCESSING = "PROCESSING",
  AWAITING_APPROVAL = "AWAITING_APPROVAL",
  ERROR = "ERROR",
  TERMINATED = "TERMINATED",
}

export enum EscalationAction {
  ESCALATE_TO_HUMAN = "escalate_to_human",
  REQUIRE_APPROVAL = "require_approval",
  NOTIFY_ONLY = "notify_only",
  BLOCK = "block",
}

export enum IncidentSeverity {
  P1 = "P1",
  P2 = "P2",
  P3 = "P3",
  P4 = "P4",
}

// ─── Zod Schemas (for runtime validation) ───────────────────────────────────

export const DataClassificationSchema = z.nativeEnum(DataClassification);
export const AutonomyLevelSchema = z.nativeEnum(AutonomyLevel);
export const OperationTypeSchema = z.nativeEnum(OperationType);
export const AuditLevelSchema = z.nativeEnum(AuditLevel);

// ─── Result Pattern ─────────────────────────────────────────────────────────

export type Result<T, E = FrameworkError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ─── Error Types ────────────────────────────────────────────────────────────

export interface FrameworkError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export const ErrorCodes = {
  // Tool errors
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  TOOL_UNAUTHORIZED: "TOOL_UNAUTHORIZED",
  TOOL_VALIDATION_FAILED: "TOOL_VALIDATION_FAILED",
  TOOL_EXECUTION_FAILED: "TOOL_EXECUTION_FAILED",
  TOOL_TIMEOUT: "TOOL_TIMEOUT",
  TOOL_RATE_LIMITED: "TOOL_RATE_LIMITED",

  // Agent errors
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  AGENT_POLICY_VIOLATION: "AGENT_POLICY_VIOLATION",
  AGENT_SESSION_EXPIRED: "AGENT_SESSION_EXPIRED",

  // Governance errors
  GOVERNANCE_DENIED: "GOVERNANCE_DENIED",
  DATA_CLASSIFICATION_VIOLATION: "DATA_CLASSIFICATION_VIOLATION",
  ESCALATION_REQUIRED: "ESCALATION_REQUIRED",
  APPROVAL_TIMEOUT: "APPROVAL_TIMEOUT",
  APPROVAL_REJECTED: "APPROVAL_REJECTED",

  // Message errors
  MESSAGE_EXPIRED: "MESSAGE_EXPIRED",
  MESSAGE_VALIDATION_FAILED: "MESSAGE_VALIDATION_FAILED",
  MESSAGE_DELIVERY_FAILED: "MESSAGE_DELIVERY_FAILED",

  // System errors
  INTERNAL_ERROR: "INTERNAL_ERROR",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
} as const;

// ─── Message Types ──────────────────────────────────────────────────────────

export interface MessageMetadata {
  readonly userId?: string;
  readonly sessionId: string;
  readonly traceId: string;
}

export interface MessageEnvelope {
  readonly messageId: string;
  readonly correlationId: string;
  readonly parentMessageId?: string;
  readonly sourceAgent: string;
  readonly targetAgent: string;
  readonly action: string;
  readonly payload: Record<string, unknown>;
  readonly dataClassification: DataClassification;
  readonly requiresApproval: boolean;
  readonly autonomyLevel: AutonomyLevel;
  readonly timestamp: string;
  readonly ttlSeconds: number;
  readonly metadata: MessageMetadata;
}

// ─── Tool Types ─────────────────────────────────────────────────────────────

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema & { enum?: string[]; items?: JSONSchema }>;
  required?: string[];
  items?: JSONSchema;
  enum?: string[];
  description?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  additionalProperties?: boolean | JSONSchema;
}

export interface RateLimit {
  readonly maxPerMinute: number;
}

export interface RetryPolicy {
  readonly maxRetries: number;
  readonly backoff: "exponential" | "linear";
}

export interface ToolManifest {
  readonly toolId: string;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
  readonly ownerTeam: string;
  readonly inputSchema: JSONSchema;
  readonly outputSchema: JSONSchema;
  readonly dataClassification: DataClassification;
  readonly operationType: OperationType;
  readonly authorizedAgents: readonly string[];
  readonly requiresApproval: boolean;
  readonly rateLimit: RateLimit;
  readonly timeoutMs: number;
  readonly retryPolicy: RetryPolicy;
  readonly auditLevel: AuditLevel;
  readonly shariaRelevance: boolean;
  /** If set, the requesting USER must hold this entitlement (confused-deputy prevention, §3.1). */
  readonly requiredEntitlement?: string;
}

export interface ToolExecutionContext {
  readonly requestingAgent: string;
  readonly correlationId: string;
  readonly sessionId: string;
  readonly userId?: string;
  readonly dataClassification: DataClassification;
  /** Versions in force, propagated so tool-invocation audits are explainable after an upgrade (§9.1). */
  readonly policyVersion?: string;
  readonly modelId?: string;
  /** Entitlements the requesting user holds — checked against a tool's requiredEntitlement. */
  readonly userEntitlements?: readonly string[];
  /** Verified workload-identity token of the calling agent (NHI). */
  readonly agentIdentityToken?: string;
}

export type ToolExecutor = (
  params: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<ToolResult>;

export interface ToolResult {
  readonly success: boolean;
  readonly data?: Record<string, unknown>;
  readonly error?: string;
  readonly metadata?: {
    readonly executionTimeMs: number;
    readonly source?: string;
    readonly timestamp: string;
  };
}

// ─── Agent Types ────────────────────────────────────────────────────────────

export interface AgentResponse {
  readonly success: boolean;
  readonly message: string;
  readonly data?: Record<string, unknown>;
  readonly toolsInvoked: readonly string[];
  readonly escalated: boolean;
  readonly auditTrail: readonly string[];
}

export interface AgentSession {
  readonly sessionId: string;
  readonly agentId: string;
  readonly userId?: string;
  readonly startedAt: string;
  readonly expiresAt: string;
  readonly status: AgentStatus;
  state: Record<string, unknown>;
  messages: LLMMessage[];
}

export interface LLMMessage {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
}

// ─── Policy Types ───────────────────────────────────────────────────────────

export interface AutonomyOverride {
  readonly condition: string;
  readonly level: AutonomyLevel;
}

export interface EscalationRule {
  readonly trigger: string;
  readonly action: EscalationAction;
  readonly notify: readonly string[];
}

export interface DataBoundary {
  readonly maxClassification: DataClassification;
  readonly piiHandling: "MASK" | "REDACT" | "ALLOW";
}

export interface ContextPolicy {
  readonly maxSessionDurationHours: number;
  readonly clearContextOnCompletion: boolean;
  readonly maxContextTokens: number;
}

export interface AgentPolicy {
  readonly agentId: string;
  readonly displayName: string;
  readonly version: string;
  readonly ownerTeam: string;
  readonly scope: {
    readonly description: string;
    readonly domains: readonly string[];
  };
  readonly autonomy: {
    readonly defaultLevel: AutonomyLevel;
    readonly overrides: readonly AutonomyOverride[];
  };
  readonly allowedTools: readonly string[];
  readonly deniedTools: readonly string[];
  readonly dataBoundaries: DataBoundary;
  readonly escalation: {
    readonly rules: readonly EscalationRule[];
  };
  readonly contextPolicy: ContextPolicy;
  readonly systemPrompt: string;
}

// ─── Audit Types ────────────────────────────────────────────────────────────

export interface AuditEntry {
  readonly entryId: string;
  readonly timestamp: string;
  readonly correlationId: string;
  readonly agentId: string;
  readonly userId?: string;
  readonly action: string;
  readonly toolId?: string;
  readonly inputSummary: string;
  readonly outputSummary: string;
  readonly dataClassification: DataClassification;
  readonly autonomyLevel: AutonomyLevel;
  readonly outcome: "SUCCESS" | "FAILURE" | "DENIED" | "ESCALATED";
  readonly durationMs?: number;
  /** Versions in force at decision time — required to explain a historical decision after an upgrade (PRODUCTION-PLAYBOOK §9.1). */
  readonly policyVersion?: string;
  readonly modelId?: string;
  readonly metadata?: Record<string, unknown>;
}

// ─── Approval Types ─────────────────────────────────────────────────────────

export interface ApprovalRequest {
  readonly requestId: string;
  readonly correlationId: string;
  readonly agentId: string;
  readonly toolId: string;
  readonly action: string;
  readonly reason: string;
  readonly payload: Record<string, unknown>;
  readonly requiredApprovers: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  readonly resolvedBy?: string;
  readonly resolvedAt?: string;
}

// ─── Interface Contracts (for adapters) ─────────────────────────────────────

export interface IMessageBus {
  publish(envelope: MessageEnvelope): Promise<Result<void>>;
  subscribe(
    agentId: string,
    handler: (envelope: MessageEnvelope) => Promise<void>,
  ): void;
  unsubscribe(agentId: string): void;
  request(
    envelope: MessageEnvelope,
    timeoutMs: number,
  ): Promise<Result<MessageEnvelope>>;
}

export interface IStateStore {
  createSession(session: AgentSession): Promise<Result<void>>;
  getSession(sessionId: string): Promise<Result<AgentSession | null>>;
  updateSession(
    sessionId: string,
    updates: Partial<Pick<AgentSession, "status" | "state" | "messages">>,
  ): Promise<Result<void>>;
  deleteSession(sessionId: string): Promise<Result<void>>;
  getActiveSessions(agentId: string): Promise<Result<AgentSession[]>>;
  cleanExpiredSessions(): Promise<Result<number>>;
}

export interface IAuditLogger {
  log(entry: AuditEntry): Promise<Result<void>>;
  query(filter: AuditQueryFilter): Promise<Result<AuditEntry[]>>;
  getByCorrelationId(correlationId: string): Promise<Result<AuditEntry[]>>;
}

export interface AuditQueryFilter {
  readonly agentId?: string;
  readonly toolId?: string;
  readonly correlationId?: string;
  readonly userId?: string;
  readonly fromTimestamp?: string;
  readonly toTimestamp?: string;
  readonly outcome?: AuditEntry["outcome"];
  readonly limit?: number;
  readonly offset?: number;
}

export interface IToolRegistry {
  register(manifest: ToolManifest, executor: ToolExecutor): Result<void>;
  unregister(toolId: string): Result<void>;
  getManifest(toolId: string): ToolManifest | undefined;
  getExecutor(toolId: string): ToolExecutor | undefined;
  listTools(filter?: ToolRegistryFilter): ToolManifest[];
  isAuthorized(toolId: string, agentId: string): boolean;
}

export interface ToolRegistryFilter {
  readonly operationType?: OperationType;
  readonly dataClassification?: DataClassification;
  readonly authorizedAgent?: string;
  readonly ownerTeam?: string;
}
