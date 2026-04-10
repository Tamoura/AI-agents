/**
 * Escalation — Human-in-the-loop escalation framework.
 * Determines when actions require human approval and manages the approval queue.
 */

import { v4 as uuidv4 } from "uuid";
import {
  type AgentPolicy,
  type ApprovalRequest,
  type MessageEnvelope,
  type Result,
  type IAuditLogger,
  AutonomyLevel,
  DataClassification,
  OperationType,
  EscalationAction,
  Ok,
  Err,
  ErrorCodes,
  DATA_CLASSIFICATION_RANK,
  AUTONOMY_LEVEL_RANK,
} from "../core/types.js";

export interface EscalationDecision {
  requiresEscalation: boolean;
  autonomyLevel: AutonomyLevel;
  reason: string;
  notifyRoles: string[];
  escalationAction: EscalationAction;
}

export class EscalationManager {
  private readonly pendingApprovals = new Map<string, ApprovalRequest>();
  private readonly auditLogger: IAuditLogger;
  private readonly defaultApprovalTimeoutMs: number;

  constructor(auditLogger: IAuditLogger, defaultApprovalTimeoutMs: number = 3600_000) {
    this.auditLogger = auditLogger;
    this.defaultApprovalTimeoutMs = defaultApprovalTimeoutMs;
  }

  /**
   * Evaluate whether an action requires escalation based on agent policy,
   * data classification, and operation type.
   */
  evaluate(
    policy: AgentPolicy,
    _toolId: string,
    operationType: OperationType,
    dataClassification: DataClassification,
    context: Record<string, unknown>,
  ): EscalationDecision {
    // Rule: MUTATE on CONFIDENTIAL+ ALWAYS requires approval
    if (
      operationType === OperationType.MUTATE &&
      DATA_CLASSIFICATION_RANK[dataClassification] >=
        DATA_CLASSIFICATION_RANK[DataClassification.CONFIDENTIAL]
    ) {
      return {
        requiresEscalation: true,
        autonomyLevel: AutonomyLevel.APPROVE,
        reason: `MUTATE operation on ${dataClassification} data requires human approval`,
        notifyRoles: this.findNotifyRoles(policy, context),
        escalationAction: EscalationAction.REQUIRE_APPROVAL,
      };
    }

    // Check policy overrides
    let effectiveLevel = policy.autonomy.defaultLevel;
    for (const override of policy.autonomy.overrides) {
      if (this.evaluateCondition(override.condition, context)) {
        if (AUTONOMY_LEVEL_RANK[override.level] > AUTONOMY_LEVEL_RANK[effectiveLevel]) {
          effectiveLevel = override.level;
        }
      }
    }

    // Check escalation rules
    for (const rule of policy.escalation.rules) {
      if (this.evaluateCondition(rule.trigger, context)) {
        const requiresEscalation =
          rule.action === EscalationAction.ESCALATE_TO_HUMAN ||
          rule.action === EscalationAction.REQUIRE_APPROVAL ||
          rule.action === EscalationAction.BLOCK;

        return {
          requiresEscalation,
          autonomyLevel: requiresEscalation
            ? AutonomyLevel.APPROVE
            : effectiveLevel,
          reason: `Escalation rule triggered: ${rule.trigger}`,
          notifyRoles: [...rule.notify],
          escalationAction: rule.action,
        };
      }
    }

    // Default: check if the effective autonomy level requires escalation
    const requiresEscalation =
      AUTONOMY_LEVEL_RANK[effectiveLevel] >= AUTONOMY_LEVEL_RANK[AutonomyLevel.APPROVE];

    return {
      requiresEscalation,
      autonomyLevel: effectiveLevel,
      reason: requiresEscalation
        ? `Autonomy level ${effectiveLevel} requires approval`
        : "Action within autonomous bounds",
      notifyRoles: requiresEscalation ? this.findNotifyRoles(policy, context) : [],
      escalationAction: requiresEscalation
        ? EscalationAction.REQUIRE_APPROVAL
        : EscalationAction.NOTIFY_ONLY,
    };
  }

