import { describe, it, expect } from "vitest";
import { DataClassifier } from "../../src/governance/data-classifier.js";
import { DataClassification } from "../../src/core/types.js";

describe("DataClassifier", () => {
  const classifier = new DataClassifier();

  describe("classifyPayload", () => {
    it("classifies public data correctly", () => {
      const result = classifier.classifyPayload({
        projectName: "Azure Migration",
        status: "GREEN",
        completion: 75,
      });
      expect(result.overallClassification).toBe(DataClassification.PUBLIC);
      expect(result.containsPII).toBe(false);
    });

    it("detects PII fields", () => {
      const result = classifier.classifyPayload({
        customerId: "CUST-001",
        nationalId: "QID-12345",
        email: "test@qdb.qa",
      });
      expect(result.containsPII).toBe(true);
      expect(result.overallClassification).toBe(DataClassification.CONFIDENTIAL);
    });

    it("detects confidential financial fields", () => {
      const result = classifier.classifyPayload({
        facilityId: "FAC-001",
        balance: 15000000,
        loanAmount: 50000000,
        creditScore: 720,
      });
      expect(result.overallClassification).toBe(DataClassification.CONFIDENTIAL);
    });

    it("detects restricted fields", () => {
      const result = classifier.classifyPayload({
        apiKey: "secret-key-123",
        password: "hunter2",
      });
      expect(result.overallClassification).toBe(DataClassification.RESTRICTED);
    });
  });

  describe("maskFields", () => {
    it("masks fields exceeding classification threshold", () => {
      const data = {
        projectName: "Test",
        balance: 5000000,
        nationalId: "QID-12345",
      };

      const masked = classifier.maskFields(data, DataClassification.INTERNAL);
      expect(masked.projectName).toBe("Test");
      // balance is CONFIDENTIAL, exceeds INTERNAL threshold → masked
      expect(masked.balance).toBe("***MASKED***");
      // nationalId is PII + CONFIDENTIAL, exceeds INTERNAL threshold → masked
      expect(masked.nationalId).toBe("***MASKED***");
    });

    it("applies PII masking when within classification but PII", () => {
      const data = {
        customerId: "CUST-001",
        email: "user@test.com",
      };

      // CONFIDENTIAL threshold allows PII fields, but MASK policy still masks PII values
      const masked = classifier.maskFields(data, DataClassification.CONFIDENTIAL, "MASK");
      expect(masked.email).toBe("us***om");
    });

    it("redacts fields when piiHandling is REDACT", () => {
      const data = {
        name: "Test",
        email: "user@test.com",
        nationalId: "QID-12345",
      };

      const masked = classifier.maskFields(data, DataClassification.INTERNAL, "REDACT");
      expect(masked.name).toBe("Test");
      expect(masked.email).toBeUndefined();
      expect(masked.nationalId).toBeUndefined();
    });

    it("allows all fields when ALLOW piiHandling", () => {
      const data = {
        nationalId: "QID-12345",
        email: "user@test.com",
      };

      const masked = classifier.maskFields(data, DataClassification.CONFIDENTIAL, "ALLOW");
      expect(masked.nationalId).toBe("QID-12345");
      expect(masked.email).toBe("user@test.com");
    });
  });

  describe("validateDataTransfer", () => {
    it("allows transfer within classification bounds", () => {
      const result = classifier.validateDataTransfer(
        DataClassification.CONFIDENTIAL,
        DataClassification.CONFIDENTIAL,
        DataClassification.INTERNAL,
      );
      expect(result.ok).toBe(true);
    });

    it("rejects transfer exceeding target classification", () => {
      const result = classifier.validateDataTransfer(
        DataClassification.CONFIDENTIAL,
        DataClassification.INTERNAL,
        DataClassification.CONFIDENTIAL,
      );
      expect(result.ok).toBe(false);
    });
  });
});
