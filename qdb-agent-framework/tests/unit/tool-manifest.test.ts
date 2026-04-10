import { describe, it, expect } from "vitest";
import { validateManifest, validateToolInput } from "../../src/core/tool-manifest.js";
import { DataClassification, OperationType, AuditLevel, type ToolManifest } from "../../src/core/types.js";

describe("ToolManifest", () => {
  const validManifest: ToolManifest = {
    toolId: "qdb.data.query_test",
    displayName: "Test Query Tool",
    description: "A test tool for unit testing.",
    version: "1.0.0",
    ownerTeam: "Test Team",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
    outputSchema: {
      type: "object",
      properties: {
        result: { type: "string" },
      },
    },
    dataClassification: DataClassification.INTERNAL,
    operationType: OperationType.READ,
    authorizedAgents: ["it_operations"],
    requiresApproval: false,
    rateLimit: { maxPerMinute: 60 },
    timeoutMs: 30000,
    retryPolicy: { maxRetries: 3, backoff: "exponential" },
    auditLevel: AuditLevel.STANDARD,
    shariaRelevance: false,
  };

  describe("validateManifest", () => {
    it("accepts a valid manifest", () => {
      const result = validateManifest(validManifest);
      expect(result.ok).toBe(true);
    });

    it("rejects invalid toolId format", () => {
      const result = validateManifest({ ...validManifest, toolId: "invalid-id" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("toolId");
      }
    });

    it("rejects invalid semver version", () => {
      const result = validateManifest({ ...validManifest, version: "v1" });
      expect(result.ok).toBe(false);
    });

    it("rejects empty authorizedAgents", () => {
      const result = validateManifest({ ...validManifest, authorizedAgents: [] });
      expect(result.ok).toBe(false);
    });

    it("enforces MUTATE + CONFIDENTIAL requires approval", () => {
      const result = validateManifest({
        ...validManifest,
        operationType: OperationType.MUTATE,
        dataClassification: DataClassification.CONFIDENTIAL,
        requiresApproval: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("MUST require approval");
      }
    });

    it("accepts MUTATE + CONFIDENTIAL with approval", () => {
      const result = validateManifest({
        ...validManifest,
        operationType: OperationType.MUTATE,
        dataClassification: DataClassification.CONFIDENTIAL,
        requiresApproval: true,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("validateToolInput", () => {
    const schema = validManifest.inputSchema;

    it("accepts valid input", () => {
      const result = validateToolInput({ query: "test" }, schema);
      expect(result.ok).toBe(true);
    });

    it("rejects missing required fields", () => {
      const result = validateToolInput({}, schema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("Missing required field: query");
      }
    });

    it("rejects wrong type", () => {
      const result = validateToolInput({ query: 123 }, schema);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("expected type string");
      }
    });

    it("validates enum values", () => {
      const enumSchema = {
        type: "object" as const,
        properties: {
          status: { type: "string" as const, enum: ["active", "inactive"] },
        },
        required: ["status"],
      };

      expect(validateToolInput({ status: "active" }, enumSchema).ok).toBe(true);
      expect(validateToolInput({ status: "unknown" }, enumSchema).ok).toBe(false);
    });
  });
});
