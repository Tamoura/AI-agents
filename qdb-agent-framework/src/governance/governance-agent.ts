/**
 * Governance Agent — Central policy enforcement.
 * Ties together data classification, policy engine, and escalation.
 * Acts as a gatekeeper for all tool invocations and cross-agent data flows.
 */

import { v4 as uuidv4 } from "uuid";
import {
  type MessageEnvelope,
  type ToolManifest,
  type IAuditLogger,
  type Result,
  DataClassification,
  AutonomyLevel,
  Ok,
  Err,
  ErrorCodes,
  DATA_CLASSIFICATION_RANK,
} from "../core/types.js";
import { DataClassifier } from "./data-classifier.js";
import { PolicyEngine } from "./policy-engine.js";
import { EscalationManager, type EscalationDecision } from "./escalation.js";

export interface GovernanceDecision {
  allowed: boolean;
  reason: string;
  escalation?: EscalationDecision;
  dataClassification: DataClassification;
  requiresApproval: boolean;
}

export class GovernanceAgent {
  private readonly dataClassifier: DataClassifier;
  private readonly policyEngine: PolicyEngine;
  private readonly escalationManager: EscalationManager;
  private readonly auditLogger: IAuditLogger;

  constructor(
    policyEngine: PolicyEngine,
    auditLogger: IAuditLogger,
    escalationManager?: EscalationManager,
  ) {
    this.dataClassifier = new DataClassifier();
    this.policyEngine = policyEngine;
    this.auditLogger = auditLogger;
    this.escalationManager =
      escalationManager ?? new EscalationManager(auditLogger);
  }

  /**
   * Authorize a tool invocation by an agent.
   * Checks: policy, data classification, escalation requirements.
   */
  async authorizeToolInvocation(
    agentId: string,
    toolManifest: ToolManifest,
    params: Record<string, unknown>,
    envelope: MessageEnvelope,
  ): Promise<Result<GovernanceDecision>> {
    const startTime = Date.now();

    // 1. Check agent has a loaded policy
    const policy = this.policyEngine.getPolicy(agentId);
    if (!policy) {
      const decision = this.deny(`No policy loaded for agent "${agentId}"`);
      await this.logDecision(agentId, toolManifest.toolId, decision, envelope, startTime);
      return Ok(decision);
    }

    // 2. Check tool is in allowed list and not in denied list
    const toolAccess = this.policyEngine.validateToolAccess(agentId, toolManifest.toolId);
    if (!toolAccess.ok) {
      const decision = this.deny(toolAccess.error.message);
      await this.logDecision(agentId, toolManifest.toolId, decision, envelope, startTime);
      return Ok(decision);
    }

    // 3. Check data classification compatibility
    const payloadClassification = this.dataClassifier.classifyPayload(params);
    const agentMaxRank = DATA_CLASSIFICATION_RANK[policy.dataBoundaries.maxClassification];
    const toolDataRank = DATA_CLASSIFICATION_RANK[toolManifest.dataClassification];

    if (toolDataRank > agentMaxRank) {
      const decision = this.deny(
        `Tool "${toolManifest.toolId}" data classification (${toolManifest.dataClassification}) exceeds agent's maximum (${policy.dataBoundaries.maxClassification})`,
      );
      await this.logDecision(agentId, toolManifest.toolId, decision, envelope, startTime);
      return Ok(decision);
    }

    // 4. Check tool authorization list
    if (!toolManifest.authorizedAgents.includes(agentId)) {
      const decision = this.deny(
        `Agent "${agentId}" is not in tool "${toolManifest.toolId}" authorized agents list`,
      );
      await this.logDecision(agentId, toolManifest.toolId, decision, envelope, startTime);
      return Ok(decision);
    }

    // 5. Evaluate escalation requirements
    const escalation = this.escalationManager.evaluate(
      policy,
      toolManifest.toolId,
      toolManifest.operationType,
      toolManifest.dataClassification,
      {
        operation_type: toolManifest.operationType,
        data_classification: toolManifest.dataClassification,
        ...envelope.payload,
      },
    );

    const decision: GovernanceDecision = {
      allowed: true,
      reason: "Tool invocation authorized",
      escalation,
      dataClassification: payloadClassification.overallClassification,
      requiresApproval: escalation.requiresEscalation,
    };

    await this.logDecision(agentId, toolManifest.toolId, decision, envelope, startTime);
    return Ok(decision);
  }

