/**
 * Agent Runtime — Base agent class with lifecycle hooks.
 * All capability agents extend this class. Provides governed tool invocation,
 * inter-agent delegation, escalation, and LLM integration.
 */

import { v4 as uuidv4 } from "uuid";
import Anthropic from "@anthropic-ai/sdk";
import {
  type AgentPolicy,
  type AgentResponse,
  type AgentSession,
  type MessageEnvelope,
  type ToolResult,
  type LLMMessage,
  type IMessageBus,
  type IStateStore,
  type IAuditLogger,
  type Result,
  AgentStatus,
  AutonomyLevel,
  DataClassification,
  Ok,
  Err,
  ErrorCodes,
  DATA_CLASSIFICATION_RANK,
  AUTONOMY_LEVEL_RANK,
} from "./types.js";
import { ToolRegistry } from "./tool-registry.js";
import { createEnvelope, createResponseEnvelope } from "./message-envelope.js";
import { type LLMRouter } from "./llm-router.js";
import { type GuardrailsEngine } from "./guardrails.js";
import { type MemoryManager } from "./memory.js";
import { type StreamCollector } from "./streaming.js";

export interface AgentDependencies {
  messageBus: IMessageBus;
  toolRegistry: ToolRegistry;
  stateStore: IStateStore;
  auditLogger: IAuditLogger;
  anthropicApiKey?: string;
  llmRouter?: LLMRouter;
  guardrails?: GuardrailsEngine;
  memory?: MemoryManager;
}

export abstract class BaseAgent {
  abstract readonly agentId: string;
  abstract readonly policy: AgentPolicy;

  protected readonly messageBus: IMessageBus;
  protected readonly toolRegistry: ToolRegistry;
  protected readonly stateStore: IStateStore;
  protected readonly auditLogger: IAuditLogger;
  protected readonly llmRouter: LLMRouter | null;
  protected readonly guardrails: GuardrailsEngine | null;
  protected readonly memory: MemoryManager | null;
  protected streamCollector: StreamCollector | null = null;
  private readonly anthropic: Anthropic | null;

  constructor(deps: AgentDependencies) {
    this.messageBus = deps.messageBus;
    this.toolRegistry = deps.toolRegistry;
    this.stateStore = deps.stateStore;
    this.auditLogger = deps.auditLogger;
    this.llmRouter = deps.llmRouter ?? null;
    this.guardrails = deps.guardrails ?? null;
    this.memory = deps.memory ?? null;
    this.anthropic = deps.anthropicApiKey
      ? new Anthropic({ apiKey: deps.anthropicApiKey })
      : null;
  }

  /**
   * Attach a stream collector for real-time event streaming.
   */
  setStreamCollector(collector: StreamCollector): void {
    this.streamCollector = collector;
  }

  /**
   * Initialize the agent: register message handler on the bus.
   */
  async initialize(): Promise<void> {
    this.messageBus.subscribe(this.agentId, (envelope) =>
      this.onMessage(envelope),
    );
  }

  /**
   * Shut down the agent: unsubscribe from the bus.
   */
  async shutdown(): Promise<void> {
    this.messageBus.unsubscribe(this.agentId);
  }

