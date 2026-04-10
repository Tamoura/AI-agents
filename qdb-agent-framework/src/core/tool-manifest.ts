/**
 * Tool Manifest — Schema definition and validation for tool declarations.
 * Every tool must declare a manifest describing its capabilities, authorization, and constraints.
 */

import { z } from "zod";
import {
  type ToolManifest,
  type Result,
  DataClassification,
  OperationType,
  AuditLevel,
  Ok,
  Err,
  ErrorCodes,
} from "./types.js";

// ─── JSON Schema Validation (recursive) ────────────────────────────────────

const JSONSchemaZod: z.ZodType<Record<string, unknown>> = z.object({
  type: z.string(),
  properties: z.record(z.lazy(() => JSONSchemaZod)).optional(),
  required: z.array(z.string()).optional(),
  items: z.lazy(() => JSONSchemaZod).optional(),
  enum: z.array(z.string()).optional(),
  description: z.string().optional(),
  format: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(),
  additionalProperties: z.union([z.boolean(), z.lazy(() => JSONSchemaZod)]).optional(),
}).passthrough();

// ─── Tool Manifest Zod Schema ───────────────────────────────────────────────

const ToolManifestSchema = z.object({
  toolId: z
    .string()
    .regex(
      /^qdb\.[a-z]+\.[a-z_]+$/,
      "toolId must match pattern: qdb.<category>.<name> (e.g., qdb.data.query_core_banking)",
    ),
  displayName: z.string().min(1).max(100),
  description: z.string().min(1).max(1000),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "version must be semver (e.g., 1.0.0)"),
  ownerTeam: z.string().min(1),
  inputSchema: JSONSchemaZod,
  outputSchema: JSONSchemaZod,
  dataClassification: z.nativeEnum(DataClassification),
  operationType: z.nativeEnum(OperationType),
  authorizedAgents: z.array(z.string().min(1)).min(1, "At least one authorized agent required"),
  requiresApproval: z.boolean(),
  rateLimit: z.object({
    maxPerMinute: z.number().int().positive(),
  }),
  timeoutMs: z.number().int().positive().max(300_000),
  retryPolicy: z.object({
    maxRetries: z.number().int().min(0).max(10),
    backoff: z.enum(["exponential", "linear"]),
  }),
  auditLevel: z.nativeEnum(AuditLevel),
  shariaRelevance: z.boolean(),
});

// ─── Validation ─────────────────────────────────────────────────────────────

export function validateManifest(manifest: ToolManifest): Result<ToolManifest> {
  const result = ToolManifestSchema.safeParse(manifest);

  if (!result.success) {
    return Err({
      code: ErrorCodes.TOOL_VALIDATION_FAILED,
      message: `Tool manifest validation failed for "${manifest.toolId}": ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      details: { issues: result.error.issues },
    });
  }

  // Business rule: MUTATE + CONFIDENTIAL/RESTRICTED always requires approval
  if (
    result.data.operationType === OperationType.MUTATE &&
    (result.data.dataClassification === DataClassification.CONFIDENTIAL ||
      result.data.dataClassification === DataClassification.RESTRICTED) &&
    !result.data.requiresApproval
  ) {
    return Err({
      code: ErrorCodes.TOOL_VALIDATION_FAILED,
      message: `Tool "${manifest.toolId}": MUTATE operations on ${result.data.dataClassification} data MUST require approval`,
    });
  }

  return Ok(Object.freeze(result.data) as unknown as ToolManifest);
}

// ─── Input Validation Against Tool Schema ───────────────────────────────────

/**
 * Validates tool input parameters against the tool's declared JSON schema.
 * This is a basic runtime validator — checks required fields, types, and enums.
 */
export function validateToolInput(
  input: Record<string, unknown>,
  schema: ToolManifest["inputSchema"],
): Result<Record<string, unknown>> {
  const errors: string[] = [];

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in input) || input[field] === undefined || input[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // Check property types and enums
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const value = input[key];
      if (value === undefined || value === null) continue;

      // Type check
      const actualType = Array.isArray(value) ? "array" : typeof value;
      if (propSchema.type && actualType !== propSchema.type) {
        errors.push(`Field "${key}": expected type ${propSchema.type}, got ${actualType}`);
      }

      // Enum check
      if (propSchema.enum && !propSchema.enum.includes(String(value))) {
        errors.push(`Field "${key}": value "${String(value)}" not in allowed values [${propSchema.enum.join(", ")}]`);
      }

      // String constraints
      if (propSchema.type === "string" && typeof value === "string") {
        if (propSchema.minLength !== undefined && value.length < propSchema.minLength) {
          errors.push(`Field "${key}": string length ${value.length} is below minimum ${propSchema.minLength}`);
        }
        if (propSchema.maxLength !== undefined && value.length > propSchema.maxLength) {
          errors.push(`Field "${key}": string length ${value.length} exceeds maximum ${propSchema.maxLength}`);
        }
        if (propSchema.pattern !== undefined && !new RegExp(propSchema.pattern).test(value)) {
          errors.push(`Field "${key}": value does not match pattern ${propSchema.pattern}`);
        }
      }

      // Number constraints
      if (propSchema.type === "number" && typeof value === "number") {
        if (propSchema.minimum !== undefined && value < propSchema.minimum) {
          errors.push(`Field "${key}": value ${value} is below minimum ${propSchema.minimum}`);
        }
        if (propSchema.maximum !== undefined && value > propSchema.maximum) {
          errors.push(`Field "${key}": value ${value} exceeds maximum ${propSchema.maximum}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    return Err({
      code: ErrorCodes.TOOL_VALIDATION_FAILED,
      message: `Tool input validation failed: ${errors.join("; ")}`,
      details: { errors },
    });
  }

  return Ok(input);
}
