/**
 * Policy Engine — YAML policy parser and enforcer.
 * Loads agent policies from YAML files and enforces governance rules.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import {
  type AgentPolicy,
  type Result,
  AutonomyLevel,
  DataClassification,
  EscalationAction,
  Ok,
  Err,
  ErrorCodes,
} from "../core/types.js";

// ─── YAML Schema Validation ────────────────────────────────────────────────

const EscalationRuleSchema = z.object({
  trigger: z.string(),
  action: z.nativeEnum(EscalationAction),
  notify: z.array(z.string()),
});

const PolicyYAMLSchema = z.object({
  agent_id: z.string().min(1),
  display_name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  owner_team: z.string().min(1),

  scope: z.object({
    description: z.string(),
    domains: z.array(z.string()),
  }),

  autonomy: z.object({
    default_level: z.nativeEnum(AutonomyLevel),
    overrides: z
      .array(
        z.object({
          condition: z.string(),
          level: z.nativeEnum(AutonomyLevel),
        }),
      )
      .default([]),
  }),

  allowed_tools: z.array(z.string()).default([]),
  denied_tools: z.array(z.string()).default([]),

  data_boundaries: z.object({
    max_classification: z.nativeEnum(DataClassification),
    pii_handling: z.enum(["MASK", "REDACT", "ALLOW"]),
  }),

  escalation: z.object({
    rules: z.array(EscalationRuleSchema).default([]),
  }),

  context_policy: z.object({
    max_session_duration_hours: z.number().positive(),
    clear_context_on_completion: z.boolean(),
    max_context_tokens: z.number().int().positive(),
  }),

  system_prompt: z.string().min(1),
});

type PolicyYAML = z.infer<typeof PolicyYAMLSchema>;

// ─── Policy Engine ──────────────────────────────────────────────────────────

export class PolicyEngine {
  private readonly policies = new Map<string, AgentPolicy>();

  /**
   * Load a single policy from a YAML string.
   */
  loadFromString(yamlContent: string): Result<AgentPolicy> {
    try {
      const raw = YAML.parse(yamlContent) as unknown;
      const parsed = PolicyYAMLSchema.safeParse(raw);

      if (!parsed.success) {
        return Err({
          code: ErrorCodes.CONFIGURATION_ERROR,
          message: `Policy validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
          details: { issues: parsed.error.issues },
        });
      }

      const policy = yamlToPolicy(parsed.data);
      this.policies.set(policy.agentId, policy);
      return Ok(policy);
    } catch (error) {
      return Err({
        code: ErrorCodes.CONFIGURATION_ERROR,
        message: `Failed to parse policy YAML: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /**
   * Load a policy from a YAML file.
   */
  loadFromFile(filePath: string): Result<AgentPolicy> {
    try {
      const content = readFileSync(filePath, "utf-8");
      return this.loadFromString(content);
    } catch (error) {
      return Err({
        code: ErrorCodes.CONFIGURATION_ERROR,
        message: `Failed to read policy file "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /**
   * Load all policy files from a directory.
   */
  loadFromDirectory(dirPath: string): Result<AgentPolicy[]> {
    if (!existsSync(dirPath)) {
      return Err({
        code: ErrorCodes.CONFIGURATION_ERROR,
        message: `Policy directory "${dirPath}" does not exist.`,
      });
    }

    const files = readdirSync(dirPath).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
    );

    const policies: AgentPolicy[] = [];
    const errors: string[] = [];

    for (const file of files) {
      const result = this.loadFromFile(join(dirPath, file));
      if (result.ok) {
        policies.push(result.value);
      } else {
        errors.push(`${file}: ${result.error.message}`);
      }
    }

    if (errors.length > 0 && policies.length === 0) {
      return Err({
        code: ErrorCodes.CONFIGURATION_ERROR,
        message: `Failed to load any policies: ${errors.join("; ")}`,
      });
    }

    return Ok(policies);
  }

  /**
   * Get a loaded policy by agent ID.
   */
  getPolicy(agentId: string): AgentPolicy | undefined {
    return this.policies.get(agentId);
  }

  /**
   * Get all loaded policies.
   */
  getAllPolicies(): AgentPolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Validate that a tool invocation is allowed by the agent's policy.
   */
  validateToolAccess(agentId: string, toolId: string): Result<void> {
    const policy = this.policies.get(agentId);
    if (!policy) {
      return Err({
        code: ErrorCodes.AGENT_NOT_FOUND,
        message: `No policy loaded for agent "${agentId}".`,
      });
    }

    if (policy.deniedTools.includes(toolId)) {
      return Err({
        code: ErrorCodes.GOVERNANCE_DENIED,
        message: `Agent "${agentId}" is explicitly denied access to tool "${toolId}".`,
      });
    }

    if (!policy.allowedTools.includes(toolId)) {
      return Err({
        code: ErrorCodes.GOVERNANCE_DENIED,
        message: `Agent "${agentId}" is not authorized to use tool "${toolId}".`,
      });
    }

    return Ok(undefined);
  }

  /**
   * Determine the effective autonomy level for an agent action.
   */
  resolveAutonomyLevel(
    agentId: string,
    context: Record<string, unknown>,
  ): AutonomyLevel {
    const policy = this.policies.get(agentId);
    if (!policy) return AutonomyLevel.MANUAL;

    let level = policy.autonomy.defaultLevel;

    for (const override of policy.autonomy.overrides) {
      if (evaluateCondition(override.condition, context)) {
        const overrideRank = autonomyRank(override.level);
        if (overrideRank > autonomyRank(level)) {
          level = override.level;
        }
      }
    }

    return level;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function yamlToPolicy(yaml: PolicyYAML): AgentPolicy {
  return {
    agentId: yaml.agent_id,
    displayName: yaml.display_name,
    version: yaml.version,
    ownerTeam: yaml.owner_team,
    scope: {
      description: yaml.scope.description,
      domains: yaml.scope.domains,
    },
    autonomy: {
      defaultLevel: yaml.autonomy.default_level,
      overrides: yaml.autonomy.overrides.map((o) => ({
        condition: o.condition,
        level: o.level,
      })),
    },
    allowedTools: yaml.allowed_tools,
    deniedTools: yaml.denied_tools,
    dataBoundaries: {
      maxClassification: yaml.data_boundaries.max_classification,
      piiHandling: yaml.data_boundaries.pii_handling,
    },
    escalation: {
      rules: yaml.escalation.rules.map((r) => ({
        trigger: r.trigger,
        action: r.action,
        notify: r.notify,
      })),
    },
    contextPolicy: {
      maxSessionDurationHours: yaml.context_policy.max_session_duration_hours,
      clearContextOnCompletion: yaml.context_policy.clear_context_on_completion,
      maxContextTokens: yaml.context_policy.max_context_tokens,
    },
    systemPrompt: yaml.system_prompt,
  };
}

function evaluateCondition(
  condition: string,
  context: Record<string, unknown>,
): boolean {
  const match = condition.match(/^(\w+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
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

function autonomyRank(level: AutonomyLevel): number {
  const ranks: Record<AutonomyLevel, number> = {
    [AutonomyLevel.AUTONOMOUS]: 0,
    [AutonomyLevel.NOTIFY]: 1,
    [AutonomyLevel.APPROVE]: 2,
    [AutonomyLevel.MANUAL]: 3,
  };
  return ranks[level];
}
