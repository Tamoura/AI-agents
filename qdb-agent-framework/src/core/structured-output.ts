/**
 * Structured Output — Zod-validated LLM responses with retry.
 * Ensures LLM outputs conform to declared TypeScript schemas.
 * Automatically retries with validation errors fed back to the LLM.
 */

import { z, type ZodType, type ZodError } from "zod";
import {
  type Result,
  Ok,
  Err,
  ErrorCodes,
} from "./types.js";
import { type LLMRouter, type LLMRequest, type LLMResponse } from "./llm-router.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StructuredOutputConfig<T> {
  readonly schema: ZodType<T>;
  readonly schemaName: string;
  readonly schemaDescription?: string;
  readonly maxRetries?: number;
  readonly temperature?: number;
  readonly provider?: LLMRequest["provider"];
  readonly model?: string;
}

export interface StructuredOutputResult<T> {
  readonly data: T;
  readonly raw: string;
  readonly attempts: number;
  readonly llmResponse: LLMResponse;
}

// ─── Structured Output Engine ───────────────────────────────────────────────

export class StructuredOutputEngine {
  private readonly router: LLMRouter;

  constructor(router: LLMRouter) {
    this.router = router;
  }

  /**
   * Generate a structured response that conforms to the given Zod schema.
   * Automatically retries with validation feedback if the LLM output doesn't match.
   */
  async generate<T>(
    systemPrompt: string,
    userMessage: string,
    config: StructuredOutputConfig<T>,
  ): Promise<Result<StructuredOutputResult<T>>> {
    const maxRetries = config.maxRetries ?? 2;
    const schemaJson = zodToJsonDescription(config.schema);

    let lastError: string | null = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const schemaInstruction = buildSchemaPrompt(
        config.schemaName,
        schemaJson,
        config.schemaDescription,
        lastError,
      );

      const result = await this.router.complete({
        systemPrompt: `${systemPrompt}\n\n${schemaInstruction}`,
        messages: [{ role: "user", content: userMessage }],
        maxTokens: config.model?.includes("haiku") ? 1000 : 4096,
        temperature: config.temperature ?? 0,
        responseFormat: "json",
        provider: config.provider,
        model: config.model,
      });

      if (!result.ok) {
        return Err(result.error);
      }

      // Try to parse JSON from the response
      const jsonStr = extractJson(result.value.content);
      if (!jsonStr) {
        lastError = `Response was not valid JSON. Raw: "${result.value.content.slice(0, 200)}"`;
        continue;
      }

      // Try to parse and validate with Zod
      try {
        const parsed = JSON.parse(jsonStr);
        const validated = config.schema.safeParse(parsed);

        if (validated.success) {
          return Ok({
            data: validated.data,
            raw: result.value.content,
            attempts: attempt,
            llmResponse: result.value,
          });
        }

        lastError = formatZodError(validated.error);
      } catch (e) {
        lastError = `JSON parse error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    return Err({
      code: ErrorCodes.INTERNAL_ERROR,
      message: `Failed to generate valid structured output after ${maxRetries + 1} attempts. Last error: ${lastError}`,
    });
  }

  /**
   * Extract a specific field from LLM output with type validation.
   */
  async extract<T>(
    content: string,
    fieldName: string,
    schema: ZodType<T>,
    systemPrompt?: string,
  ): Promise<Result<T>> {
    const result = await this.generate(
      systemPrompt ?? "Extract the requested information from the content. Return valid JSON only.",
      `Extract the "${fieldName}" from the following content:\n\n${content}`,
      {
        schema: z.object({ [fieldName]: schema }) as unknown as ZodType<Record<string, T>>,
        schemaName: fieldName,
        maxRetries: 1,
      },
    );

    if (!result.ok) return Err(result.error);

    const value = (result.value.data as Record<string, T>)[fieldName];
    if (value === undefined) {
      return Err({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `Field "${fieldName}" not found in extracted data.`,
      });
    }

    return Ok(value);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildSchemaPrompt(
  name: string,
  schemaJson: string,
  description?: string,
  previousError?: string | null,
): string {
  let prompt = `You MUST respond with valid JSON matching this schema:\n\nSchema name: ${name}`;
  if (description) {
    prompt += `\nDescription: ${description}`;
  }
  prompt += `\nSchema:\n${schemaJson}`;
  prompt += `\n\nRules:\n- Respond ONLY with valid JSON\n- Do not include markdown code fences\n- Do not include explanations outside the JSON`;

  if (previousError) {
    prompt += `\n\nYour previous response had validation errors. Fix these:\n${previousError}`;
  }

  return prompt;
}

function extractJson(content: string): string | null {
  // Try raw content first
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }

  // Try to extract from markdown code block
  const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch?.[1]) {
    return codeBlockMatch[1].trim();
  }

  // Try to find JSON object in the content
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  return null;
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
}

/**
 * Convert a Zod schema to a human-readable JSON description.
 * Not a full JSON Schema export — just enough for LLM understanding.
 */
function zodToJsonDescription(schema: ZodType<unknown>): string {
  try {
    // Use Zod's description if available
    const def = (schema as { _def?: { description?: string; typeName?: string } })._def;
    if (def?.typeName === "ZodObject") {
      const shape = (schema as z.ZodObject<Record<string, ZodType>>).shape;
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(shape)) {
        const fieldDef = (value as { _def?: { typeName?: string; description?: string } })._def;
        fields[key] = fieldDef?.typeName?.replace("Zod", "").toLowerCase() ?? "unknown";
      }
      return JSON.stringify(fields, null, 2);
    }
  } catch {
    // Fallback
  }
  return '{ "field": "type" }';
}

// ─── Pre-built Schemas ──────────────────────────────────────────────────────

/** Standard classification result schema. */
export const ClassificationSchema = z.object({
  category: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

/** Standard summary schema. */
export const SummarySchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  sentiment: z.enum(["positive", "neutral", "negative"]),
});

/** Standard risk assessment schema. */
export const RiskAssessmentSchema = z.object({
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  riskScore: z.number().min(0).max(100),
  factors: z.array(
    z.object({
      factor: z.string(),
      impact: z.enum(["LOW", "MEDIUM", "HIGH"]),
      description: z.string(),
    }),
  ),
  recommendation: z.string(),
});

export type Classification = z.infer<typeof ClassificationSchema>;
export type Summary = z.infer<typeof SummarySchema>;
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
