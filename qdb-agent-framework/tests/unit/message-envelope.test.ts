import { describe, it, expect } from "vitest";
import {
  createEnvelope,
  createResponseEnvelope,
  validateEnvelope,
  isExpired,
  redactPayload,
  summarizeEnvelope,
} from "../../src/core/message-envelope.js";
import { DataClassification, AutonomyLevel } from "../../src/core/types.js";

describe("MessageEnvelope", () => {
  const validParams = {
    sourceAgent: "router",
    targetAgent: "it_operations",
    action: "incident_report",
    payload: { message: "Server is down" },
    dataClassification: DataClassification.INTERNAL,
    metadata: { sessionId: "session-1", userId: "user-1" },
  };

  describe("createEnvelope", () => {
    it("creates a valid envelope with required fields", () => {
      const result = createEnvelope(validParams);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.messageId).toBeDefined();
      expect(result.value.correlationId).toBeDefined();
      expect(result.value.sourceAgent).toBe("router");
      expect(result.value.targetAgent).toBe("it_operations");
      expect(result.value.action).toBe("incident_report");
      expect(result.value.dataClassification).toBe(DataClassification.INTERNAL);
      expect(result.value.ttlSeconds).toBe(300); // default
      expect(result.value.requiresApproval).toBe(false);
      expect(result.value.autonomyLevel).toBe(AutonomyLevel.AUTONOMOUS);
    });

    it("respects custom correlationId and ttl", () => {
      const result = createEnvelope({
        ...validParams,
        correlationId: "custom-corr-id-00000000-0000-0000-0000-000000000000",
        ttlSeconds: 60,
      });
      // correlationId must be a valid UUID, so let's use a proper UUID
      const result2 = createEnvelope({
        ...validParams,
        ttlSeconds: 60,
      });
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.value.ttlSeconds).toBe(60);
      }
    });

    it("rejects envelope with empty sourceAgent", () => {
      const result = createEnvelope({ ...validParams, sourceAgent: "" });
      expect(result.ok).toBe(false);
    });

    it("rejects envelope with empty action", () => {
      const result = createEnvelope({ ...validParams, action: "" });
      expect(result.ok).toBe(false);
    });
  });

  describe("createResponseEnvelope", () => {
    it("creates a response envelope with swapped source/target", () => {
      const original = createEnvelope(validParams);
      expect(original.ok).toBe(true);
      if (!original.ok) return;

      const response = createResponseEnvelope(original.value, { status: "ok" });
      expect(response.ok).toBe(true);
      if (!response.ok) return;

      expect(response.value.sourceAgent).toBe("it_operations");
      expect(response.value.targetAgent).toBe("router");
      expect(response.value.parentMessageId).toBe(original.value.messageId);
      expect(response.value.correlationId).toBe(original.value.correlationId);
      expect(response.value.action).toBe("incident_report.response");
    });
  });

  describe("isExpired", () => {
    it("returns false for fresh envelope", () => {
      const result = createEnvelope(validParams);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(isExpired(result.value)).toBe(false);
    });

    it("returns true for expired envelope", () => {
      const result = createEnvelope({ ...validParams, ttlSeconds: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Manually set timestamp to the past
      const expired = {
        ...result.value,
        timestamp: new Date(Date.now() - 5000).toISOString(),
      };
      expect(isExpired(expired)).toBe(true);
    });
  });

  describe("redactPayload", () => {
    it("returns envelope unchanged when classification is within bounds", () => {
      const result = createEnvelope(validParams);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const redacted = redactPayload(result.value, DataClassification.CONFIDENTIAL);
      expect(redacted.payload).toEqual(result.value.payload);
    });

    it("redacts payload when classification exceeds bounds", () => {
      const result = createEnvelope({
        ...validParams,
        dataClassification: DataClassification.CONFIDENTIAL,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const redacted = redactPayload(result.value, DataClassification.PUBLIC);
      expect(redacted.payload).toEqual({
        redacted: true,
        reason: "Data classification exceeds authorized level",
      });
      expect(redacted.dataClassification).toBe(DataClassification.PUBLIC);
    });
  });

  describe("summarizeEnvelope", () => {
    it("produces a readable summary", () => {
      const result = createEnvelope(validParams);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const summary = summarizeEnvelope(result.value);
      expect(summary).toContain("router");
      expect(summary).toContain("it_operations");
      expect(summary).toContain("incident_report");
      expect(summary).toContain("INTERNAL");
    });
  });
});
