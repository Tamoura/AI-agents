/**
 * Create Ticket — Creates a service desk ticket.
 * V1: Mock with in-memory ticket store.
 */

import { type ToolManifest, type ToolExecutor, DataClassification, OperationType, AuditLevel } from "../../core/types.js";

export const manifest: ToolManifest = {
  toolId: "qdb.action.create_ticket",
  displayName: "Create Service Desk Ticket",
  description: "Creates a new ticket in the QDB service desk system (ServiceNow mock).",
  version: "1.0.0",
  ownerTeam: "IT Service Management",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", minLength: 5, maxLength: 200 },
      description: { type: "string", minLength: 10 },
      priority: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
      category: { type: "string", enum: ["incident", "service_request", "change_request", "problem"] },
      assigned_team: { type: "string" },
      requester: { type: "string" },
    },
    required: ["title", "description", "priority", "category"],
  },
  outputSchema: {
    type: "object",
    properties: {
      ticketId: { type: "string" },
      status: { type: "string" },
      createdAt: { type: "string" },
    },
  },
  dataClassification: DataClassification.INTERNAL,
  operationType: OperationType.MUTATE,
  authorizedAgents: ["it_operations", "pmo"],
  requiresApproval: false,
  rateLimit: { maxPerMinute: 10 },
  timeoutMs: 10000,
  retryPolicy: { maxRetries: 2, backoff: "exponential" },
  auditLevel: AuditLevel.FULL,
  shariaRelevance: false,
};

let ticketCounter = 1000;

export const execute: ToolExecutor = async (params, context) => {
  ticketCounter++;
  const ticketId = `TKT-2025-${String(ticketCounter).padStart(4, "0")}`;

  const ticket = {
    ticketId,
    title: params.title as string,
    description: params.description as string,
    priority: params.priority as string,
    category: params.category as string,
    assignedTeam: (params.assigned_team as string) ?? "Unassigned",
    requester: (params.requester as string) ?? context.requestingAgent,
    status: "OPEN",
    createdAt: new Date().toISOString(),
    createdBy: context.requestingAgent,
  };

  return {
    success: true,
    data: ticket,
    metadata: { executionTimeMs: 30, source: "mock-servicenow", timestamp: new Date().toISOString() },
  };
};
