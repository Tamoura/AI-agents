/**
 * Router Agent — Intent classification and delegation.
 * Classifies user intent and delegates to the appropriate capability agent.
 * Never executes business logic directly.
 */

import {
  type AgentPolicy,
  type AgentResponse,
  type AgentSession,
  type MessageEnvelope,
} from "../../core/types.js";
import { BaseAgent, type AgentDependencies } from "../../core/agent-runtime.js";
import { classifyIntent } from "./intent-classifier.js";

export class RouterAgent extends BaseAgent {
  readonly agentId = "router";
  readonly policy: AgentPolicy;

  constructor(deps: AgentDependencies, policy: AgentPolicy) {
    super(deps);
    this.policy = policy;
  }

  async handleMessage(
    envelope: MessageEnvelope,
    session: AgentSession,
  ): Promise<AgentResponse> {
    const userMessage = (envelope.payload.message as string) ?? "";
    const toolsInvoked: string[] = [];
    const auditTrail: string[] = [];

    // 1. Classify intent
    const classification = classifyIntent(userMessage);
    auditTrail.push(
      `Intent classified: ${classification.intent} → ${classification.targetAgent} (confidence: ${classification.confidence.toFixed(2)})`,
    );

    // 2. Log classification to audit trail
    const auditResult = await this.invokeTool(
      "qdb.compliance.log_audit_trail",
      {
        action: "classify_intent",
        description: `Classified "${userMessage.slice(0, 100)}" as ${classification.intent} → ${classification.targetAgent}`,
      },
      envelope.correlationId,
      session.sessionId,
      envelope.metadata.userId,
    );
    if (auditResult.ok) {
      toolsInvoked.push("qdb.compliance.log_audit_trail");
    }

    // 3. Delegate to the target agent
    if (classification.confidence < 0.2) {
      return {
        success: false,
        message: `I wasn't able to understand your request clearly. Could you please rephrase? I can help with IT operations, project management, credit assessment, customer management, compliance, and document search.`,
        toolsInvoked,
        escalated: false,
        auditTrail,
      };
    }

    const delegationResult = await this.delegateToAgent(
      classification.targetAgent,
      classification.intent,
      {
        originalMessage: userMessage,
        classification,
        userId: envelope.metadata.userId,
      },
      envelope,
      60000, // 60s timeout for agent processing
    );

    if (!delegationResult.ok) {
      auditTrail.push(`Delegation failed: ${delegationResult.error.message}`);
      return {
        success: false,
        message: `I identified this as a ${classification.domain} request, but the ${classification.targetAgent} agent is currently unavailable. Please try again shortly.`,
        toolsInvoked,
        escalated: false,
        auditTrail,
      };
    }

    const responsePayload = delegationResult.value.payload as {
      response?: AgentResponse;
    };
    const agentResponse = responsePayload.response;

    auditTrail.push(
      `Delegated to ${classification.targetAgent}, received response`,
    );

    return {
      success: agentResponse?.success ?? true,
      message: agentResponse?.message ?? "Request processed successfully.",
      data: agentResponse?.data,
      toolsInvoked: [...toolsInvoked, ...(agentResponse?.toolsInvoked ?? [])],
      escalated: agentResponse?.escalated ?? false,
      auditTrail: [...auditTrail, ...(agentResponse?.auditTrail ?? [])],
    };
  }
}
