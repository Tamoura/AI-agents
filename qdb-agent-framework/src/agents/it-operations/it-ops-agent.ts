/**
 * IT Operations Agent — Handles IT infrastructure monitoring, incident triage,
 * DR playbook retrieval, and service health queries.
 */

import {
  type AgentPolicy,
  type AgentResponse,
  type AgentSession,
  type MessageEnvelope,
} from "../../core/types.js";
import { BaseAgent, type AgentDependencies } from "../../core/agent-runtime.js";

export class ITOpsAgent extends BaseAgent {
  readonly agentId = "it_operations";
  readonly policy: AgentPolicy;

  constructor(deps: AgentDependencies, policy: AgentPolicy) {
    super(deps);
    this.policy = policy;
  }

  async handleMessage(
    envelope: MessageEnvelope,
    session: AgentSession,
  ): Promise<AgentResponse> {
    const intent = (envelope.payload.classification as { intent?: string })?.intent ?? "unknown";
    const originalMessage = (envelope.payload.originalMessage as string) ?? "";
    const toolsInvoked: string[] = [];
    const auditTrail: string[] = [];

    try {
      switch (intent) {
        case "incident_report":
          return await this.handleIncident(envelope, session, originalMessage, toolsInvoked, auditTrail);

        case "dr_inquiry":
          return await this.handleDRInquiry(envelope, session, originalMessage, toolsInvoked, auditTrail);

        case "service_health":
          return await this.handleServiceHealth(envelope, session, toolsInvoked, auditTrail);

        default:
          return await this.handleGeneral(envelope, session, originalMessage, toolsInvoked, auditTrail);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `IT Operations error: ${message}`,
        toolsInvoked,
        escalated: false,
        auditTrail: [...auditTrail, `Error: ${message}`],
      };
    }
  }

  private async handleIncident(
    envelope: MessageEnvelope,
    session: AgentSession,
    message: string,
    toolsInvoked: string[],
    auditTrail: string[],
  ): Promise<AgentResponse> {
    // Determine severity from message content
    const severity = this.classifySeverity(message);
    auditTrail.push(`Incident severity classified: ${severity}`);

    // Check if P1 — requires escalation
    if (severity === "P1") {
      await this.escalateToHuman(
        "P1 incident reported — immediate human intervention required",
        { incident_severity: "P1", message },
        envelope,
      );

      // Still create a ticket
      const ticketResult = await this.invokeTool(
        "qdb.action.create_ticket",
        {
          title: `[P1] ${message.slice(0, 150)}`,
          description: message,
          priority: "CRITICAL",
          category: "incident",
          assigned_team: "IT Infrastructure",
        },
        envelope.correlationId,
        session.sessionId,
        envelope.metadata.userId,
      );

      if (ticketResult.ok) {
        toolsInvoked.push("qdb.action.create_ticket");
        const ticketData = ticketResult.value.data as { ticketId?: string };
        auditTrail.push(`P1 ticket created: ${ticketData?.ticketId ?? "unknown"}`);
      }

      // Notify
      const notifResult = await this.invokeTool(
        "qdb.action.send_notification",
        {
          channel: "teams",
          recipients: ["it_manager", "cio"],
          subject: `[P1 INCIDENT] ${message.slice(0, 100)}`,
          body: `A P1 incident has been reported and requires immediate attention.\n\n${message}`,
          priority: "HIGH",
        },
        envelope.correlationId,
        session.sessionId,
        envelope.metadata.userId,
      );

      if (notifResult.ok) {
        toolsInvoked.push("qdb.action.send_notification");
      }

      return {
        success: true,
        message: `This has been classified as a P1 (Critical) incident. A ticket has been created and the IT Manager and CIO have been notified for immediate response. The incident has been escalated for human intervention.`,
        data: ticketResult.ok ? ticketResult.value.data : undefined,
        toolsInvoked,
        escalated: true,
        auditTrail,
      };
    }

    // Non-P1: create ticket and return
    const ticketResult = await this.invokeTool(
      "qdb.action.create_ticket",
      {
        title: `[${severity}] ${message.slice(0, 150)}`,
        description: message,
        priority: severity === "P2" ? "HIGH" : severity === "P3" ? "MEDIUM" : "LOW",
        category: "incident",
        assigned_team: "IT Infrastructure",
      },
      envelope.correlationId,
      session.sessionId,
      envelope.metadata.userId,
    );

    if (ticketResult.ok) {
      toolsInvoked.push("qdb.action.create_ticket");
    }

    const ticketData = ticketResult.ok ? (ticketResult.value.data as { ticketId?: string }) : null;

    return {
      success: true,
      message: `Incident classified as ${severity}. Ticket ${ticketData?.ticketId ?? "created"} has been opened and assigned to IT Infrastructure team.`,
      data: ticketResult.ok ? ticketResult.value.data : undefined,
      toolsInvoked,
      escalated: false,
      auditTrail,
    };
  }

