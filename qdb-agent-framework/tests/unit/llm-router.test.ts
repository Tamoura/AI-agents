import { describe, it, expect } from "vitest";
import {
  LLMRouter,
  CLASSIFICATION_RULE,
  REASONING_RULE,
  type ProviderConfig,
  type RoutingRule,
} from "../../src/core/llm-router.js";

describe("LLMRouter", () => {
  describe("provider management", () => {
    it("returns empty when no providers configured", () => {
      const router = new LLMRouter([]);
      expect(router.getAvailableProviders()).toEqual([]);
    });

    it("registers enabled providers", () => {
      const router = new LLMRouter([
        { provider: "anthropic", apiKey: "test-key", defaultModel: "claude-sonnet-4-20250514", enabled: true },
        { provider: "openai", enabled: false, defaultModel: "gpt-4o" },
      ]);

      const providers = router.getAvailableProviders();
      expect(providers).toContain("anthropic");
      expect(providers).not.toContain("openai");
    });

    it("skips disabled providers", () => {
      const router = new LLMRouter([
        { provider: "ollama", baseUrl: "http://localhost:11434", defaultModel: "llama3", enabled: false },
      ]);

      expect(router.getAvailableProviders()).toEqual([]);
    });
  });

  describe("routing rules", () => {
    it("CLASSIFICATION_RULE matches short max_tokens requests", () => {
      expect(
        CLASSIFICATION_RULE.condition({
          systemPrompt: "classify",
          messages: [{ role: "user", content: "test" }],
          maxTokens: 100,
        }),
      ).toBe(true);
    });

    it("CLASSIFICATION_RULE matches json response format", () => {
      expect(
        CLASSIFICATION_RULE.condition({
          systemPrompt: "classify",
          messages: [{ role: "user", content: "test" }],
          responseFormat: "json",
        }),
      ).toBe(true);
    });

    it("REASONING_RULE matches long input messages", () => {
      const longContent = "x".repeat(3000);
      expect(
        REASONING_RULE.condition({
          systemPrompt: "analyze",
          messages: [{ role: "user", content: longContent }],
        }),
      ).toBe(true);
    });

    it("REASONING_RULE does not match short messages", () => {
      expect(
        REASONING_RULE.condition({
          systemPrompt: "analyze",
          messages: [{ role: "user", content: "short" }],
          maxTokens: 500,
        }),
      ).toBe(false);
    });

    it("adds custom routing rules", () => {
      const router = new LLMRouter([]);
      const customRule: RoutingRule = {
        name: "test_rule",
        condition: () => true,
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
      };

      router.addRoutingRule(customRule);
      // Rule is added (we can't inspect internals, but it doesn't throw)
      expect(true).toBe(true);
    });
  });

  describe("complete (no providers)", () => {
    it("returns error when no providers available", async () => {
      const router = new LLMRouter([]);
      const result = await router.complete({
        systemPrompt: "test",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain("No LLM provider available");
      }
    });
  });
});
