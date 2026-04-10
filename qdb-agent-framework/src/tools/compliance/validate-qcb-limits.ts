/**
 * QCB Limits Validation — Validates against Qatar Central Bank prudential limits.
 * V1: Rule-based mock with realistic QCB thresholds.
 */

import { type ToolManifest, type ToolExecutor, DataClassification, OperationType, AuditLevel } from "../../core/types.js";

export const manifest: ToolManifest = {
  toolId: "qdb.compliance.validate_qcb_limits",
  displayName: "QCB Prudential Limits Validation",
  description: "Validates a facility or exposure against Qatar Central Bank prudential limits and concentration rules.",
  version: "1.0.0",
  ownerTeam: "Regulatory Compliance Team",
  inputSchema: {
    type: "object",
    properties: {
      check_type: { type: "string", enum: ["single_borrower", "sector_concentration", "related_party", "large_exposure"] },
      entity_id: { type: "string" },
      proposed_amount: { type: "number", minimum: 0 },
      sector: { type: "string" },
      current_exposure: { type: "number" },
    },
    required: ["check_type", "entity_id"],
  },
  outputSchema: {
    type: "object",
    properties: {
      withinLimits: { type: "boolean" },
      findings: { type: "array" },
      currentUtilization: { type: "number" },
      maxAllowed: { type: "number" },
    },
  },
  dataClassification: DataClassification.CONFIDENTIAL,
  operationType: OperationType.READ,
  authorizedAgents: ["credit_assessment", "portfolio_monitoring", "regulatory_compliance"],
  requiresApproval: false,
  rateLimit: { maxPerMinute: 30 },
  timeoutMs: 15000,
  retryPolicy: { maxRetries: 2, backoff: "linear" },
  auditLevel: AuditLevel.FULL,
  shariaRelevance: false,
};

// Mock QCB limits (based on typical central bank prudential norms)
const QCB_LIMITS = {
  singleBorrowerMaxPct: 20, // % of bank's capital
  sectorConcentrationMaxPct: 30,
  relatedPartyMaxPct: 10,
  largeExposureThresholdPct: 10,
  bankCapital: 5_000_000_000, // 5 billion QAR (mock)
};

export const execute: ToolExecutor = async (params, _context) => {
  const checkType = params.check_type as string;
  const proposedAmount = (params.proposed_amount as number | undefined) ?? 0;
  const currentExposure = (params.current_exposure as number | undefined) ?? 0;
  const totalExposure = currentExposure + proposedAmount;
  const findings: string[] = [];
  let withinLimits = true;
  let maxAllowed = 0;

  switch (checkType) {
    case "single_borrower": {
      maxAllowed = (QCB_LIMITS.singleBorrowerMaxPct / 100) * QCB_LIMITS.bankCapital;
      if (totalExposure > maxAllowed) {
        withinLimits = false;
        findings.push(
          `Total exposure ${(totalExposure / 1_000_000).toFixed(1)}M QAR exceeds single borrower limit of ${(maxAllowed / 1_000_000).toFixed(1)}M QAR (${QCB_LIMITS.singleBorrowerMaxPct}% of capital).`,
        );
      }
      break;
    }
    case "sector_concentration": {
      maxAllowed = (QCB_LIMITS.sectorConcentrationMaxPct / 100) * QCB_LIMITS.bankCapital;
      if (totalExposure > maxAllowed) {
        withinLimits = false;
        findings.push(
          `Sector exposure ${(totalExposure / 1_000_000).toFixed(1)}M QAR exceeds concentration limit of ${(maxAllowed / 1_000_000).toFixed(1)}M QAR (${QCB_LIMITS.sectorConcentrationMaxPct}% of capital).`,
        );
      }
      break;
    }
    case "related_party": {
      maxAllowed = (QCB_LIMITS.relatedPartyMaxPct / 100) * QCB_LIMITS.bankCapital;
      if (totalExposure > maxAllowed) {
        withinLimits = false;
        findings.push(
          `Related party exposure exceeds QCB limit of ${QCB_LIMITS.relatedPartyMaxPct}% of capital.`,
        );
      }
      break;
    }
    case "large_exposure": {
      maxAllowed = (QCB_LIMITS.largeExposureThresholdPct / 100) * QCB_LIMITS.bankCapital;
      if (totalExposure >= maxAllowed) {
        findings.push(
          `Exposure qualifies as "large exposure" under QCB rules (>=${QCB_LIMITS.largeExposureThresholdPct}% of capital). Enhanced reporting required.`,
        );
      }
      break;
    }
  }

  const utilization = maxAllowed > 0 ? (totalExposure / maxAllowed) * 100 : 0;

  return {
    success: true,
    data: {
      withinLimits,
      findings,
      currentUtilization: Math.round(utilization * 10) / 10,
      maxAllowed,
      totalExposure,
      checkType,
    },
    metadata: { executionTimeMs: 35, source: "mock-qcb-limits", timestamp: new Date().toISOString() },
  };
};
