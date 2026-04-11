import { describe, it, expect, beforeEach } from "vitest";
import { MemoryManager } from "../../src/core/memory.js";

describe("MemoryManager", () => {
  let memory: MemoryManager;

  beforeEach(() => {
    memory = new MemoryManager({
      maxTokens: 10_000,
      windowSize: 5,
      summaryThreshold: 10,
      enableLongTermMemory: true,
    });
  });

  describe("basic operations", () => {
    it("creates empty memory for new session", () => {
      const mem = memory.getMemory("session-1");
      expect(mem.sessionId).toBe("session-1");
      expect(mem.messages).toHaveLength(0);
      expect(mem.summary).toBeNull();
      expect(mem.totalMessages).toBe(0);
    });

    it("adds messages to session memory", async () => {
      await memory.addMessage("s1", { role: "user", content: "Hello" });
      await memory.addMessage("s1", { role: "assistant", content: "Hi there" });

      const mem = memory.getMemory("s1");
      expect(mem.messages).toHaveLength(2);
      expect(mem.totalMessages).toBe(2);
    });

    it("isolates sessions from each other", async () => {
      await memory.addMessage("s1", { role: "user", content: "Session 1" });
      await memory.addMessage("s2", { role: "user", content: "Session 2" });

      expect(memory.getMemory("s1").messages).toHaveLength(1);
      expect(memory.getMemory("s2").messages).toHaveLength(1);
    });
  });

  describe("context window management", () => {
    it("returns recent messages within window size", async () => {
      for (let i = 0; i < 8; i++) {
        await memory.addMessage("s1", { role: "user", content: `Message ${i}` });
      }

      const context = memory.getContextMessages("s1");
      // windowSize is 5, so we get the last 5 messages
      const messageContents = context.filter((m) => m.content.startsWith("Message"));
      expect(messageContents.length).toBeLessThanOrEqual(5);
    });

    it("compacts memory when threshold exceeded", async () => {
      // summaryThreshold is 10
      for (let i = 0; i < 12; i++) {
        await memory.addMessage("s1", {
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Turn ${i}: This is a conversation message.`,
        });
      }

      const mem = memory.getMemory("s1");
      // After compaction, messages should be windowed
      expect(mem.messages.length).toBeLessThanOrEqual(6);
      // Should have a summary now
      expect(mem.summary).not.toBeNull();
      // Total count still tracks all messages
      expect(mem.totalMessages).toBe(12);
    });
  });

  describe("fact management", () => {
    it("stores and retrieves facts", () => {
      memory.addFact("s1", "customer_id", "CUST-001", "user_input");
      memory.addFact("s1", "ticket_id", "TKT-2025-001", "tool_result");

      const mem = memory.getMemory("s1");
      expect(mem.facts).toHaveLength(2);
      expect(mem.facts[0]!.key).toBe("customer_id");
      expect(mem.facts[0]!.value).toBe("CUST-001");
    });

    it("upserts facts by key", () => {
      memory.addFact("s1", "status", "OPEN", "initial");
      memory.addFact("s1", "status", "IN_PROGRESS", "update");

      const mem = memory.getMemory("s1");
      expect(mem.facts).toHaveLength(1);
      expect(mem.facts[0]!.value).toBe("IN_PROGRESS");
    });

    it("includes facts in context messages", () => {
      memory.addFact("s1", "project", "Azure Migration", "user");
      const context = memory.getContextMessages("s1");
      const factsMsg = context.find((m) => m.content.includes("Known facts"));
      expect(factsMsg).toBeDefined();
      expect(factsMsg!.content).toContain("Azure Migration");
    });
  });

  describe("token estimation", () => {
    it("estimates tokens for session content", async () => {
      await memory.addMessage("s1", {
        role: "user",
        content: "Hello, this is a test message with some words.",
      });

      const tokens = memory.estimateTokens("s1");
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(100);
    });

    it("returns 0 for empty session", () => {
      expect(memory.estimateTokens("nonexistent")).toBe(0);
    });
  });

  describe("clear memory", () => {
    it("removes all memory for a session", async () => {
      await memory.addMessage("s1", { role: "user", content: "test" });
      memory.addFact("s1", "key", "value", "test");

      memory.clearMemory("s1");

      const mem = memory.getMemory("s1");
      expect(mem.messages).toHaveLength(0);
      expect(mem.facts).toHaveLength(0);
    });
  });
});
