/**
 * Message Envelope — Standard envelope for all inter-agent communication.
 * Every message between agents must use this format. Envelopes are immutable after creation.
 */

import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  type MessageEnvelope,
  type Result,
  DataClassification,
  AutonomyLevel,
  Ok,
  Err,
  ErrorCodes,
} from "./types.js";

// ─── Zod Validation Schema ─────────────────────────────────────────────────

const MessageMetadataSchema = z.object({
  userId: z.string().optional(),
  sessionId: z.string().min(1, "sessionId is required"),
  traceId: z.string().min(1, "traceId is required"),
});

const MessageEnvelopeSchema = z.object({
  messageId: z.string().uuid(),
  correlationId: z.string().uuid(),
  parentMessageId: z.string().uuid().optional(),
  sourceAgent: z.string().min(1, "sourceAgent is required"),
  targetAgent: z.string().min(1, "targetAgent is required"),
  action: z.string().min(1, "action is required"),
  payload: z.record(z.unknown()),
  dataClassification: z.nativeEnum(DataClassification),
  requiresApproval: z.boolean(),
  autonomyLevel: z.nativeEnum(AutonomyLevel),
  timestamp: z.string().datetime(),
  ttlSeconds: z.number().int().positive(),
  metadata: MessageMetadataSchema,
});

// ─── Factory Functions ──────────────────────────────────────────────────────

export interface CreateEnvelopeParams {
  sourceAgent: string;
  targetAgent: string;
  action: string;
  payload: Record<string, unknown>;
  dataClassification: DataClassification;
  requiresApproval?: boolean;
  autonomyLevel?: AutonomyLevel;
  correlationId?: string;
  parentMessageId?: string;
  ttlSeconds?: number;
  metadata: {
    userId?: string;
    sessionId: string;
    traceId?: string;
  };
}

export function createEnvelope(
  params: CreateEnvelopeParams,
): Result<MessageEnvelope> {
  const envelope: MessageEnvelope = {
    messageId: uuidv4(),
    correlationId: params.correlationId ?? uuidv4(),
    parentMessageId: params.parentMessageId,
    sourceAgent: params.sourceAgent,
    targetAgent: params.targetAgent,
    action: params.action,
    payload: params.payload,
    dataClassification: params.dataClassification,
    requiresApproval: params.requiresApproval ?? false,
    autonomyLevel: params.autonomyLevel ?? AutonomyLevel.AUTONOMOUS,
    timestamp: new Date().toISOString(),
    ttlSeconds: params.ttlSeconds ?? 300,
    metadata: {
      userId: params.metadata.userId,
      sessionId: params.metadata.sessionId,
      traceId: params.metadata.traceId ?? uuidv4(),
    },
  };

  return validateEnvelope(envelope);
}

export function createResponseEnvelope(
  original: MessageEnvelope,
  payload: Record<string, unknown>,
  dataClassification?: DataClassification,
): Result<MessageEnvelope> {
  return createEnvelope({
    sourceAgent: original.targetAgent,
    targetAgent: original.sourceAgent,
    action: `${original.action}.response`,
    payload,
    dataClassification: dataClassification ?? original.dataClassification,
    correlationId: original.correlationId,
    parentMessageId: original.messageId,
    ttlSeconds: original.ttlSeconds,
    metadata: {
      userId: original.metadata.userId,
      sessionId: original.metadata.sessionId,
      traceId: original.metadata.traceId,
    },
  });
}

// ─── Validation ─────────────────────────────────────────────────────────────

export function validateEnvelope(
  envelope: MessageEnvelope,
): Result<MessageEnvelope> {
  const result = MessageEnvelopeSchema.safeParse(envelope);

  if (!result.success) {
    return Err({
      code: ErrorCodes.MESSAGE_VALIDATION_FAILED,
      message: `Message envelope validation failed: ${result.error.issues.map((i) => i.message).join(", ")}`,
      details: { issues: result.error.issues },
    });
  }

  return Ok(Object.freeze(result.data) as MessageEnvelope);
}

// ─── Utilities ──────────────────────────────────────────────────────────────

export function isExpired(envelope: MessageEnvelope): boolean {
  const createdAt = new Date(envelope.timestamp).getTime();
  const now = Date.now();
  return now - createdAt > envelope.ttlSeconds * 1000;
}

export function redactPayload(
  envelope: MessageEnvelope,
  maxClassification: DataClassification,
): MessageEnvelope {
  const classificationRank: Record<DataClassification, number> = {
    [DataClassification.PUBLIC]: 0,
    [DataClassification.INTERNAL]: 1,
    [DataClassification.CONFIDENTIAL]: 2,
    [DataClassification.RESTRICTED]: 3,
  };

  if (
    classificationRank[envelope.dataClassification] <=
    classificationRank[maxClassification]
  ) {
    return envelope;
  }

  return {
    ...envelope,
    payload: { redacted: true, reason: "Data classification exceeds authorized level" },
    dataClassification: maxClassification,
  };
}

export function summarizeEnvelope(envelope: MessageEnvelope): string {
  return `[${envelope.messageId.slice(0, 8)}] ${envelope.sourceAgent} → ${envelope.targetAgent}: ${envelope.action} (${envelope.dataClassification})`;
}
