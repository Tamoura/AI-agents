import { describe, it, expect } from "vitest";
import { StreamCollector } from "../../src/core/streaming.js";

describe("StreamCollector", () => {
  it("collects events in order", async () => {
    const collector = new StreamCollector();

    await collector.agentStart("router", "classify");
    await collector.agentThinking("router", "Analyzing intent...");
    await collector.toolCall("it_ops", "qdb.data.search_ecm", { query: "DR" });
    await collector.toolResult("it_ops", "qdb.data.search_ecm", true, "2 docs found");
    await collector.agentResponse("it_ops", "Found DR playbooks.");
    await collector.agentComplete("it_ops", true, ["qdb.data.search_ecm"]);

    const events = collector.getEvents();
    expect(events).toHaveLength(6);
    expect(events[0]!.type).toBe("agent.start");
    expect(events[1]!.type).toBe("agent.thinking");
    expect(events[2]!.type).toBe("agent.tool_call");
    expect(events[3]!.type).toBe("agent.tool_result");
    expect(events[4]!.type).toBe("agent.response");
    expect(events[5]!.type).toBe("agent.complete");
  });

  it("calls SSE writer when bound", async () => {
    const collector = new StreamCollector();
    const written: unknown[] = [];

    collector.bindSSE(async (event) => {
      written.push(event);
    });

    await collector.agentStart("router", "test");
    await collector.agentResponse("router", "done");

    expect(written).toHaveLength(2);
    expect(collector.getEvents()).toHaveLength(2);
  });

  it("includes timestamps on all events", async () => {
    const collector = new StreamCollector();
    await collector.agentStart("router", "test");

    const events = collector.getEvents();
    expect(events[0]!.timestamp).toBeDefined();
    expect(new Date(events[0]!.timestamp).getTime()).toBeGreaterThan(0);
  });

  it("records escalation events", async () => {
    const collector = new StreamCollector();
    await collector.agentEscalation("it_ops", "P1 incident", ["cio", "it_manager"]);

    const events = collector.getEvents();
    expect(events[0]!.type).toBe("agent.escalation");
    expect(events[0]!.data.notifyRoles).toEqual(["cio", "it_manager"]);
  });

  it("records error events", async () => {
    const collector = new StreamCollector();
    await collector.agentError("system", "Connection timeout");

    const events = collector.getEvents();
    expect(events[0]!.type).toBe("agent.error");
    expect(events[0]!.data.error).toBe("Connection timeout");
  });
});