  /**
   * Create a pending approval request.
   */
  async createApprovalRequest(
    agentId: string,
    toolId: string,
    action: string,
    reason: string,
    payload: Record<string, unknown>,
    requiredApprovers: string[],
    envelope: MessageEnvelope,
  ): Promise<Result<ApprovalRequest>> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.defaultApprovalTimeoutMs);

    const request: ApprovalRequest = {
      requestId: uuidv4(),
      correlationId: envelope.correlationId,
      agentId,
      toolId,
      action,
      reason,
      payload,
      requiredApprovers,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: "PENDING",
    };

    this.pendingApprovals.set(request.requestId, request);

    await this.auditLogger.log({
      entryId: uuidv4(),
      timestamp: now.toISOString(),
      correlationId: envelope.correlationId,
      agentId,
      userId: envelope.metadata.userId,
      action: "approval_requested",
      toolId,
      inputSummary: reason,
      outputSummary: `Approval requested from: ${requiredApprovers.join(", ")}`,
      dataClassification: envelope.dataClassification,
      autonomyLevel: AutonomyLevel.APPROVE,
      outcome: "ESCALATED",
    });

    return Ok(request);
  }

  /**
   * Resolve a pending approval (approve or reject).
   */
  async resolveApproval(
    requestId: string,
    approved: boolean,
    resolvedBy: string,
  ): Promise<Result<ApprovalRequest>> {
    const request = this.pendingApprovals.get(requestId);
    if (!request) {
      return Err({
        code: ErrorCodes.AGENT_NOT_FOUND,
        message: `Approval request "${requestId}" not found.`,
      });
    }

    // Check expiry
    if (new Date(request.expiresAt) < new Date()) {
      const expired: ApprovalRequest = { ...request, status: "EXPIRED" };
      this.pendingApprovals.set(requestId, expired);
      return Err({
        code: ErrorCodes.APPROVAL_TIMEOUT,
        message: `Approval request "${requestId}" has expired.`,
      });
    }

    const resolved: ApprovalRequest = {
      ...request,
      status: approved ? "APPROVED" : "REJECTED",
      resolvedBy,
      resolvedAt: new Date().toISOString(),
    };

    this.pendingApprovals.set(requestId, resolved);

    await this.auditLogger.log({
      entryId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: request.correlationId,
      agentId: request.agentId,
      action: approved ? "approval_granted" : "approval_rejected",
      toolId: request.toolId,
      inputSummary: `Approval request ${requestId}`,
      outputSummary: `${approved ? "Approved" : "Rejected"} by ${resolvedBy}`,
      dataClassification: DataClassification.INTERNAL,
      autonomyLevel: AutonomyLevel.APPROVE,
      outcome: approved ? "SUCCESS" : "DENIED",
    });

    if (!approved) {
      return Err({
        code: ErrorCodes.APPROVAL_REJECTED,
        message: `Approval request "${requestId}" was rejected by ${resolvedBy}.`,
      });
    }

    return Ok(resolved);
  }

  getPendingApprovals(agentId?: string): ApprovalRequest[] {
    const all = Array.from(this.pendingApprovals.values()).filter(
      (r) => r.status === "PENDING",
    );
    if (agentId) return all.filter((r) => r.agentId === agentId);
    return all;
  }

  cleanExpiredApprovals(): number {
    const now = new Date();
    let cleaned = 0;

    for (const [id, request] of this.pendingApprovals) {
      if (request.status === "PENDING" && new Date(request.expiresAt) < now) {
        this.pendingApprovals.set(id, { ...request, status: "EXPIRED" });
        cleaned++;
      }
    }

    return cleaned;
  }

  private evaluateCondition(
    condition: string,
    context: Record<string, unknown>,
  ): boolean {
    const match = condition.match(/^(\w+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
    if (!match) return false;

    const [, field, operator, rawValue] = match;
    if (!field || !operator || !rawValue) return false;

    const contextValue = context[field];
    if (contextValue === undefined) return false;

    const value = rawValue.trim();
    const contextStr = String(contextValue);

    switch (operator) {
      case "==": return contextStr === value;
      case "!=": return contextStr !== value;
      case ">=": return contextStr >= value;
      case "<=": return contextStr <= value;
      case ">": return contextStr > value;
      case "<": return contextStr < value;
      default: return false;
    }
  }

  private findNotifyRoles(
    policy: AgentPolicy,
    context: Record<string, unknown>,
  ): string[] {
    const roles = new Set<string>();

    for (const rule of policy.escalation.rules) {
      if (this.evaluateCondition(rule.trigger, context)) {
        for (const role of rule.notify) {
          roles.add(role);
        }
      }
    }

    return Array.from(roles);
  }
}