  /**
   * Authorize a cross-agent data transfer.
   * Enforces: data classification downgrading when crossing agent boundaries.
   */
  async authorizeDataTransfer(
    sourceAgentId: string,
    targetAgentId: string,
    dataClassification: DataClassification,
    _envelope: MessageEnvelope,
  ): Promise<Result<GovernanceDecision>> {
    const sourcePolicy = this.policyEngine.getPolicy(sourceAgentId);
    const targetPolicy = this.policyEngine.getPolicy(targetAgentId);

    if (!sourcePolicy || !targetPolicy) {
      return Ok(
        this.deny(
          `Missing policy for ${!sourcePolicy ? sourceAgentId : targetAgentId}`,
        ),
      );
    }

    const transferResult = this.dataClassifier.validateDataTransfer(
      sourcePolicy.dataBoundaries.maxClassification,
      targetPolicy.dataBoundaries.maxClassification,
      dataClassification,
    );

    if (!transferResult.ok) {
      return Ok(this.deny(transferResult.error.message));
    }

    return Ok({
      allowed: true,
      reason: "Cross-agent data transfer authorized",
      dataClassification,
      requiresApproval: false,
    });
  }

  /**
   * Mask response data for cross-agent transfer based on target agent's classification.
   */
  maskResponseData(
    data: Record<string, unknown>,
    targetAgentId: string,
  ): Record<string, unknown> {
    const targetPolicy = this.policyEngine.getPolicy(targetAgentId);
    if (!targetPolicy) return data;

    return this.dataClassifier.maskFields(
      data,
      targetPolicy.dataBoundaries.maxClassification,
      targetPolicy.dataBoundaries.piiHandling,
    );
  }

  /**
   * Validate that the Router Agent is not directly invoking business tools.
   * Separation of duties: Router may only delegate.
   */
  validateSeparationOfDuties(
    agentId: string,
    action: string,
  ): Result<void> {
    const policy = this.policyEngine.getPolicy(agentId);
    if (!policy) return Ok(undefined);

    if (
      policy.scope.domains.includes("routing") &&
      action !== "delegate" &&
      action !== "classify_intent" &&
      !action.startsWith("router.")
    ) {
      return Err({
        code: ErrorCodes.GOVERNANCE_DENIED,
        message: `Router agent "${agentId}" cannot directly invoke business tools. Use delegation instead.`,
      });
    }

    return Ok(undefined);
  }

  get escalation(): EscalationManager {
    return this.escalationManager;
  }

  get classifier(): DataClassifier {
    return this.dataClassifier;
  }

  get policies(): PolicyEngine {
    return this.policyEngine;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private deny(reason: string): GovernanceDecision {
    return {
      allowed: false,
      reason,
      dataClassification: DataClassification.PUBLIC,
      requiresApproval: false,
    };
  }

  private async logDecision(
    agentId: string,
    toolId: string,
    decision: GovernanceDecision,
    envelope: MessageEnvelope,
    startTime: number,
  ): Promise<void> {
    await this.auditLogger.log({
      entryId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: envelope.correlationId,
      agentId: "governance",
      userId: envelope.metadata.userId,
      action: "governance_decision",
      toolId,
      inputSummary: `Agent "${agentId}" requesting tool "${toolId}"`,
      outputSummary: `${decision.allowed ? "ALLOWED" : "DENIED"}: ${decision.reason}`,
      dataClassification: envelope.dataClassification,
      autonomyLevel: decision.escalation?.autonomyLevel ?? AutonomyLevel.AUTONOMOUS,
      outcome: decision.allowed ? "SUCCESS" : "DENIED",
      durationMs: Date.now() - startTime,
    });
  }
}
