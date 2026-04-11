import { describe, it, expect } from "vitest";
import {
  GraphBuilder,
  END_NODE,
  type GraphState,
} from "../../src/core/graph-engine.js";

describe("GraphEngine", () => {
  describe("GraphBuilder", () => {
    it("builds a simple linear graph", () => {
      const result = new GraphBuilder()
        .addNode("step1", "Step 1", async (state) => ({
          ...state,
          data: { ...state.data, step1: true },
        }))
        .addNode("step2", "Step 2", async (state) => ({
          ...state,
          data: { ...state.data, step2: true },
        }))
        .addEdge("step1", "step2")
        .addEdge("step2", END_NODE)
        .setEntryPoint("step1")
        .build();

      expect(result.ok).toBe(true);
    });

    it("rejects graph without entry point", () => {
      const result = new GraphBuilder()
        .addNode("step1", "Step 1", async (s) => s)
        .build();

      expect(result.ok).toBe(false);
    });

    it("rejects edge to non-existent node", () => {
      const result = new GraphBuilder()
        .addNode("step1", "Step 1", async (s) => s)
        .addEdge("step1", "nonexistent")
        .setEntryPoint("step1")
        .build();

      expect(result.ok).toBe(false);
    });
  });

  describe("StateGraph execution", () => {
    it("executes a linear workflow", async () => {
      const graphResult = new GraphBuilder()
        .addNode("classify", "Classify Intent", async (state) => ({
          ...state,
          data: { ...state.data, intent: "incident" },
        }))
        .addNode("process", "Process Request", async (state) => ({
          ...state,
          data: { ...state.data, processed: true },
        }))
        .addEdge("classify", "process")
        .addEdge("process", END_NODE)
        .setEntryPoint("classify")
        .build();

      expect(graphResult.ok).toBe(true);
      if (!graphResult.ok) return;

      const execResult = await graphResult.value.execute({ message: "server down" });
      expect(execResult.ok).toBe(true);
      if (!execResult.ok) return;

      expect(execResult.value.success).toBe(true);
      expect(execResult.value.finalState.data.intent).toBe("incident");
      expect(execResult.value.finalState.data.processed).toBe(true);
      expect(execResult.value.nodesExecuted).toEqual(["classify", "process"]);
    });

    it("executes conditional branching", async () => {
      const graphResult = new GraphBuilder()
        .addNode("classify", "Classify", async (state) => ({
          ...state,
          data: { ...state.data, severity: "P1" },
        }))
        .addNode("escalate", "Escalate", async (state) => ({
          ...state,
          data: { ...state.data, escalated: true },
        }))
        .addNode("handle", "Handle", async (state) => ({
          ...state,
          data: { ...state.data, handled: true },
        }))
        .addConditionalEdge(
          "classify",
          (state) => state.data.severity === "P1" ? "escalate" : "handle",
          ["escalate", "handle"],
        )
        .addEdge("escalate", END_NODE)
        .addEdge("handle", END_NODE)
        .setEntryPoint("classify")
        .build();

      expect(graphResult.ok).toBe(true);
      if (!graphResult.ok) return;

      const result = await graphResult.value.execute({});
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.finalState.data.escalated).toBe(true);
      expect(result.value.finalState.data.handled).toBeUndefined();
      expect(result.value.nodesExecuted).toEqual(["classify", "escalate"]);
    });

    it("produces checkpoints at each step", async () => {
      const graphResult = new GraphBuilder()
        .addNode("a", "A", async (s) => ({ ...s, data: { ...s.data, a: 1 } }))
        .addNode("b", "B", async (s) => ({ ...s, data: { ...s.data, b: 2 } }))
        .addNode("c", "C", async (s) => ({ ...s, data: { ...s.data, c: 3 } }))
        .addEdge("a", "b")
        .addEdge("b", "c")
        .addEdge("c", END_NODE)
        .setEntryPoint("a")
        .build();

      expect(graphResult.ok).toBe(true);
      if (!graphResult.ok) return;

      const result = await graphResult.value.execute({});
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // 3 nodes + 1 final END checkpoint = 4
      expect(result.value.checkpoints.length).toBe(4);
      // First checkpoint captures state BEFORE node A executes
      expect(result.value.checkpoints[0]!.nodeId).toBe("a");
    });

    it("handles node execution errors", async () => {
      const graphResult = new GraphBuilder()
        .addNode("failing", "Failing Node", async () => {
          throw new Error("Database connection failed");
        })
        .addEdge("failing", END_NODE)
        .setEntryPoint("failing")
        .build();

      expect(graphResult.ok).toBe(true);
      if (!graphResult.ok) return;

      const result = await graphResult.value.execute({});
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.success).toBe(false);
      expect(result.value.finalState.metadata.errors.length).toBe(1);
      expect(result.value.finalState.metadata.errors[0]!.message).toContain("Database connection");
    });

    it("supports retry on node failure", async () => {
      let attempts = 0;
      const graphResult = new GraphBuilder()
        .addNode(
          "retrying",
          "Retrying Node",
          async (state) => {
            attempts++;
            if (attempts < 3) throw new Error("Temporary failure");
            return { ...state, data: { ...state.data, recovered: true } };
          },
          { maxRetries: 3, backoffMs: 10 },
        )
        .addEdge("retrying", END_NODE)
        .setEntryPoint("retrying")
        .build();

      expect(graphResult.ok).toBe(true);
      if (!graphResult.ok) return;

      const result = await graphResult.value.execute({});
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.success).toBe(true);
      expect(result.value.finalState.data.recovered).toBe(true);
      expect(attempts).toBe(3);
    });

    it("generates Mermaid diagram", () => {
      const graphResult = new GraphBuilder()
        .addNode("classify", "Classify Intent", async (s) => s)
        .addNode("process", "Process", async (s) => s)
        .addEdge("classify", "process")
        .addEdge("process", END_NODE)
        .setEntryPoint("classify")
        .build();

      expect(graphResult.ok).toBe(true);
      if (!graphResult.ok) return;

      const mermaid = graphResult.value.toMermaid();
      expect(mermaid).toContain("graph TD");
      expect(mermaid).toContain("classify");
      expect(mermaid).toContain("process");
      expect(mermaid).toContain("__end__");
    });

    it("supports time-travel resume from checkpoint", async () => {
      const graphResult = new GraphBuilder()
        .addNode("a", "A", async (s) => ({ ...s, data: { ...s.data, a: true } }))
        .addNode("b", "B", async (s) => ({ ...s, data: { ...s.data, b: true } }))
        .addNode("c", "C", async (s) => ({ ...s, data: { ...s.data, c: true } }))
        .addEdge("a", "b")
        .addEdge("b", "c")
        .addEdge("c", END_NODE)
        .setEntryPoint("a")
        .build();

      expect(graphResult.ok).toBe(true);
      if (!graphResult.ok) return;

      // Execute fully
      const fullResult = await graphResult.value.execute({});
      expect(fullResult.ok).toBe(true);
      if (!fullResult.ok) return;

      // Resume from checkpoint at node B (step 2) with modified state
      const checkpointB = fullResult.value.checkpoints[1]!;
      const resumeResult = await graphResult.value.resumeFrom(checkpointB, {
        overrideValue: "modified",
      });

      expect(resumeResult.ok).toBe(true);
      if (!resumeResult.ok) return;
      expect(resumeResult.value.success).toBe(true);
      expect(resumeResult.value.finalState.data.overrideValue).toBe("modified");
    });
  });
});
