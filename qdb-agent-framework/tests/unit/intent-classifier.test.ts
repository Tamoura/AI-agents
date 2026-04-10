import { describe, it, expect } from "vitest";
import { classifyIntent } from "../../src/agents/router/intent-classifier.js";

describe("IntentClassifier", () => {
  it("classifies incident reports to IT operations", () => {
    const result = classifyIntent("There is a critical incident affecting the VPN");
    expect(result.targetAgent).toBe("it_operations");
    expect(result.intent).toBe("incident_report");
    expect(result.confidence).toBeGreaterThan(0.1);
  });

  it("classifies DR inquiries to IT operations", () => {
    const result = classifyIntent("I need the disaster recovery playbook for Azure");
    expect(result.targetAgent).toBe("it_operations");
    expect(result.intent).toBe("dr_inquiry");
  });

  it("classifies service health to IT operations", () => {
    const result = classifyIntent("What is the current service health status?");
    expect(result.targetAgent).toBe("it_operations");
    expect(result.intent).toBe("service_health");
  });

  it("classifies project status to PMO", () => {
    const result = classifyIntent("What is the project delivery status and milestones?");
    expect(result.targetAgent).toBe("pmo");
    expect(result.intent).toBe("project_status");
  });

  it("classifies PMO report requests", () => {
    const result = classifyIntent("I need the latest PMO dashboard report");
    expect(result.targetAgent).toBe("pmo");
  });

  it("classifies credit inquiries", () => {
    const result = classifyIntent("Review the credit facility for customer CUST-001");
    expect(result.targetAgent).toBe("credit_assessment");
    expect(result.intent).toBe("credit_review");
  });

  it("classifies compliance requests", () => {
    const result = classifyIntent("Check QCB compliance for the new exposure");
    expect(result.targetAgent).toBe("regulatory_compliance");
    expect(result.intent).toBe("compliance_check");
  });

  it("classifies customer inquiries", () => {
    const result = classifyIntent("Start the onboarding process for a new customer");
    expect(result.targetAgent).toBe("customer_lifecycle");
  });

  it("returns low confidence for ambiguous messages", () => {
    const result = classifyIntent("hello");
    expect(result.confidence).toBeLessThan(0.3);
  });
});
