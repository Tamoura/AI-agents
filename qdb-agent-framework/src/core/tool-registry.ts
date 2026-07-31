/**
 * Tool Registry — Central registry for tool registration, discovery, authorization, and rate limiting.
 * Enforces governance rules: authorization checks, rate limits, and audit logging for every invocation.
 */

import { v4 as uuidv4 } from "uuid";
import {
  type ToolManifest,
  type ToolExecutor,
  type ToolExecutionContext,
  type ToolResult,
  type IToolRegistry,
  type IAuditLogger,
  type AuditEntry,
  type Result,
  type ToolRegistryFilter,
  DataClassification,
  OperationType,
  AutonomyLevel,
  AuditLevel,
  Ok,
  Err,
  ErrorCodes,
  DATA_CLASSIFICATION_RANK,
} from "./types.js";
import { validateManifest, validateToolInput } from "./tool-manifest.js";

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export class ToolRegistry implements IToolRegistry {
  private readonly manifests = new Map<string, ToolManifest>();
  private readonly executors = new Map<string, ToolExecutor>();
  private readonly rateLimits = new Map<string, RateLimitEntry>();
  private readonly auditLogger: IAuditLogger;

  constructor(auditLogger: IAuditLogger) {
    this.auditLogger = auditLogger;
  }

  register(manifest: ToolManifest, executor: ToolExecutor): Result<void> {
    const validation = validateManifest(manifest);
    if (!validation.ok) {
      return Err(validation.error);
    }

    if (this.manifests.has(manifest.toolId)) {
      return Err({
        code: ErrorCodes.TOOL_VALIDATION_FAILED,
        message: `Tool "${manifest.toolId}" is already registered. Unregister first to re-register.`,
      });
    }

    this.manifests.set(manifest.toolId, validation.value);
    this.executors.set(manifest.toolId, executor);
    return Ok(undefined);
  }

  unregister(toolId: string): Result<void> {
    if (!this.manifests.has(toolId)) {
      return Err({
        code: ErrorCodes.TOOL_NOT_FOUND,
        message: `Tool "${toolId}" not found in registry.`,
      });
    }

    this.manifests.delete(toolId);
    this.executors.delete(toolId);
    this.rateLimits.delete(toolId);
    return Ok(undefined);
  }

  getManifest(toolId: string): ToolManifest | undefined {
    return this.manifests.get(toolId);
  }

  getExecutor(toolId: string): ToolExecutor | undefined {
    return this.executors.get(toolId);
  }

  listTools(filter?: ToolRegistryFilter): ToolManifest[] {
    let tools = Array.from(this.manifests.values());

    if (filter?.operationType) {
      tools = tools.filter((t) => t.operationType === filter.operationType);
    }
    if (filter?.dataClassification) {
      tools = tools.filter((t) => t.dataClassification === filter.dataClassification);
    }
    if (filter?.authorizedAgent) {
      tools = tools.filter((t) => t.authorizedAgents.includes(filter.authorizedAgent!));
    }
    if (filter?.ownerTeam) {
      tools = tools.filter((t) => t.ownerTeam === filter.ownerTeam);
    }

    return tools;
  }

  isAuthorized(toolId: string, agentId: string): boolean {
    const manifest = this.manifests.get(toolId);
    if (!manifest) return false;
    return manifest.authorizedAgents.includes(agentId);
  }

  /**
   * Execute a tool with full governance enforcement:
   * 1. Tool existence check
   * 2. Authorization check
   * 3. Input validation
   * 4. Data classification check
   * 5. Rate limit check
   * 6. Approval check for MUTATE + CONFIDENTIAL+
   * 7. Execution with timeout
   * 8. Audit logging
   */
  async execute(
    toolId: string,
    params: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<Result<ToolResult>> {
    const startTime = Date.now();
    // 1. Check tool exists
    const manifest = this.manifests.get(toolId);
    if (!manifest) {
      await this.logAudit(toolId, context, "DENIED", startTime, "Tool not found");
      return Err({
        code: ErrorCodes.TOOL_NOT_FOUND,
        message: `Tool "${toolId}" not found in registry.`,
      });
    }

    const executor = this.executors.get(toolId);
    if (!executor) {
      await this.logAudit(toolId, context, "DENIED", startTime, "Executor not found");
      return Err({
        code: ErrorCodes.TOOL_NOT_FOUND,
        message: `Executor for tool "${toolId}" not found.`,
      });
    }

    // 2. Authorization check
    if (!manifest.authorizedAgents.includes(context.requestingAgent)) {
      await this.logAudit(toolId, context, "DENIED", startTime, `Agent "${context.requestingAgent}" not authorized`);
      return Err({
        code: ErrorCodes.TOOL_UNAUTHORIZED,
        message: `Agent "${context.requestingAgent}" is not authorized to invoke tool "${toolId}".`,
      });
    }

    // 3. Input validation
    const inputValidation = validateToolInput(params, manifest.inputSchema);
    if (!inputValidation.ok) {
      await this.logAudit(toolId, context, "DENIED", startTime, inputValidation.error.message);
      return Err(inputValidation.error);
    }

    // 4. Data classification compatibility check
    if (
      DATA_CLASSIFICATION_RANK[manifest.dataClassification] >
      DATA_CLASSIFICATION_RANK[context.dataClassification]
    ) {
      await this.logAudit(
        toolId,
        context,
        "DENIED",
        startTime,
        `Data classification mismatch: tool requires ${manifest.dataClassification}, context allows ${context.dataClassification}`,
      );
      return Err({
        code: ErrorCodes.DATA_CLASSIFICATION_VIOLATION,
        message: `Tool "${toolId}" data classification (${manifest.dataClassification}) exceeds context authorization (${context.dataClassification}).`,
      });
    }

    // 5. Rate limit check
    const rateLimitKey = `${context.requestingAgent}:${toolId}`;
    if (!this.checkRateLimit(rateLimitKey, manifest.rateLimit.maxPerMinute)) {
      await this.logAudit(toolId, context, "DENIED", startTime, "Rate limit exceeded");
      return Err({
        code: ErrorCodes.TOOL_RATE_LIMITED,
        message: `Rate limit exceeded for agent "${context.requestingAgent}" on tool "${toolId}". Max ${manifest.rateLimit.maxPerMinute}/min.`,
      });
    }

    // 6. Approval check: MUTATE + CONFIDENTIAL/RESTRICTED always requires approval
    if (
      manifest.operationType === OperationType.MUTATE &&
      DATA_CLASSIFICATION_RANK[manifest.dataClassification] >=
        DATA_CLASSIFICATION_RANK[DataClassification.CONFIDENTIAL] &&
      manifest.requiresApproval
    ) {
      await this.logAudit(toolId, context, "ESCALATED", startTime, "Approval required for MUTATE on CONFIDENTIAL+ data");
      return Err({
        code: ErrorCodes.ESCALATION_REQUIRED,
        message: `Tool "${toolId}" requires human approval for MUTATE operations on ${manifest.dataClassification} data.`,
      });
    }

    // 7. Execute with timeout
    try {
      const result = await Promise.race([
        executor(params, context),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Tool execution timeout")), manifest.timeoutMs),
        ),
      ]);

      // 8. Audit log
      const outcome = result.success ? "SUCCESS" : "FAILURE";
      await this.logAudit(
        toolId,
        context,
        outcome,
        startTime,
        result.success ? "Execution successful" : (result.error ?? "Execution failed"),
        params,
        manifest.auditLevel,
      );

      return Ok(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes("timeout") ? ErrorCodes.TOOL_TIMEOUT : ErrorCodes.TOOL_EXECUTION_FAILED;

      await this.logAudit(toolId, context, "FAILURE", startTime, message, params, manifest.auditLevel);

      return Err({ code, message: `Tool "${toolId}" execution failed: ${message}` });
    }
  }

  private checkRateLimit(key: string, maxPerMinute: number): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(key);

    if (!entry || now - entry.windowStart > 60_000) {
      this.rateLimits.set(key, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= maxPerMinute) {
      return false;
    }

    entry.count++;
    return true;
  }

  private async logAudit(
    toolId: string,
    context: ToolExecutionContext,
    outcome: AuditEntry["outcome"],
    startTime: number,
    summary: string,
    params?: Record<string, unknown>,
    auditLevel?: AuditLevel,
  ): Promise<void> {
    const entry: AuditEntry = {
      entryId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: context.correlationId,
      agentId: context.requestingAgent,
      userId: context.userId,
      action: "tool_invocation",
      toolId,
      inputSummary:
        auditLevel === AuditLevel.FULL && params
          ? JSON.stringify(params)
          : `Tool invocation by ${context.requestingAgent}`,
      outputSummary: summary,
      dataClassification: context.dataClassification,
      autonomyLevel: AutonomyLevel.AUTONOMOUS,
      outcome,
      durationMs: Date.now() - startTime,
      policyVersion: context.policyVersion,
      modelId: context.modelId,
    };

    await this.auditLogger.log(entry);
  }
}
