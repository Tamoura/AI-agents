import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "../../src/core/tool-registry.js";
import {
  DataClassification,
  OperationType,
  AuditLevel,
  ErrorCodes,
  type ToolManifest,
  type ToolExecutor,
  type IAuditLogger,
  type AuditEntry,
  type AuditQueryFilter,
  type Result,
  Ok,
} from "../../src/core/types.js";

// Mock audit logger
const mockAuditLogger: IAuditLogger = {
  log: async () => Ok(undefined),
  query: async () => Ok([]),
  getByCorrelationId: async () => Ok([]),
};

const testManifest: ToolManifest = {
  toolId: "qdb.data.test_tool",
  displayName: "Test Tool",
  description: "A test tool.",
  version: "1.0.0",
  ownerTeam: "Test Team",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  outputSchema: { type: "object" },
  dataClassification: DataClassification.INTERNAL,
  operationType: OperationType.READ,
  authorizedAgents: ["it_operations", "pmo"],
  requiresApproval: false,
  rateLimit: { maxPerMinute: 10 },
  timeoutMs: 5000,
  retryPolicy: { maxRetries: 1, backoff: "linear" },
  auditLevel: AuditLevel.STANDARD,
  shariaRelevance: false,
};

const testExecutor: ToolExecutor = async (params) => ({
  success: true,
  data: { result: `Processed ${params.id as string}` },
  metadata: { executionTimeMs: 10, timestamp: new Date().toISOString() },
});

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry(mockAuditLogger);
  });

  describe("register", () => {
    it("registers a valid tool", () => {
      const result = registry.register(testManifest, testExecutor);
      expect(result.ok).toBe(true);
    });

    it("rejects duplicate registration", () => {
      registry.register(testManifest, testExecutor);
      const result = registry.register(testManifest, testExecutor);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCodes.TOOL_VALIDATION_FAILED);
      }
    });
  });

  describe("unregister", () => {
    it("removes a registered tool", () => {
      registry.register(testManifest, testExecutor);
      const result = registry.unregister("qdb.data.test_tool");
      expect(result.ok).toBe(true);
      expect(registry.getManifest("qdb.data.test_tool")).toBeUndefined();
    });

    it("fails for non-existent tool", () => {
      const result = registry.unregister("qdb.data.nonexistent");
      expect(result.ok).toBe(false);
    });
  });

  describe("isAuthorized", () => {
    it("returns true for authorized agents", () => {
      registry.register(testManifest, testExecutor);
      expect(registry.isAuthorized("qdb.data.test_tool", "it_operations")).toBe(true);
    });

    it("returns false for unauthorized agents", () => {
      registry.register(testManifest, testExecutor);
      expect(registry.isAuthorized("qdb.data.test_tool", "credit_assessment")).toBe(false);
    });
  });

  describe("listTools", () => {
    it("returns all tools when no filter", () => {
      registry.register(testManifest, testExecutor);
      expect(registry.listTools()).toHaveLength(1);
    });

    it("filters by authorized agent", () => {
      registry.register(testManifest, testExecutor);
      expect(registry.listTools({ authorizedAgent: "it_operations" })).toHaveLength(1);
      expect(registry.listTools({ authorizedAgent: "unknown" })).toHaveLength(0);
    });
  });

  describe("execute", () => {
    it("executes a tool successfully", async () => {
      registry.register(testManifest, testExecutor);
      const result = await registry.execute("qdb.data.test_tool", { id: "123" }, {
        requestingAgent: "it_operations",
        correlationId: "corr-1",
        sessionId: "sess-1",
        dataClassification: DataClassification.INTERNAL,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.data).toEqual({ result: "Processed 123" });
      }
    });

    it("rejects unauthorized agent", async () => {
      registry.register(testManifest, testExecutor);
      const result = await registry.execute("qdb.data.test_tool", { id: "123" }, {
        requestingAgent: "unauthorized_agent",
        correlationId: "corr-1",
        sessionId: "sess-1",
        dataClassification: DataClassification.INTERNAL,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCodes.TOOL_UNAUTHORIZED);
      }
    });

    it("rejects invalid input", async () => {
      registry.register(testManifest, testExecutor);
      const result = await registry.execute("qdb.data.test_tool", {}, {
        requestingAgent: "it_operations",
        correlationId: "corr-1",
        sessionId: "sess-1",
        dataClassification: DataClassification.INTERNAL,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCodes.TOOL_VALIDATION_FAILED);
      }
    });

    it("rejects when data classification exceeds context", async () => {
      const confTool: ToolManifest = {
        ...testManifest,
        toolId: "qdb.data.conf_tool",
        dataClassification: DataClassification.CONFIDENTIAL,
      };
      registry.register(confTool, testExecutor);

      const result = await registry.execute("qdb.data.conf_tool", { id: "123" }, {
        requestingAgent: "it_operations",
        correlationId: "corr-1",
        sessionId: "sess-1",
        dataClassification: DataClassification.INTERNAL,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCodes.DATA_CLASSIFICATION_VIOLATION);
      }
    });

    it("rejects when tool not found", async () => {
      const result = await registry.execute("qdb.data.nonexistent", {}, {
        requestingAgent: "it_operations",
        correlationId: "corr-1",
        sessionId: "sess-1",
        dataClassification: DataClassification.INTERNAL,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCodes.TOOL_NOT_FOUND);
      }
    });
  });
});
