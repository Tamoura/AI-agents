/**
 * Message Bus — Inter-agent messaging via EventEmitter (v1).
 * All inter-agent communication flows through the message bus using standard MessageEnvelopes.
 * Production: swap for Azure Service Bus adapter.
 */

import { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";
import {
  type MessageEnvelope,
  type IMessageBus,
  type IAuditLogger,
  type AuditEntry,
  type Result,
  Ok,
  Err,
  ErrorCodes,
} from "./types.js";
import { isExpired, summarizeEnvelope } from "./message-envelope.js";

type MessageHandler = (envelope: MessageEnvelope) => Promise<void>;

export class InMemoryMessageBus implements IMessageBus {
  private readonly emitter = new EventEmitter();
  private readonly handlers = new Map<string, MessageHandler>();
  private readonly pendingRequests = new Map<
    string,
    { resolve: (envelope: MessageEnvelope) => void; reject: (error: Error) => void }
  >();
  private readonly auditLogger: IAuditLogger;

  constructor(auditLogger: IAuditLogger) {
    this.auditLogger = auditLogger;
    this.emitter.setMaxListeners(100);
  }

  async publish(envelope: MessageEnvelope): Promise<Result<void>> {
    if (isExpired(envelope)) {
      return Err({
        code: ErrorCodes.MESSAGE_EXPIRED,
        message: `Message ${envelope.messageId} has expired (TTL: ${envelope.ttlSeconds}s).`,
      });
    }

    await this.logMessage(envelope, "publish");

    // Check if this is a response to a pending request
    if (envelope.parentMessageId) {
      const pending = this.pendingRequests.get(envelope.parentMessageId);
      if (pending) {
        this.pendingRequests.delete(envelope.parentMessageId);
        pending.resolve(envelope);
        return Ok(undefined);
      }
    }

    // Route to target agent's handler
    const handler = this.handlers.get(envelope.targetAgent);
    if (!handler) {
      return Err({
        code: ErrorCodes.MESSAGE_DELIVERY_FAILED,
        message: `No handler registered for agent "${envelope.targetAgent}".`,
      });
    }

    // Fire and forget — handler errors are caught and logged
    handler(envelope).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logMessage(envelope, "handler_error", message).catch(() => {
        // Swallow logging errors to prevent cascading failures
      });
    });

    return Ok(undefined);
  }

  subscribe(agentId: string, handler: MessageHandler): void {
    this.handlers.set(agentId, handler);
  }

  unsubscribe(agentId: string): void {
    this.handlers.delete(agentId);
  }

  /**
   * Send a message and wait for a response with the same correlationId.
   * Used for synchronous request-response patterns between agents.
   */
  async request(
    envelope: MessageEnvelope,
    timeoutMs: number,
  ): Promise<Result<MessageEnvelope>> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(envelope.messageId);
        resolve(
          Err({
            code: ErrorCodes.MESSAGE_EXPIRED,
            message: `Request ${envelope.messageId} timed out after ${timeoutMs}ms.`,
          }),
        );
      }, timeoutMs);

      this.pendingRequests.set(envelope.messageId, {
        resolve: (response) => {
          clearTimeout(timer);
          resolve(Ok(response));
        },
        reject: (error) => {
          clearTimeout(timer);
          resolve(
            Err({
              code: ErrorCodes.MESSAGE_DELIVERY_FAILED,
              message: error.message,
            }),
          );
        },
      });

      this.publish(envelope).then((result) => {
        if (!result.ok) {
          clearTimeout(timer);
          this.pendingRequests.delete(envelope.messageId);
          resolve(Err(result.error));
        }
      });
    });
  }

  getRegisteredAgents(): string[] {
    return Array.from(this.handlers.keys());
  }

  private async logMessage(
    envelope: MessageEnvelope,
    action: string,
    errorMessage?: string,
  ): Promise<void> {
    const entry: AuditEntry = {
      entryId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: envelope.correlationId,
      agentId: envelope.sourceAgent,
      userId: envelope.metadata.userId,
      action: `message_bus.${action}`,
      inputSummary: summarizeEnvelope(envelope),
      outputSummary: errorMessage ?? "OK",
      dataClassification: envelope.dataClassification,
      autonomyLevel: envelope.autonomyLevel,
      outcome: errorMessage ? "FAILURE" : "SUCCESS",
    };

    await this.auditLogger.log(entry);
  }
}
