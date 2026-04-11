import { describe, it, expect } from "vitest";
import {
  initializeObservability,
  traceToolInvocation,
  traceAgentAction,
  traceMessage,
  recordGovernanceDenial,
  recordEscalation,
  recordToolLatency,
} from "../../src/core/observability.js";

describe("Observability", () => {
  it("initializes without error", () => {
    expect(() => initializeObservability()).not.toThrow();
  });

  it("traces tool invocation with span", async () => {
    const result = await traceToolInvocation(
      "qdb.data.test",
      "it_operations",
      "corr-1",
      async (span) => {
        span.setAttribute("custom.attr", "test");
        return { success: true, value: 42 };
      },
    );

    expect(result.success).toBe(true);
    expect(result.value).toBe(42);
  });

  it("traces agent action", async () => {
    const result = await traceAgentAction(
      "router",
      "classify",
      "corr-2",
      async (span) => {
        return { classified: true };
      },
    );

    expect(result.classified).toBe(true);
  });

  it("traces message bus operations", async () => {
    const result = await traceMessage(
      "router",
      "it_operations",
      "incident_report",
      "corr-3",
      async (span) => {
        return { delivered: true };
      },
    );

    expect(result.delivered).toBe(true);
  });

  it("records governance denials without error", () => {
    expect(() => {
      recordGovernanceDenial("it_ops", "qdb.data.query_core_banking", "unauthorized");
    }).not.toThrow();
  });

  it("records escalation events without error", () => {
    expect(() => {
      recordEscalation("it_ops", "P1 incident", "L2_APPROVE");
    }).not.toThrow();
  });

  it("records tool latency without error", () => {
    expect(() => {
      recordToolLatency("qdb.data.search_ecm", "it_ops", 150, true);
      recordToolLatency("qdb.data.search_ecm", "it_ops", 5000, false);
    }).not.toThrow();
  });

  it("handles errors in traced functions", async () => {
    await expect(
      traceToolInvocation("qdb.data.test", "agent", "corr", async () => {
        throw new Error("Tool failed");
      }),
    ).rejects.toThrow("Tool failed");
  });
});
