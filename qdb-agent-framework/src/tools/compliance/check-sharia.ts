/**
 * Sharia Compliance Check — Validates financing products against Sharia principles.
 * V1: Rule-based mock.
 */

import { type ToolManifest, type ToolExecutor, DataClassification, OperationType, AuditLevel } from "../../core/types.js";

export const manifest: ToolManifest = {
  toolId: "qdb.compliance.check_sharia",
  displayName: "Sharia Compliance Check",
  description: "Validates a financing product or transaction against Sharia compliance rules.",
  version: "1.0.0",
  ownerTeam: "Sharia Compliance Team",
  inputSchema: {
    type: "object",
    properties: {
      product_type: { type: "string", enum: ["murabaha", "ijara", "musharaka", "sukuk", "wakala"] },
      facility_amount: { type: "number", minimum: 0 },
      profit_rate: { type: "number", minimum: 0 },
      sector: { type: "string" },
      purpose: { type: "string" },
    },
    required: ["product_type", "facility_amount"],
  },
  outputSchema: {
    type: "object",
    properties: {
      compliant: { type: "boolean" },
      findings: { type: "array" },
      recommendation: { type: "string" },
    },
  },
  dataClassification: DataClassification.CONFIDENTIAL,
  operationType: OperationType.READ,
  authorizedAgents: ["credit_assessment", "regulatory_compliance"],
  requiresApproval: false,
  rateLimit: { maxPerMinute: 20 },
  timeoutMs: 15000,
  retryPolicy: { maxRetries: 2, backoff: "linear" },
  auditLevel: AuditLevel.FULL,
  shariaRelevance: true,
};

const PROHIBITED_SECTORS = ["gambling", "alcohol", "tobacco", "conventional_banking", "pork"];

export const execute: ToolExecutor = async (params, _context) => {
  const productType = params.product_type as string;
  const facilityAmount = params.facility_amount as number;
  const sector = (params.sector as string | undefined) ?? "";
  const findings: string[] = [];
  let compliant = true;

  // Check prohibited sectors
  if (PROHIBITED_SECTORS.some((s) => sector.toLowerCase().includes(s))) {
    compliant = false;
    findings.push(`Sector "${sector}" is not Sharia-compliant (prohibited industry).`);
  }

  // Product-specific checks
  if (productType === "murabaha") {
    if (!params.purpose) {
      findings.push("Murabaha requires a stated purpose (underlying asset/commodity).");
    }
    if (facilityAmount > 100_000_000) {
      findings.push("Large Murabaha (>100M QAR) requires Sharia board review.");
    }
  }

  if (productType === "ijara") {
    if (!params.purpose) {
      findings.push("Ijara requires specification of the leased asset.");
    }
  }

  // Profit rate reasonableness
  const profitRate = params.profit_rate as number | undefined;
  if (profitRate !== undefined && profitRate > 12) {
    findings.push(`Profit rate ${profitRate}% is unusually high; requires Sharia board review.`);
  }

  const recommendation = compliant
    ? "Product structure is Sharia-compliant. Proceed with standard documentation."
    : "Product structure requires modification to achieve Sharia compliance. Refer to Sharia Supervisory Board.";

  return {
    success: true,
    data: { compliant, findings, recommendation, productType, facilityAmount },
    metadata: { executionTimeMs: 60, source: "mock-sharia-engine", timestamp: new Date().toISOString() },
  };
};
