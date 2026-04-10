/**
 * Core Banking System Query — Retrieves account, loan, facility, and customer records.
 * V1: Mock data with realistic QDB shapes.
 */

import { type ToolManifest, type ToolExecutor, DataClassification, OperationType, AuditLevel } from "../../core/types.js";

export const manifest: ToolManifest = {
  toolId: "qdb.data.query_core_banking",
  displayName: "Core Banking System Query",
  description: "Retrieves account, loan, facility, and customer records from QDB's core banking system.",
  version: "1.0.0",
  ownerTeam: "Applications Team",
  inputSchema: {
    type: "object",
    properties: {
      query_type: { type: "string", enum: ["account", "facility", "customer", "loan"] },
      entity_id: { type: "string" },
      fields: { type: "array", items: { type: "string" } },
    },
    required: ["query_type", "entity_id"],
  },
  outputSchema: {
    type: "object",
    properties: {
      data: { type: "object" },
      timestamp: { type: "string" },
      source: { type: "string" },
    },
  },
  dataClassification: DataClassification.CONFIDENTIAL,
  operationType: OperationType.READ,
  authorizedAgents: ["credit_assessment", "customer_lifecycle", "portfolio_monitoring", "regulatory_compliance"],
  requiresApproval: false,
  rateLimit: { maxPerMinute: 60 },
  timeoutMs: 30000,
  retryPolicy: { maxRetries: 3, backoff: "exponential" },
  auditLevel: AuditLevel.FULL,
  shariaRelevance: false,
};

const MOCK_DATA: Record<string, Record<string, Record<string, unknown>>> = {
  account: {
    "ACC-001": {
      accountId: "ACC-001",
      accountType: "Corporate Current",
      currency: "QAR",
      balance: 15_250_000,
      status: "ACTIVE",
      openDate: "2020-03-15",
      branch: "QDB HQ",
      customerId: "CUST-001",
    },
    "ACC-002": {
      accountId: "ACC-002",
      accountType: "SME Savings",
      currency: "QAR",
      balance: 2_340_000,
      status: "ACTIVE",
      openDate: "2021-07-22",
      branch: "QBIC",
      customerId: "CUST-002",
    },
  },
  facility: {
    "FAC-001": {
      facilityId: "FAC-001",
      facilityType: "Murabaha",
      facilityAmount: 50_000_000,
      outstandingAmount: 35_000_000,
      profitRate: 4.5,
      tenor: 60,
      startDate: "2022-01-15",
      maturityDate: "2027-01-15",
      status: "ACTIVE",
      customerId: "CUST-001",
      collateralValue: 75_000_000,
      riskRating: "MEDIUM",
    },
    "FAC-002": {
      facilityId: "FAC-002",
      facilityType: "Ijara",
      facilityAmount: 10_000_000,
      outstandingAmount: 8_500_000,
      profitRate: 5.0,
      tenor: 36,
      startDate: "2023-06-01",
      maturityDate: "2026-06-01",
      status: "ACTIVE",
      customerId: "CUST-002",
      collateralValue: 15_000_000,
      riskRating: "LOW",
    },
  },
  customer: {
    "CUST-001": {
      customerId: "CUST-001",
      customerName: "Al Jazeera Industries WLL",
      customerType: "Corporate",
      nationalId: "QID-2847501234",
      registrationNumber: "CR-98765",
      sector: "Manufacturing",
      totalExposure: 35_000_000,
      riskRating: "MEDIUM",
      kycStatus: "VERIFIED",
      lastReviewDate: "2024-12-01",
    },
    "CUST-002": {
      customerId: "CUST-002",
      customerName: "Doha Tech Solutions",
      customerType: "SME",
      nationalId: "QID-1923847561",
      registrationNumber: "CR-45678",
      sector: "Technology",
      totalExposure: 8_500_000,
      riskRating: "LOW",
      kycStatus: "VERIFIED",
      lastReviewDate: "2025-01-15",
    },
  },
  loan: {
    "LOAN-001": {
      loanId: "LOAN-001",
      loanType: "Term Loan",
      principalAmount: 25_000_000,
      outstandingBalance: 18_750_000,
      interestRate: 4.25,
      tenor: 48,
      status: "PERFORMING",
      customerId: "CUST-001",
      facilityId: "FAC-001",
      nextPaymentDate: "2025-04-15",
      daysPastDue: 0,
    },
  },
};

export const execute: ToolExecutor = async (params, _context) => {
  const queryType = params.query_type as string;
  const entityId = params.entity_id as string;

  const collection = MOCK_DATA[queryType];
  if (!collection) {
    return {
      success: false,
      error: `Unknown query type: ${queryType}`,
      metadata: { executionTimeMs: 5, source: "mock-cbs", timestamp: new Date().toISOString() },
    };
  }

  const entity = collection[entityId];
  if (!entity) {
    return {
      success: false,
      error: `Entity not found: ${queryType}/${entityId}`,
      metadata: { executionTimeMs: 12, source: "mock-cbs", timestamp: new Date().toISOString() },
    };
  }

  // Field filtering
  const fields = params.fields as string[] | undefined;
  const data = fields
    ? Object.fromEntries(Object.entries(entity).filter(([k]) => fields.includes(k)))
    : entity;

  return {
    success: true,
    data: { ...data },
    metadata: { executionTimeMs: 45, source: "mock-cbs", timestamp: new Date().toISOString() },
  };
};