  /**
   * Core message handler — lifecycle wrapper around the agent's handleMessage implementation.
   */
  private async onMessage(envelope: MessageEnvelope): Promise<void> {
    const startTime = Date.now();
    let session: AgentSession | null = null;

    try {
      // Get or create session
      const sessionResult = await this.getOrCreateSession(envelope);
      if (!sessionResult.ok) {
        await this.sendErrorResponse(envelope, sessionResult.error.message);
        return;
      }
      session = sessionResult.value;

      // Update session status
      await this.stateStore.updateSession(session.sessionId, {
        status: AgentStatus.PROCESSING,
      });

      // Delegate to agent-specific handler
      const response = await this.handleMessage(envelope, session);

      // Log the action
      await this.logAgentAction(envelope, response, startTime);

      // Send response back via message bus
      const responseEnvelopeResult = createResponseEnvelope(envelope, {
        response,
      });
      if (responseEnvelopeResult.ok) {
        await this.messageBus.publish(responseEnvelopeResult.value);
      }

      // Update session
      await this.stateStore.updateSession(session.sessionId, {
        status: AgentStatus.IDLE,
        messages: [
          ...session.messages,
          { role: "user", content: JSON.stringify(envelope.payload) },
          { role: "assistant", content: response.message },
        ],
      });

      // Check if context should be cleared on completion
      if (this.policy.contextPolicy.clearContextOnCompletion && response.success) {
        await this.stateStore.updateSession(session.sessionId, {
          status: AgentStatus.TERMINATED,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (session) {
        await this.stateStore.updateSession(session.sessionId, {
          status: AgentStatus.ERROR,
        });
      }

      await this.sendErrorResponse(envelope, message);

      await this.auditLogger.log({
        entryId: uuidv4(),
        timestamp: new Date().toISOString(),
        correlationId: envelope.correlationId,
        agentId: this.agentId,
        userId: envelope.metadata.userId,
        action: "agent_error",
      policyVersion: this.policy.version,
        inputSummary: `Error handling message from ${envelope.sourceAgent}`,
        outputSummary: message,
        dataClassification: envelope.dataClassification,
        autonomyLevel: envelope.autonomyLevel,
        outcome: "FAILURE",
        durationMs: Date.now() - startTime,
      });
    }
  }

  /**
   * Agent-specific message handling — implement in each capability agent.
   */
  abstract handleMessage(
    envelope: MessageEnvelope,
    session: AgentSession,
  ): Promise<AgentResponse>;

  // ─── Protected Methods (available to agents) ─────────────────────────────

  /**
   * Invoke a tool through the governed tool registry.
   */
  protected async invokeTool(
    toolId: string,
    params: Record<string, unknown>,
    correlationId: string,
    sessionId: string,
    userId?: string,
  ): Promise<Result<ToolResult>> {
    // Check if tool is in agent's allowed list
    if (!this.policy.allowedTools.includes(toolId)) {
      return Err({
        code: ErrorCodes.AGENT_POLICY_VIOLATION,
        message: `Agent "${this.agentId}" policy does not allow tool "${toolId}".`,
      });
    }

    // Check if tool is explicitly denied
    if (this.policy.deniedTools.includes(toolId)) {
      return Err({
        code: ErrorCodes.AGENT_POLICY_VIOLATION,
        message: `Agent "${this.agentId}" is explicitly denied access to tool "${toolId}".`,
      });
    }

    return this.toolRegistry.execute(toolId, params, {
      requestingAgent: this.agentId,
      correlationId,
      sessionId,
      userId,
      dataClassification: this.policy.dataBoundaries.maxClassification,
      policyVersion: this.policy.version,
    });
  }

  /**
   * Delegate a task to another agent via the message bus.
   */
  protected async delegateToAgent(
    targetAgent: string,
    action: string,
    payload: Record<string, unknown>,
    envelope: MessageEnvelope,
    timeoutMs: number = 30000,
  ): Promise<Result<MessageEnvelope>> {
    const delegationEnvelope = createEnvelope({
      sourceAgent: this.agentId,
      targetAgent,
      action,
      payload,
      dataClassification: this.determineOutboundClassification(envelope),
      correlationId: envelope.correlationId,
      ttlSeconds: Math.ceil(timeoutMs / 1000),
      metadata: {
        userId: envelope.metadata.userId,
        sessionId: envelope.metadata.sessionId,
        traceId: envelope.metadata.traceId,
      },
    });

    if (!delegationEnvelope.ok) {
      return Err(delegationEnvelope.error);
    }

    return this.messageBus.request(delegationEnvelope.value, timeoutMs);
  }

  /**
   * Escalate to human — pause execution and notify relevant people.
   */
  protected async escalateToHuman(
    reason: string,
    context: Record<string, unknown>,
    envelope: MessageEnvelope,
  ): Promise<void> {
    // Determine escalation level from policy rules
    const matchingRule = this.policy.escalation.rules.find((rule) => {
      return this.evaluateEscalationTrigger(rule.trigger, context);
    });

    await this.auditLogger.log({
      entryId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: envelope.correlationId,
      agentId: this.agentId,
      userId: envelope.metadata.userId,
      action: "escalation",
      policyVersion: this.policy.version,
      inputSummary: reason,
      outputSummary: `Escalated to: ${matchingRule?.notify.join(", ") ?? "default escalation chain"}`,
      dataClassification: envelope.dataClassification,
      autonomyLevel: AutonomyLevel.APPROVE,
      outcome: "ESCALATED",
    });

    // Update session status to awaiting approval
    await this.stateStore.updateSession(envelope.metadata.sessionId, {
      status: AgentStatus.AWAITING_APPROVAL,
    });
  }

  /**
   * Call the LLM (Anthropic Claude) with the agent's system prompt and conversation.
   */
  protected async callLLM(
    messages: LLMMessage[],
    model: string = "claude-sonnet-4-20250514",
  ): Promise<Result<string>> {
    if (!this.anthropic) {
      return Err({
        code: ErrorCodes.CONFIGURATION_ERROR,
        message: "Anthropic API key not configured. Cannot call LLM.",
      });
    }

    try {
      const response = await this.anthropic.messages.create({
        model,
        max_tokens: 4096,
        system: this.policy.systemPrompt,
        messages: messages.map((m) => ({
          role: m.role === "system" ? "user" as const : m.role,
          content: m.content,
        })),
      });

      const textContent = response.content.find((c) => c.type === "text");
      if (!textContent || textContent.type !== "text") {
        return Err({
          code: ErrorCodes.INTERNAL_ERROR,
          message: "LLM returned no text content.",
        });
      }

      return Ok(textContent.text);
    } catch (error) {
      return Err({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /**
   * Determine the effective autonomy level for an action,
   * considering policy overrides.
   */
  protected determineAutonomyLevel(
    context: Record<string, unknown>,
  ): AutonomyLevel {
    let level = this.policy.autonomy.defaultLevel;

    for (const override of this.policy.autonomy.overrides) {
      if (this.evaluateCondition(override.condition, context)) {
        if (AUTONOMY_LEVEL_RANK[override.level] > AUTONOMY_LEVEL_RANK[level]) {
          level = override.level;
        }
      }
    }

    return level;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async getOrCreateSession(
    envelope: MessageEnvelope,
  ): Promise<Result<AgentSession>> {
    const sessionId = envelope.metadata.sessionId;
    const existing = await this.stateStore.getSession(sessionId);

    if (!existing.ok) return existing;

    if (existing.value) {
      // Check if session has expired
      if (new Date(existing.value.expiresAt) < new Date()) {
        await this.stateStore.deleteSession(sessionId);
        return Err({
          code: ErrorCodes.AGENT_SESSION_EXPIRED,
          message: `Session "${sessionId}" has expired.`,
        });
      }
      return Ok(existing.value);
    }

    // Create new session
    const durationHours = this.policy.contextPolicy.maxSessionDurationHours;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

    const newSession: AgentSession = {
      sessionId,
      agentId: this.agentId,
      userId: envelope.metadata.userId,
      startedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: AgentStatus.IDLE,
      state: {},
      messages: [],
    };

    const createResult = await this.stateStore.createSession(newSession);
    if (!createResult.ok) return createResult as unknown as Result<AgentSession>;

    return Ok(newSession);
  }

  private determineOutboundClassification(
    envelope: MessageEnvelope,
  ): DataClassification {
    const maxRank =
      DATA_CLASSIFICATION_RANK[this.policy.dataBoundaries.maxClassification];
    const envelopeRank =
      DATA_CLASSIFICATION_RANK[envelope.dataClassification];
    return envelopeRank <= maxRank
      ? envelope.dataClassification
      : this.policy.dataBoundaries.maxClassification;
  }

  /**
   * Simple condition evaluator for policy overrides.
   * Supports: "field == value", "field >= value", "field != value"
   */
  private evaluateCondition(
    condition: string,
    context: Record<string, unknown>,
  ): boolean {
    const match = condition.match(
      /^(\w+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/,
    );
    if (!match) return false;

    const [, field, operator, rawValue] = match;
    if (!field || !operator || !rawValue) return false;

    const contextValue = context[field];
    if (contextValue === undefined) return false;

    const value = rawValue.trim();
    const contextStr = String(contextValue);

    switch (operator) {
      case "==":
        return contextStr === value;
      case "!=":
        return contextStr !== value;
      case ">=":
        return contextStr >= value;
      case "<=":
        return contextStr <= value;
      case ">":
        return contextStr > value;
      case "<":
        return contextStr < value;
      default:
        return false;
    }
  }

  private evaluateEscalationTrigger(
    trigger: string,
    context: Record<string, unknown>,
  ): boolean {
    return this.evaluateCondition(trigger, context);
  }

  private async logAgentAction(
    envelope: MessageEnvelope,
    response: AgentResponse,
    startTime: number,
  ): Promise<void> {
    await this.auditLogger.log({
      entryId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: envelope.correlationId,
      agentId: this.agentId,
      userId: envelope.metadata.userId,
      action: envelope.action,
      policyVersion: this.policy.version,
      inputSummary: `Message from ${envelope.sourceAgent}: ${envelope.action}`,
      outputSummary: response.message,
      dataClassification: envelope.dataClassification,
      autonomyLevel: envelope.autonomyLevel,
      outcome: response.success ? "SUCCESS" : "FAILURE",
      durationMs: Date.now() - startTime,
      metadata: {
        toolsInvoked: response.toolsInvoked,
        escalated: response.escalated,
      },
    });
  }

  private async sendErrorResponse(
    envelope: MessageEnvelope,
    errorMessage: string,
  ): Promise<void> {
    const responseResult = createResponseEnvelope(envelope, {
      error: errorMessage,
      success: false,
    });

    if (responseResult.ok) {
      await this.messageBus.publish(responseResult.value);
    }
  }
}