  private async handleDRInquiry(
    envelope: MessageEnvelope,
    session: AgentSession,
    message: string,
    toolsInvoked: string[],
    auditTrail: string[],
  ): Promise<AgentResponse> {
    // Search ECM for DR playbooks
    const searchResult = await this.invokeTool(
      "qdb.data.search_ecm",
      {
        query: "disaster recovery",
        document_type: "playbook",
        department: "IT",
        max_results: 5,
      },
      envelope.correlationId,
      session.sessionId,
      envelope.metadata.userId,
    );

    if (!searchResult.ok) {
      return {
        success: false,
        message: `Unable to search for DR playbooks: ${searchResult.error.message}`,
        toolsInvoked,
        escalated: false,
        auditTrail: [...auditTrail, "ECM search failed"],
      };
    }

    toolsInvoked.push("qdb.data.search_ecm");
    const results = (searchResult.value.data as { results?: unknown[] })?.results ?? [];
    auditTrail.push(`Found ${results.length} DR playbooks`);

    // Check if DR activation is requested
    if (message.toLowerCase().includes("activate") || message.toLowerCase().includes("initiate dr")) {
      await this.escalateToHuman(
        "DR activation requested — requires CIO and COO approval",
        { dr_activation_requested: "true" },
        envelope,
      );

      return {
        success: true,
        message: `DR activation request has been escalated to the IT Manager, CIO, and COO for approval. This action requires explicit authorization before proceeding. In the meantime, here are the relevant DR playbooks found.`,
        data: { playbooks: results },
        toolsInvoked,
        escalated: true,
        auditTrail: [...auditTrail, "DR activation escalated"],
      };
    }

    return {
      success: true,
      message: `Found ${results.length} disaster recovery playbook(s). Please review the relevant playbook for your scenario.`,
      data: { playbooks: results },
      toolsInvoked,
      escalated: false,
      auditTrail,
    };
  }

  private async handleServiceHealth(
    envelope: MessageEnvelope,
    session: AgentSession,
    toolsInvoked: string[],
    auditTrail: string[],
  ): Promise<AgentResponse> {
    // Query Power BI for IT services dashboard
    const dashResult = await this.invokeTool(
      "qdb.data.query_power_bi",
      {
        dashboard_id: "it_services",
        date_range: "last_7d",
      },
      envelope.correlationId,
      session.sessionId,
      envelope.metadata.userId,
    );

    if (!dashResult.ok) {
      return {
        success: false,
        message: `Unable to retrieve service health data: ${dashResult.error.message}`,
        toolsInvoked,
        escalated: false,
        auditTrail: [...auditTrail, "Power BI query failed"],
      };
    }

    toolsInvoked.push("qdb.data.query_power_bi");
    const data = dashResult.value.data as Record<string, unknown>;
    auditTrail.push("Service health data retrieved from Power BI");

    const downSvcs = data.downSvcs as number ?? 0;
    const degradedSvcs = data.degradedSvcs as number ?? 0;
    const totalServices = data.totalServices as number ?? 0;
    const healthySvcs = data.healthySvcs as number ?? 0;

    let summary = `Infrastructure Status Summary:\n`;
    summary += `- Total Services: ${totalServices}\n`;
    summary += `- Healthy: ${healthySvcs}\n`;
    summary += `- Degraded: ${degradedSvcs}\n`;
    summary += `- Down: ${downSvcs}\n`;
    summary += `- 99-day Average Uptime: ${data.avgUptime99d ?? "N/A"}%`;

    if (downSvcs > 0) {
      summary += `\n\nATTENTION: ${downSvcs} service(s) currently DOWN. Immediate investigation recommended.`;
    }

    return {
      success: true,
      message: summary,
      data,
      toolsInvoked,
      escalated: false,
      auditTrail,
    };
  }

  private async handleGeneral(
    envelope: MessageEnvelope,
    session: AgentSession,
    message: string,
    toolsInvoked: string[],
    auditTrail: string[],
  ): Promise<AgentResponse> {
    auditTrail.push("General IT query — searching ECM for relevant documents");

    const searchResult = await this.invokeTool(
      "qdb.data.search_ecm",
      {
        query: message.slice(0, 100),
        max_results: 5,
      },
      envelope.correlationId,
      session.sessionId,
      envelope.metadata.userId,
    );

    if (searchResult.ok) {
      toolsInvoked.push("qdb.data.search_ecm");
      const results = (searchResult.value.data as { results?: unknown[] })?.results ?? [];
      return {
        success: true,
        message: `I found ${results.length} potentially relevant document(s) for your IT query.`,
        data: searchResult.value.data,
        toolsInvoked,
        escalated: false,
        auditTrail,
      };
    }

    return {
      success: true,
      message: "I've received your IT query. Could you provide more details so I can assist you better? I can help with incident management, service health monitoring, and DR playbook retrieval.",
      toolsInvoked,
      escalated: false,
      auditTrail,
    };
  }

  private classifySeverity(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes("critical") || lower.includes("complete outage") || lower.includes("all users affected")) {
      return "P1";
    }
    if (lower.includes("major") || lower.includes("significant") || lower.includes("many users")) {
      return "P2";
    }
    if (lower.includes("minor") || lower.includes("some users") || lower.includes("degraded")) {
      return "P3";
    }
    return "P4";
  }
}
