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
import type { GuardrailsEngine } from "../../core/guardrails.js";
import { createSSEResponse } from "../../core/streaming.js";

const ChatMessageSchema = z.object({
  message: z.string().min(1, "Message cannot be empty").max(10000),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  stream: z.boolean().optional(),
});

export function createChatRoutes(
  messageBus: InMemoryMessageBus,
  guardrails?: GuardrailsEngine,
): Hono {
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

    const { message, userId, sessionId, stream } = parsed.data;
    const correlationId = uuidv4();
    const actualSessionId = sessionId ?? uuidv4();

    // Run input guardrails
    if (guardrails) {
      const guardrailResult = guardrails.validateInput(message, {
        userId,
      });
      if (!guardrailResult.passed) {
        const blockingViolations = guardrailResult.violations.filter((v) => v.severity === "BLOCK");
        return c.json(
          {
            error: "Input blocked by guardrails",
            violations: blockingViolations.map((v) => v.message),
            correlationId,
          },
          400,
        );
      }
    }

    // SSE streaming response
    if (stream) {
      return createSSEResponse(c, async (collector) => {
        await collector.agentStart("router", "user_message");

        const envelopeResult = createEnvelope({
          sourceAgent: "api_gateway",
          targetAgent: "router",
          action: "user_message",
          payload: { message },
          dataClassification: DataClassification.INTERNAL,
          autonomyLevel: AutonomyLevel.AUTONOMOUS,
          correlationId,
          ttlSeconds: 120,
          metadata: { userId, sessionId: actualSessionId },
        });

        if (!envelopeResult.ok) {
          await collector.agentError("system", envelopeResult.error.message);
          return;
        }

        const result = await messageBus.request(envelopeResult.value, 90_000);

        if (!result.ok) {
          await collector.agentError("system", result.error.message);
          return;
        }

        const payload = result.value.payload as {
          response?: { success?: boolean; message?: string; data?: unknown; toolsInvoked?: string[]; escalated?: boolean };
        };

        if (payload.response?.escalated) {
          await collector.agentEscalation("router", "Action escalated", []);
        }

        await collector.agentResponse(
          "router",
          payload.response?.message ?? "Request processed.",
        );
        await collector.agentComplete(
          "router",
          payload.response?.success ?? true,
          (payload.response?.toolsInvoked ?? []) as string[],
        );
      });
    }

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
