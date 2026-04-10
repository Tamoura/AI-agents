import { describe, it, expect, beforeEach } from "vitest";
import { EscalationManager } from "../../src/governance/escalation.js";
import {
  AutonomyLevel,
  DataClassification,
  OperationType,
  EscalationAction,
  ErrorCodes,
  type AgentPolicy,
  type IAuditLogger,
  type MessageEnvelope,
  Ok,
} from "../../src/core/types.js";
import { createEnvelope } from "../../src/core/message-envelope.js";

const mockAuditLogger: IAuditLogger = {
  log: async () => Ok(undefined),
  query: async () => Ok([]),
  getByCorrelationId: async () => Ok([]),
};

const testPolicy: AgentPolicy = {
  agentId: "it_operations",
  displayName: "IT Operations Agent",
  version: "1.0.0",
  ownerTeam: "IT",
  scope: { description: "IT ops", domains: ["infrastructure"] },
  autonomy: {
    defaultLevel: AutonomyLevel.NOTIFY,
    overrides: [
      { condition: "operation_type == MUTATE", level: AutonomyLevel.APPROVE },
    ],
  },
  allowedTools: ["qdb.action.create_ticket"],
  deniedTools: [],
  dataBoundaries: { maxClassification: DataClassification.INTERNAL, piiHandling: "MASK" },
  escalation: {
    rules: [
      { trigger: "incident_severity == P1", action: EscalationAction.ESCALATE_TO_HUMAN, notify: ["it_manager", "cio"] },
      { trigger: "dr_activation_requested == true", action: EscalationAction.REQUIRE_APPROVAL, notify: ["cio", "coo"] },
    ],
  },
  contextPolicy: { maxSessionDurationHours: 4, clearContextOnCompletion: true, maxContextTokens: 100000 },
  systemPrompt: "Test prompt",
};

function makeEnvelope(): MessageEnvelope {
  const result = createEnvelope({
    sourceAgent: "router",
    targetAgent: "it_operations",
    action: "test",
    payload: {},
    dataClassification: DataClassification.INTERNAL,
    metadata: { sessionId: "sess-1" },
  });
  if (!result.ok) throw new Error("Failed to create envelope");
  return result.value;
}

describe("EscalationManager", () => {
  let manager: EscalationManager;

  beforeEach(() => {
    manager = new EscalationManager(mockAuditLogger, 5000); // 5s timeout for tests
  });

  describe("evaluate", () => {
    it("requires approval for MUTATE on CONFIDENTIAL data", () => {
      const decision = manager.evaluate(
        testPolicy,
        "qdb.action.create_ticket",
        OperationType.MUTATE,
        DataClassification.CONFIDENTIAL,
        {},
      );

      expect(decision.requiresEscalation).toBe(true);
      expect(decision.autonomyLevel).toBe(AutonomyLevel.APPROVE);
      expect(decision.reason).toContain("MUTATE");
    });

    it("does not escalate for READ on INTERNAL data", () => {
      const decision = manager.evaluate(
        testPolicy,
        "qdb.data.search_ecm",
        OperationType.READ,
        DataClassification.INTERNAL,
        {},
      );

      expect(decision.requiresEscalation).toBe(false);
    });

    it("escalates on P1 incident trigger", () => {
      const decision = manager.evaluate(
        testPolicy,
        "qdb.action.create_ticket",
        OperationType.MUTATE,
        DataClassification.INTERNAL,
        { incident_severity: "P1" },
      );

      expect(decision.requiresEscalation).toBe(true);
      expect(decision.notifyRoles).toContain("it_manager");
      expect(decision.notifyRoles).toContain("cio");
    });

    it("escalates on DR activation", () => {
      const decision = manager.evaluate(
        testPolicy,
        "qdb.action.create_ticket",
        OperationType.READ,
        DataClassification.INTERNAL,
        { dr_activation_requested: "true" },
      );

      expect(decision.requiresEscalation).toBe(true);
      expect(decision.escalationAction).toBe(EscalationAction.REQUIRE_APPROVAL);
      expect(decision.notifyRoles).toContain("coo");
    });
  });

  describe("approval lifecycle", () => {
    it("creates and resolves an approval request", async () => {
      const envelope = makeEnvelope();
      const createResult = await manager.createApprovalRequest(
        "it_operations",
        "qdb.action.create_ticket",
        "create_ticket",
        "CRITICAL ticket needs approval",
        { title: "P1 Incident" },
        ["it_manager"],
        envelope,
      );

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      expect(createResult.value.status).toBe("PENDING");
      expect(manager.getPendingApprovals()).toHaveLength(1);

      // Approve
      const resolveResult = await manager.resolveApproval(
        createResult.value.requestId,
        true,
        "admin@qdb.qa",
      );

      expect(resolveResult.ok).toBe(true);
      if (resolveResult.ok) {
        expect(resolveResult.value.status).toBe("APPROVED");
      }
      expect(manager.getPendingApprovals()).toHaveLength(0);
    });

    it("rejects an approval request", async () => {
      const envelope = makeEnvelope();
      const createResult = await manager.createApprovalRequest(
        "it_operations",
        "qdb.action.create_ticket",
        "create_ticket",
        "Needs approval",
        {},
        ["it_manager"],
        envelope,
      );
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const resolveResult = await manager.resolveApproval(
        createResult.value.requestId,
        false,
        "admin@qdb.qa",
      );

      expect(resolveResult.ok).toBe(false);
      if (!resolveResult.ok) {
        expect(resolveResult.error.code).toBe(ErrorCodes.APPROVAL_REJECTED);
      }
    });

    it("cleans expired approvals", async () => {
      const envelope = makeEnvelope();
      // Create with a very short timeout (manager has 5s timeout)
      const shortManager = new EscalationManager(mockAuditLogger, 1); // 1ms timeout

      const createResult = await shortManager.createApprovalRequest(
        "it_operations",
        "qdb.action.create_ticket",
        "test",
        "test",
        {},
        ["admin"],
        envelope,
      );
      expect(createResult.ok).toBe(true);

      // Wait for expiry
      await new Promise((r) => setTimeout(r, 10));

      const cleaned = shortManager.cleanExpiredApprovals();
      expect(cleaned).toBe(1);
    });
  });
});
