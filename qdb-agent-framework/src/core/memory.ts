/**
 * Conversation Memory — Sliding window + summary memory management.
 * Manages conversation context within token limits.
 * Short-term: recent messages in sliding window.
 * Long-term: summarized earlier context.
 */

import {
  type LLMMessage,
} from "./types.js";
import { type LLMRouter } from "./llm-router.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MemoryConfig {
  readonly maxTokens: number;
  readonly windowSize: number;          // Number of recent messages to keep verbatim
  readonly summaryModel?: string;       // Model for summarization
  readonly summaryThreshold?: number;   // Summarize when messages exceed this count
  readonly enableLongTermMemory?: boolean;
}

export interface ConversationMemory {
  readonly sessionId: string;
  readonly messages: readonly LLMMessage[];
  readonly summary: string | null;
  readonly totalMessages: number;
  readonly tokenEstimate: number;
  readonly facts: readonly MemoryFact[];
}

export interface MemoryFact {
  readonly key: string;
  readonly value: string;
  readonly source: string;
  readonly timestamp: string;
}

// ─── Memory Manager ─────────────────────────────────────────────────────────

export class MemoryManager {
  private readonly config: MemoryConfig;
  private readonly memories = new Map<string, MutableMemory>();
  private readonly router: LLMRouter | null;

  constructor(config: MemoryConfig, router?: LLMRouter) {
    this.config = config;
    this.router = router ?? null;
  }

  /**
   * Get or create memory for a session.
   */
  getMemory(sessionId: string): ConversationMemory {
    const mem = this.memories.get(sessionId);
    if (!mem) {
      const newMem: MutableMemory = {
        sessionId,
        messages: [],
        summary: null,
        totalMessages: 0,
        facts: [],
      };
      this.memories.set(sessionId, newMem);
      return this.toImmutable(newMem);
    }
    return this.toImmutable(mem);
  }

  /**
   * Add a message to session memory.
   * Automatically manages window and triggers summarization when needed.
   */
  async addMessage(sessionId: string, message: LLMMessage): Promise<ConversationMemory> {
    let mem = this.memories.get(sessionId);
    if (!mem) {
      mem = { sessionId, messages: [], summary: null, totalMessages: 0, facts: [] };
      this.memories.set(sessionId, mem);
    }

    mem.messages.push(message);
    mem.totalMessages++;

    // Extract facts from assistant messages
    if (message.role === "assistant" && this.config.enableLongTermMemory) {
      this.extractFacts(mem, message.content);
    }

    // Check if we need to summarize
    const threshold = this.config.summaryThreshold ?? this.config.windowSize * 2;
    if (mem.messages.length > threshold) {
      await this.compactMemory(mem);
    }

    return this.toImmutable(mem);
  }

  /**
   * Get messages formatted for LLM context, including summary if available.
   */
  getContextMessages(sessionId: string): LLMMessage[] {
    const mem = this.memories.get(sessionId);
    if (!mem) return [];

    const result: LLMMessage[] = [];

    // Include summary as a system-style message
    if (mem.summary) {
      result.push({
        role: "user",
        content: `[Previous conversation summary: ${mem.summary}]`,
      });
    }

    // Include facts as context
    if (mem.facts.length > 0) {
      const factsStr = mem.facts
        .map((f) => `- ${f.key}: ${f.value}`)
        .join("\n");
      result.push({
        role: "user",
        content: `[Known facts:\n${factsStr}]`,
      });
    }

    // Include recent messages within window
    const windowMessages = mem.messages.slice(-this.config.windowSize);
    result.push(...windowMessages);

    return result;
  }

  /**
   * Store a fact for long-term recall.
   */
  addFact(sessionId: string, key: string, value: string, source: string): void {
    let mem = this.memories.get(sessionId);
    if (!mem) {
      mem = { sessionId, messages: [], summary: null, totalMessages: 0, facts: [] };
      this.memories.set(sessionId, mem);
    }

    // Upsert fact
    const existingIdx = mem.facts.findIndex((f) => f.key === key);
    const fact: MemoryFact = { key, value, source, timestamp: new Date().toISOString() };

    if (existingIdx >= 0) {
      mem.facts[existingIdx] = fact;
    } else {
      mem.facts.push(fact);
    }
  }

  /**
   * Clear a session's memory.
   */
  clearMemory(sessionId: string): void {
    this.memories.delete(sessionId);
  }

  /**
   * Get token estimate for current context.
   */
  estimateTokens(sessionId: string): number {
    const mem = this.memories.get(sessionId);
    if (!mem) return 0;

    let chars = 0;
    if (mem.summary) chars += mem.summary.length;
    for (const msg of mem.messages.slice(-this.config.windowSize)) {
      chars += msg.content.length;
    }
    for (const fact of mem.facts) {
      chars += fact.key.length + fact.value.length;
    }

    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(chars / 4);
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private async compactMemory(mem: MutableMemory): Promise<void> {
    const messagesToSummarize = mem.messages.slice(0, -this.config.windowSize);

    if (messagesToSummarize.length === 0) return;

    // Build summary
    const summaryText = await this.summarize(messagesToSummarize, mem.summary);

    // Replace with windowed messages only
    mem.messages = mem.messages.slice(-this.config.windowSize);
    mem.summary = summaryText;
  }

  private async summarize(
    messages: LLMMessage[],
    existingSummary: string | null,
  ): Promise<string> {
    // If we have an LLM router, use it for summarization
    if (this.router) {
      const conversationText = messages
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

      const prompt = existingSummary
        ? `Previous summary: ${existingSummary}\n\nNew conversation:\n${conversationText}\n\nUpdate the summary to include the new information. Be concise.`
        : `Summarize this conversation concisely, preserving key facts and decisions:\n\n${conversationText}`;

      const result = await this.router.complete({
        systemPrompt: "You are a concise summarizer. Preserve key facts, decisions, and context.",
        messages: [{ role: "user", content: prompt }],
        maxTokens: 500,
        temperature: 0,
      });

      if (result.ok) {
        return result.value.content;
      }
    }

    // Fallback: simple truncation-based summary
    const text = messages.map((m) => m.content).join(" ");
    const existing = existingSummary ? `${existingSummary} ` : "";
    return `${existing}${text.slice(0, 500)}...`;
  }

  private extractFacts(mem: MutableMemory, content: string): void {
    // Simple fact extraction from structured patterns
    const patterns = [
      /(?:ticket|incident)\s+(?:ID|number)?:?\s*([A-Z]+-\d+[-\d]*)/gi,
      /(?:project|initiative)\s+"([^"]+)"/gi,
      /(?:status|state)\s+(?:is|:)\s+(\w+)/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (match[1]) {
          this.addFact(
            mem.sessionId,
            `extracted_${match.index}`,
            match[1],
            "auto_extraction",
          );
        }
      }
    }
  }

  private toImmutable(mem: MutableMemory): ConversationMemory {
    return {
      sessionId: mem.sessionId,
      messages: [...mem.messages],
      summary: mem.summary,
      totalMessages: mem.totalMessages,
      tokenEstimate: this.estimateTokens(mem.sessionId),
      facts: [...mem.facts],
    };
  }
}

interface MutableMemory {
  sessionId: string;
  messages: LLMMessage[];
  summary: string | null;
  totalMessages: number;
  facts: MemoryFact[];
}
