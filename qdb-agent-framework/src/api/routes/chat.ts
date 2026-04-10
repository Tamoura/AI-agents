/**
 * Chat Routes — User message → Router Agent → Response.
 * Main entry point for user interactions with the agent framework.
 */

import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  DataClassification,
  AutonomyLevel,
} from "../../core/types.js";
import { createEnvelope } from "../../core/message-envelope.js";
import type { InMemoryMessageBus } from "../../core/message-bus.js";

const ChatMessageSchema = z.object({
  message: z.string().min(1, "Message cannot be empty").max(10000),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
});

export function createChatRoutes(messageBus: InMemoryMessageBus): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = ChatMessageSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid request",
          details: parsed.error.issues.map((i) => i.message),
        },
        400,
      );
    }

    const { message, userId, sessionId } = parsed.data;
    const correlationId = uuidv4();
    const actualSessionId = sessionId ?? uuidv4();

    // Create message envelope to Router Agent
    const envelopeResult = createEnvelope({
      sourceAgent: "api_gateway",
      targetAgent: "router",
      action: "user_message",
      payload: { message },
      dataClassification: DataClassification.INTERNAL,
      autonomyLevel: AutonomyLevel.AUTONOMOUS,
      correlationId,
      ttlSeconds: 120,
      metadata: {
        userId,
        sessionId: actualSessionId,
      },
    });

    if (!envelopeResult.ok) {
      return c.json({ error: "Failed to create message", details: envelopeResult.error.message }, 500);
    }

    // Send to Router Agent and wait for response
    const result = await messageBus.request(envelopeResult.value, 90_000);

    if (!result.ok) {
      return c.json(
        {
          error: "Request failed",
          details: result.error.message,
          correlationId,
        },
        504,
      );
    }

    const responsePayload = result.value.payload as {
      response?: {
        success: boolean;
        message: string;
        data?: unknown;
        toolsInvoked?: string[];
        escalated?: boolean;
      };
    };

    return c.json({
      success: responsePayload.response?.success ?? true,
      message: responsePayload.response?.message ?? "Request processed.",
      data: responsePayload.response?.data,
      metadata: {
        correlationId,
        sessionId: actualSessionId,
        toolsInvoked: responsePayload.response?.toolsInvoked ?? [],
        escalated: responsePayload.response?.escalated ?? false,
      },
    });
  });

  return app;
}
