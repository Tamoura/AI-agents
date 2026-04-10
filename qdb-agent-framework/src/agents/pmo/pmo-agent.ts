/**
 * PMO Delivery Agent — Manages project delivery tracking, resource allocation,
 * milestone reporting, and cross-team coordination.
 */

import {
  type AgentPolicy,
  type AgentResponse,
  type AgentSession,
  type MessageEnvelope,
} from "../../core/types.js";
import { BaseAgent, type AgentDependencies } from "../../core/agent-runtime.js";

export class PMOAgent extends BaseAgent {
  readonly agentId = "pmo";
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
        case "project_status":
          return await this.handleProjectStatus(envelope, session, toolsInvoked, auditTrail);

        case "pmo_report":
          return await this.handlePMOReport(envelope, session, toolsInvoked, auditTrail);

        default:
          return await this.handleGeneral(envelope, session, originalMessage, toolsInvoked, auditTrail);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `PMO Agent error: ${message}`,
        toolsInvoked,
        escalated: false,
        auditTrail: [...auditTrail, `Error: ${message}`],
      };
    }
  }

  private async handleProjectStatus(
    envelope: MessageEnvelope,
    session: AgentSession,
    toolsInvoked: string[],
    auditTrail: string[],
  ): Promise<AgentResponse> {
    // Query PMO Overview dashboard
    const dashResult = await this.invokeTool(
      "qdb.data.query_power_bi",
      {
        dashboard_id: "pmo_overview",
        date_range: "last_30d",
      },
      envelope.correlationId,
      session.sessionId,
      envelope.metadata.userId,
    );

    if (!dashResult.ok) {
      return {
        success: false,
        message: `Unable to retrieve project data: ${dashResult.error.message}`,
        toolsInvoked,
        escalated: false,
        auditTrail: [...auditTrail, "Power BI query failed"],
      };
    }

    toolsInvoked.push("qdb.data.query_power_bi");
    const data = dashResult.value.data as Record<string, unknown>;
    auditTrail.push("Project status data retrieved from Power BI");

    const statusBreakdown = data.statusBreakdown as { green?: number; amber?: number; red?: number } | undefined;
    const redCount = statusBreakdown?.red ?? 0;

    let summary = `Project Portfolio Status:\n`;
    summary += `- Total Projects: ${data.totalProjects ?? 0}\n`;
    summary += `- Active: ${data.activeProjects ?? 0}\n`;
    summary += `- Completed: ${data.completedProjects ?? 0}\n`;
    summary += `- On Hold: ${data.onHold ?? 0}\n\n`;
    summary += `RAG Status:\n`;
    summary += `- Green: ${statusBreakdown?.green ?? 0}\n`;
    summary += `- Amber: ${statusBreakdown?.amber ?? 0}\n`;
    summary += `- Red: ${statusBreakdown?.red ?? 0}\n\n`;
    summary += `Budget Utilization: ${data.budgetUtilization ?? "N/A"}%`;

    // Escalate if there are RED projects
    if (redCount > 0) {
      await this.escalateToHuman(
        `${redCount} project(s) in RED status — requires PMO Director attention`,
        { project_status: "RED" },
        envelope,
      );

      summary += `\n\nALERT: ${redCount} project(s) are in RED status and have been escalated to the PMO Director.`;

      // Send notification
      await this.invokeTool(
        "qdb.action.send_notification",
        {
          channel: "teams",
          recipients: ["pmo_director"],
          subject: `[ALERT] ${redCount} Project(s) in RED Status`,
          body: summary,
          priority: "HIGH",
        },
        envelope.correlationId,
        session.sessionId,
        envelope.metadata.userId,
      );
      toolsInvoked.push("qdb.action.send_notification");

      return {
        success: true,
        message: summary,
        data,
        toolsInvoked,
        escalated: true,
        auditTrail: [...auditTrail, `Escalated: ${redCount} RED projects`],
      };
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

  private async handlePMOReport(
    envelope: MessageEnvelope,
    session: AgentSession,
    toolsInvoked: string[],
    auditTrail: string[],
  ): Promise<AgentResponse> {
    // Fetch dashboard data and search for report templates
    const [dashResult, templateResult] = await Promise.all([
      this.invokeTool(
        "qdb.data.query_power_bi",
        { dashboard_id: "pmo_overview", date_range: "last_30d" },
        envelope.correlationId,
        session.sessionId,
        envelope.metadata.userId,
      ),
      this.invokeTool(
        "qdb.data.search_ecm",
        { query: "status report template", document_type: "template", department: "PMO" },
        envelope.correlationId,
        session.sessionId,
        envelope.metadata.userId,
      ),
    ]);

    if (dashResult.ok) toolsInvoked.push("qdb.data.query_power_bi");
    if (templateResult.ok) toolsInvoked.push("qdb.data.search_ecm");

    const dashData = dashResult.ok ? dashResult.value.data : {};
    const templates = templateResult.ok
      ? (templateResult.value.data as { results?: unknown[] })?.results ?? []
      : [];

    auditTrail.push("Report data and templates retrieved");

    return {
      success: true,
      message: `PMO Report data compiled. ${templates.length} report template(s) available. Dashboard data includes project status overview with RAG breakdown, budget utilization, risk register, and upcoming milestones.`,
      data: { dashboard: dashData, templates },
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
    // Search ECM for relevant PMO documents
    const searchResult = await this.invokeTool(
      "qdb.data.search_ecm",
      { query: message.slice(0, 100), max_results: 5 },
      envelope.correlationId,
      session.sessionId,
      envelope.metadata.userId,
    );

    if (searchResult.ok) {
      toolsInvoked.push("qdb.data.search_ecm");
    }

    return {
      success: true,
      message: "I can help with project status tracking, milestone reporting, and PMO documents. What specific project or initiative would you like information about?",
      data: searchResult.ok ? searchResult.value.data : undefined,
      toolsInvoked,
      escalated: false,
      auditTrail,
    };
  }
}
