/**
 * ECM Document Search — Searches the Enterprise Content Management system.
 * V1: Mock data with realistic QDB document metadata.
 */

import { type ToolManifest, type ToolExecutor, DataClassification, OperationType, AuditLevel } from "../../core/types.js";

export const manifest: ToolManifest = {
  toolId: "qdb.data.search_ecm",
  displayName: "ECM Document Search",
  description: "Searches QDB's Enterprise Content Management system for policies, playbooks, and documents.",
  version: "1.0.0",
  ownerTeam: "Applications Team",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      document_type: { type: "string", enum: ["policy", "playbook", "procedure", "template", "report"] },
      department: { type: "string" },
      max_results: { type: "number", minimum: 1, maximum: 50 },
    },
    required: ["query"],
  },
  outputSchema: {
    type: "object",
    properties: {
      results: { type: "array" },
      totalCount: { type: "number" },
    },
  },
  dataClassification: DataClassification.INTERNAL,
  operationType: OperationType.READ,
  authorizedAgents: ["it_operations", "pmo", "credit_assessment", "customer_lifecycle", "document_intelligence", "regulatory_compliance"],
  requiresApproval: false,
  rateLimit: { maxPerMinute: 30 },
  timeoutMs: 10000,
  retryPolicy: { maxRetries: 2, backoff: "linear" },
  auditLevel: AuditLevel.STANDARD,
  shariaRelevance: false,
};

const MOCK_DOCUMENTS = [
  {
    documentId: "DOC-DR-001",
    title: "Disaster Recovery Playbook — Azure Qatar",
    documentType: "playbook",
    department: "IT",
    classification: "INTERNAL",
    lastUpdated: "2025-01-10",
    author: "IT Infrastructure Team",
    summary: "Step-by-step DR activation and failover procedures for Azure Qatar region, covering all 3 AZs.",
    tags: ["disaster-recovery", "azure", "infrastructure", "failover"],
  },
  {
    documentId: "DOC-DR-002",
    title: "DR Playbook — QDC 3 Legacy Systems",
    documentType: "playbook",
    department: "IT",
    classification: "INTERNAL",
    lastUpdated: "2024-11-20",
    author: "IT Infrastructure Team",
    summary: "Recovery procedures for legacy MIS systems in QDC 3 data center. Includes decommissioning timeline.",
    tags: ["disaster-recovery", "legacy", "qdc3", "decommission"],
  },
  {
    documentId: "DOC-POL-001",
    title: "QDB Information Security Policy v4.2",
    documentType: "policy",
    department: "Information Security",
    classification: "INTERNAL",
    lastUpdated: "2025-02-01",
    author: "CISO Office",
    summary: "Comprehensive information security policy aligned with QCB regulations and ISO 27001.",
    tags: ["security", "policy", "qcb", "iso27001"],
  },
  {
    documentId: "DOC-POL-002",
    title: "PDPPL Data Protection Compliance Procedures",
    documentType: "procedure",
    department: "Legal & Compliance",
    classification: "INTERNAL",
    lastUpdated: "2025-03-01",
    author: "Compliance Team",
    summary: "Procedures for handling personal data in compliance with Qatar's PDPPL (Personal Data Protection Privacy Law).",
    tags: ["pdppl", "data-protection", "privacy", "compliance"],
  },
  {
    documentId: "DOC-PROC-001",
    title: "Incident Management Process — ITIL v4",
    documentType: "procedure",
    department: "IT",
    classification: "INTERNAL",
    lastUpdated: "2024-12-15",
    author: "IT Service Management",
    summary: "ITIL-aligned incident management process for QDB IT services, including severity classification and escalation matrices.",
    tags: ["incident", "itil", "service-management", "escalation"],
  },
  {
    documentId: "DOC-PROC-002",
    title: "Credit Assessment Methodology",
    documentType: "procedure",
    department: "Credit Risk",
    classification: "CONFIDENTIAL",
    lastUpdated: "2025-01-20",
    author: "Credit Risk Team",
    summary: "Standard methodology for credit risk assessment including scoring models and facility limits.",
    tags: ["credit", "risk", "assessment", "methodology"],
  },
  {
    documentId: "DOC-TPL-001",
    title: "Project Status Report Template",
    documentType: "template",
    department: "PMO",
    classification: "INTERNAL",
    lastUpdated: "2024-10-01",
    author: "PMO Team",
    summary: "Standard template for weekly project status reporting.",
    tags: ["template", "pmo", "status-report"],
  },
];

export const execute: ToolExecutor = async (params, _context) => {
  const query = (params.query as string).toLowerCase();
  const docType = params.document_type as string | undefined;
  const department = params.department as string | undefined;
  const maxResults = (params.max_results as number | undefined) ?? 10;

  let results = MOCK_DOCUMENTS.filter((doc) => {
    const matchesQuery =
      doc.title.toLowerCase().includes(query) ||
      doc.summary.toLowerCase().includes(query) ||
      doc.tags.some((t) => t.includes(query));

    const matchesType = !docType || doc.documentType === docType;
    const matchesDept = !department || doc.department.toLowerCase().includes(department.toLowerCase());

    return matchesQuery && matchesType && matchesDept;
  });

  results = results.slice(0, maxResults);

  return {
    success: true,
    data: { results, totalCount: results.length },
    metadata: { executionTimeMs: 85, source: "mock-ecm", timestamp: new Date().toISOString() },
  };
};
