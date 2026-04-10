/**
 * Power BI Query — Retrieves dashboard data and project metrics.
 * V1: Mock data with realistic QDB PMO shapes.
 */

import { type ToolManifest, type ToolExecutor, DataClassification, OperationType, AuditLevel } from "../../core/types.js";

export const manifest: ToolManifest = {
  toolId: "qdb.data.query_power_bi",
  displayName: "Power BI Dashboard Query",
  description: "Retrieves project dashboards, KPI metrics, and portfolio analytics from Power BI.",
  version: "1.0.0",
  ownerTeam: "BI Team",
  inputSchema: {
    type: "object",
    properties: {
      dashboard_id: { type: "string", enum: ["pmo_overview", "portfolio_health", "it_services", "credit_pipeline"] },
      filters: { type: "object" },
      date_range: { type: "string", enum: ["last_7d", "last_30d", "last_90d", "ytd"] },
    },
    required: ["dashboard_id"],
  },
  outputSchema: {
    type: "object",
    properties: {
      data: { type: "object" },
      refreshedAt: { type: "string" },
      source: { type: "string" },
    },
  },
  dataClassification: DataClassification.INTERNAL,
  operationType: OperationType.READ,
  authorizedAgents: ["pmo", "credit_assessment", "portfolio_monitoring", "it_operations"],
  requiresApproval: false,
  rateLimit: { maxPerMinute: 30 },
  timeoutMs: 15000,
  retryPolicy: { maxRetries: 2, backoff: "linear" },
  auditLevel: AuditLevel.STANDARD,
  shariaRelevance: false,
};

const MOCK_DASHBOARDS: Record<string, Record<string, unknown>> = {
  pmo_overview: {
    totalProjects: 24,
    activeProjects: 18,
    completedProjects: 4,
    onHold: 2,
    statusBreakdown: {
      green: 12,
      amber: 4,
      red: 2,
    },
    budgetUtilization: 67.3,
    topRisks: [
      { project: "Core Banking Modernization", risk: "Vendor delay", severity: "HIGH" },
      { project: "PDPPL Compliance", risk: "Resource gap", severity: "MEDIUM" },
    ],
    upcomingMilestones: [
      { project: "Azure Migration Phase 2", milestone: "DR Testing", dueDate: "2025-04-30" },
      { project: "Customer Portal v2", milestone: "UAT Complete", dueDate: "2025-05-15" },
    ],
  },
  portfolio_health: {
    totalExposure: 2_850_000_000,
    performingLoans: 2_565_000_000,
    watchList: 171_000_000,
    npl: 114_000_000,
    nplRatio: 4.0,
    sectorConcentration: {
      manufacturing: 28.5,
      realEstate: 22.1,
      services: 18.7,
      technology: 15.2,
      other: 15.5,
    },
    provisionCoverage: 85.2,
  },
  it_services: {
    totalServices: 47,
    healthySvcs: 43,
    degradedSvcs: 3,
    downSvcs: 1,
    avgUptime99d: 99.7,
    openIncidents: { P1: 0, P2: 2, P3: 7, P4: 12 },
    recentChanges: [
      { changeId: "CHG-2025-0142", description: "Firewall rule update", status: "COMPLETED" },
      { changeId: "CHG-2025-0143", description: "Database patching", status: "SCHEDULED" },
    ],
  },
  credit_pipeline: {
    pipelineTotal: 450_000_000,
    applicationsInProgress: 12,
    pendingApproval: 5,
    approvedNotDisbursed: 3,
    averageProcessingDays: 14,
    approvalRate: 72.5,
  },
};

export const execute: ToolExecutor = async (params, _context) => {
  const dashboardId = params.dashboard_id as string;
  const data = MOCK_DASHBOARDS[dashboardId];

  if (!data) {
    return {
      success: false,
      error: `Dashboard not found: ${dashboardId}`,
      metadata: { executionTimeMs: 8, source: "mock-powerbi", timestamp: new Date().toISOString() },
    };
  }

  return {
    success: true,
    data: { ...data, dateRange: (params.date_range as string) ?? "last_30d" },
    metadata: { executionTimeMs: 120, source: "mock-powerbi", timestamp: new Date().toISOString() },
  };
};
