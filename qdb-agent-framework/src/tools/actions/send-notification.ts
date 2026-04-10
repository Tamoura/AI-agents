/**
 * Send Notification — Sends notifications via email/Teams/SMS.
 * V1: Mock with log output.
 */

import { type ToolManifest, type ToolExecutor, DataClassification, OperationType, AuditLevel } from "../../core/types.js";

export const manifest: ToolManifest = {
  toolId: "qdb.action.send_notification",
  displayName: "Send Notification",
  description: "Sends a notification via email, Microsoft Teams, or SMS to specified recipients.",
  version: "1.0.0",
  ownerTeam: "Applications Team",
  inputSchema: {
    type: "object",
    properties: {
      channel: { type: "string", enum: ["email", "teams", "sms"] },
      recipients: { type: "array", items: { type: "string" } },
      subject: { type: "string", minLength: 1, maxLength: 200 },
      body: { type: "string", minLength: 1 },
      priority: { type: "string", enum: ["HIGH", "NORMAL", "LOW"] },
    },
    required: ["channel", "recipients", "subject", "body"],
  },
  outputSchema: {
    type: "object",
    properties: {
      notificationId: { type: "string" },
      deliveryStatus: { type: "string" },
      sentAt: { type: "string" },
    },
  },
  dataClassification: DataClassification.INTERNAL,
  operationType: OperationType.MUTATE,
  authorizedAgents: ["it_operations", "pmo", "customer_lifecycle"],
  requiresApproval: false,
  rateLimit: { maxPerMinute: 20 },
  timeoutMs: 10000,
  retryPolicy: { maxRetries: 3, backoff: "exponential" },
  auditLevel: AuditLevel.STANDARD,
  shariaRelevance: false,
};

let notifCounter = 0;

export const execute: ToolExecutor = async (params, _context) => {
  notifCounter++;
  const notificationId = `NOTIF-${String(notifCounter).padStart(6, "0")}`;

  return {
    success: true,
    data: {
      notificationId,
      channel: params.channel as string,
      recipients: params.recipients as string[],
      subject: params.subject as string,
      deliveryStatus: "SENT",
      sentAt: new Date().toISOString(),
    },
    metadata: { executionTimeMs: 150, source: "mock-notification", timestamp: new Date().toISOString() },
  };
};
