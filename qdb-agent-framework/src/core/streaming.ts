/**
 * Streaming — Server-Sent Events (SSE) support for real-time responses.
 * Enables streaming agent responses token-by-token to clients.
 */

import { type Context } from "hono";
import { streamSSE } from "hono/streaming";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StreamEvent {
  readonly type: StreamEventType;
  readonly data: Record<string, unknown>;
  readonly timestamp: string;
}

export type StreamEventType =
  | "agent.start"
  | "agent.thinking"
  | "agent.tool_call"
  | "agent.tool_result"
  | "agent.response"
  | "agent.error"
  | "agent.escalation"
  | "agent.complete";

/**
 * Collects events and can flush them to an SSE stream or return as array.
 */
export class StreamCollector {
  private readonly events: StreamEvent[] = [];
  private sseWriter: ((event: StreamEvent) => Promise<void>) | null = null;

  /**
   * Bind to an SSE response for real-time streaming.
   */
  bindSSE(writer: (event: StreamEvent) => Promise<void>): void {
    this.sseWriter = writer;
  }

  /**
   * Emit an event — writes to SSE if bound, always stores in buffer.
   */
  async emit(type: StreamEventType, data: Record<string, unknown>): Promise<void> {
    const event: StreamEvent = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };

    this.events.push(event);

    if (this.sseWriter) {
      await this.sseWriter(event);
    }
  }

  /**
   * Get all collected events.
   */
  getEvents(): readonly StreamEvent[] {
    return this.events;
  }

  /**
   * Convenience methods for common event types.
   */
  async agentStart(agentId: string, action: string): Promise<void> {
    await this.emit("agent.start", { agentId, action });
  }

  async agentThinking(agentId: string, thought: string): Promise<void> {
    await this.emit("agent.thinking", { agentId, thought });
  }

  async toolCall(agentId: string, toolId: string, params: Record<string, unknown>): Promise<void> {
    await this.emit("agent.tool_call", { agentId, toolId, params });
  }

  async toolResult(agentId: string, toolId: string, success: boolean, summary: string): Promise<void> {
    await this.emit("agent.tool_result", { agentId, toolId, success, summary });
  }

  async agentResponse(agentId: string, message: string, partial: boolean = false): Promise<void> {
    await this.emit("agent.response", { agentId, message, partial });
  }

  async agentError(agentId: string, error: string): Promise<void> {
    await this.emit("agent.error", { agentId, error });
  }

  async agentEscalation(agentId: string, reason: string, notifyRoles: string[]): Promise<void> {
    await this.emit("agent.escalation", { agentId, reason, notifyRoles });
  }

  async agentComplete(agentId: string, success: boolean, toolsInvoked: string[]): Promise<void> {
    await this.emit("agent.complete", { agentId, success, toolsInvoked });
  }
}

// ─── SSE Route Helper ───────────────────────────────────────────────────────

/**
 * Create an SSE streaming response for a Hono route.
 * Usage in route:
 *   return createSSEResponse(c, async (collector) => {
 *     await collector.agentStart("router", "classify");
 *     // ... process message ...
 *     await collector.agentComplete("router", true, []);
 *   });
 */
export function createSSEResponse(
  c: Context,
  handler: (collector: StreamCollector) => Promise<void>,
) {
  return streamSSE(c, async (stream) => {
    const collector = new StreamCollector();

    collector.bindSSE(async (event) => {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event.data),
        id: event.timestamp,
      });
    });

    try {
      await handler(collector);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await collector.agentError("system", message);
    }
  });
}
