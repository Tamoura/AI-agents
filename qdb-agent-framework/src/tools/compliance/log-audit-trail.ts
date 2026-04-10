/**
 * Audit Trail Logger Tool — Writes to the real audit logger.
 * Allows agents to explicitly log business actions to the audit trail.
 */

import { v4 as uuidv4 } from "uuid";
import {
  type ToolManifest,
  type ToolExecutor,
  type IAuditLogger,
  DataClassification,
  OperationType,
  AutonomyLevel,
  AuditLevel,
} from "../../core/types.js";

export const manifest: ToolManifest = {
  toolId: "qdb.compliance.log_audit_trail",
  displayName: "Log Audit Trail Entry",
  description: "Logs an explicit audit trail entry for business actions and compliance events.",
  version: "1.0.0",
  ownerTeam: "Compliance Team",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", minLength: 1 },
      description: { type: "string", minLength: 1 },
      data_classification: { type: "string", enum: ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] },
      related_entity_id: { type: "string" },
      related_entity_type: { type: "string" },
    },
    required: ["action", "description"],
  },
  outputSchema: {
    type: "object",
    properties: {
      entryId: { type: "string" },
      logged: { type: "boolean" },
    },
  },
  dataClassification: DataClassification.INTERNAL,
  operationType: OperationType.MUTATE,
  authorizedAgents: [
    "router", "it_operations", "pmo", "credit_assessment",
    "customer_lifecycle", "document_intelligence", "portfolio_monitoring",
    "regulatory_compliance",
  ],
  requiresApproval: false,
  rateLimit: { maxPerMinute: 100 },
  timeoutMs: 5000,
  retryPolicy: { maxRetries: 3, backoff: "exponential" },
  auditLevel: AuditLevel.MINIMAL,
  shariaRelevance: false,
};

/**
 * Creates an executor bound to a specific audit logger instance.
 */
export function createExecutor(auditLogger: IAuditLogger): ToolExecutor {
  return async (params, context) => {
    const entryId = uuidv4();

    const result = await auditLogger.log({
      entryId,
      timestamp: new Date().toISOString(),
      correlationId: context.correlationId,
      agentId: context.requestingAgent,
      userId: context.userId,
      action: params.action as string,
      inputSummary: params.description as string,
      outputSummary: params.related_entity_id
        ? `Entity: ${params.related_entity_type ?? "unknown"}/${params.related_entity_id as string}`
        : "Manual audit entry",
      dataClassification: (params.data_classification as DataClassification) ?? DataClassification.INTERNAL,
      autonomyLevel: AutonomyLevel.AUTONOMOUS,
      outcome: "SUCCESS",
    });

    if (!result.ok) {
      return {
        success: false,
        error: result.error.message,
        metadata: { executionTimeMs: 5, source: "audit-logger", timestamp: new Date().toISOString() },
      };
    }

    return {
      success: true,
      data: { entryId, logged: true },
      metadata: { executionTimeMs: 10, source: "audit-logger", timestamp: new Date().toISOString() },
    };
  };
}

// Default executor (no-op for when audit logger isn't injected)
export const execute: ToolExecutor = async (_params, _context) => {
  return {
    success: false,
    error: "Audit logger not initialized. Use createExecutor() with an IAuditLogger instance.",
    metadata: { executionTimeMs: 0, source: "audit-logger", timestamp: new Date().toISOString() },
  };
};
