import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEngine } from "../../src/governance/policy-engine.js";
import { AutonomyLevel, DataClassification, ErrorCodes } from "../../src/core/types.js";

const IT_OPS_POLICY_YAML = `
agent_id: it_operations
display_name: "IT Operations Agent"
version: "1.0.0"
owner_team: "Applications Team"

scope:
  description: "IT infrastructure monitoring and incident management"
  domains: ["infrastructure", "incidents"]

autonomy:
  default_level: L1_NOTIFY
  overrides:
    - condition: "operation_type == MUTATE"
      level: L2_APPROVE
    - condition: "priority == CRITICAL"
      level: L2_APPROVE

allowed_tools:
  - qdb.data.query_azure_monitor
  - qdb.data.search_ecm
  - qdb.action.create_ticket
  - qdb.action.send_notification
  - qdb.compliance.log_audit_trail

denied_tools:
  - qdb.data.query_core_banking
  - qdb.compliance.check_sharia

data_boundaries:
  max_classification: INTERNAL
  pii_handling: MASK

escalation:
  rules:
    - trigger: "incident_severity == P1"
      action: escalate_to_human
      notify: ["it_manager", "cio"]
    - trigger: "dr_activation_requested == true"
      action: require_approval
      notify: ["it_manager", "cio", "coo"]

context_policy:
  max_session_duration_hours: 4
  clear_context_on_completion: true
  max_context_tokens: 100000

system_prompt: "You are the IT Operations Agent."
`;

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  describe("loadFromString", () => {
    it("loads a valid YAML policy", () => {
      const result = engine.loadFromString(IT_OPS_POLICY_YAML);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.agentId).toBe("it_operations");
        expect(result.value.displayName).toBe("IT Operations Agent");
        expect(result.value.allowedTools).toContain("qdb.data.search_ecm");
        expect(result.value.deniedTools).toContain("qdb.data.query_core_banking");
        expect(result.value.autonomy.defaultLevel).toBe(AutonomyLevel.NOTIFY);
      }
    });

    it("rejects invalid YAML", () => {
      const result = engine.loadFromString("agent_id: \n  invalid: {{}");
      expect(result.ok).toBe(false);
    });

    it("rejects missing required fields", () => {
      const result = engine.loadFromString("agent_id: test");
      expect(result.ok).toBe(false);
    });
  });

  describe("validateToolAccess", () => {
    beforeEach(() => {
      engine.loadFromString(IT_OPS_POLICY_YAML);
    });

    it("allows access to permitted tools", () => {
      const result = engine.validateToolAccess("it_operations", "qdb.data.search_ecm");
      expect(result.ok).toBe(true);
    });

    it("denies access to explicitly denied tools", () => {
      const result = engine.validateToolAccess("it_operations", "qdb.data.query_core_banking");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCodes.GOVERNANCE_DENIED);
        expect(result.error.message).toContain("explicitly denied");
      }
    });

    it("denies access to unlisted tools", () => {
      const result = engine.validateToolAccess("it_operations", "qdb.data.query_dynamics");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCodes.GOVERNANCE_DENIED);
      }
    });

    it("returns error for unknown agent", () => {
      const result = engine.validateToolAccess("unknown_agent", "qdb.data.search_ecm");
      expect(result.ok).toBe(false);
    });
  });

  describe("resolveAutonomyLevel", () => {
    beforeEach(() => {
      engine.loadFromString(IT_OPS_POLICY_YAML);
    });

    it("returns default level for normal operations", () => {
      const level = engine.resolveAutonomyLevel("it_operations", {});
      expect(level).toBe(AutonomyLevel.NOTIFY);
    });

    it("escalates for MUTATE operations", () => {
      const level = engine.resolveAutonomyLevel("it_operations", {
        operation_type: "MUTATE",
      });
      expect(level).toBe(AutonomyLevel.APPROVE);
    });

    it("escalates for CRITICAL priority", () => {
      const level = engine.resolveAutonomyLevel("it_operations", {
        priority: "CRITICAL",
      });
      expect(level).toBe(AutonomyLevel.APPROVE);
    });

    it("returns MANUAL for unknown agent", () => {
      const level = engine.resolveAutonomyLevel("unknown", {});
      expect(level).toBe(AutonomyLevel.MANUAL);
    });
  });

  describe("loadFromDirectory", () => {
    it("loads policies from the policies directory", () => {
      const result = engine.loadFromDirectory("./policies");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThanOrEqual(3);
        const ids = result.value.map((p) => p.agentId);
        expect(ids).toContain("it_operations");
        expect(ids).toContain("router");
        expect(ids).toContain("pmo");
      }
    });

    it("fails for nonexistent directory", () => {
      const result = engine.loadFromDirectory("/nonexistent/path");
      expect(result.ok).toBe(false);
    });
  });
});
