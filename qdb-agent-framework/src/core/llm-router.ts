/**
 * Multi-Provider LLM Router — Provider-agnostic model routing.
 * Supports Claude (Anthropic), GPT (OpenAI), and local models (Ollama).
 * Enables model selection per-task: fast models for classification, powerful for reasoning.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  type Result,
  Ok,
  Err,
  ErrorCodes,
} from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LLMRequest {
  readonly systemPrompt: string;
  readonly messages: readonly LLMChatMessage[];
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly model?: string;
  readonly provider?: LLMProvider;
  readonly responseFormat?: "text" | "json";
}

export interface LLMChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface LLMResponse {
  readonly content: string;
  readonly model: string;
  readonly provider: LLMProvider;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  readonly latencyMs: number;
}

export type LLMProvider = "anthropic" | "openai" | "ollama";

export interface ProviderConfig {
  readonly provider: LLMProvider;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly defaultModel: string;
  readonly enabled: boolean;
}

export interface RoutingRule {
  readonly name: string;
  readonly condition: (request: LLMRequest) => boolean;
  readonly provider: LLMProvider;
  readonly model: string;
}

// ─── LLM Router ─────────────────────────────────────────────────────────────

export class LLMRouter {
  private readonly providers = new Map<LLMProvider, ProviderConfig>();
  private readonly anthropicClient: Anthropic | null = null;
  private readonly openaiClient: OpenAI | null = null;
  private readonly ollamaBaseUrl: string | null = null;
  private readonly routingRules: RoutingRule[] = [];
  private readonly fallbackOrder: LLMProvider[];

  constructor(configs: ProviderConfig[], fallbackOrder?: LLMProvider[]) {
    for (const config of configs) {
      if (!config.enabled) continue;
      this.providers.set(config.provider, config);

      switch (config.provider) {
        case "anthropic":
          if (config.apiKey) {
            this.anthropicClient = new Anthropic({ apiKey: config.apiKey });
          }
          break;
        case "openai":
          if (config.apiKey) {
            this.openaiClient = new OpenAI({
              apiKey: config.apiKey,
              baseURL: config.baseUrl,
            });
          }
          break;
        case "ollama":
          this.ollamaBaseUrl = config.baseUrl ?? "http://localhost:11434";
          break;
      }
    }

    this.fallbackOrder = fallbackOrder ?? ["anthropic", "openai", "ollama"];
  }

  /**
   * Add a routing rule for automatic model selection.
   */
  addRoutingRule(rule: RoutingRule): void {
    this.routingRules.push(rule);
  }

  /**
   * Route a request to the appropriate provider and model.
   * Tries routing rules first, then explicit provider, then fallback chain.
   */
  async complete(request: LLMRequest): Promise<Result<LLMResponse>> {
    // 1. Check routing rules
    for (const rule of this.routingRules) {
      if (rule.condition(request)) {
        const result = await this.callProvider(rule.provider, rule.model, request);
        if (result.ok) return result;
        // Fall through on failure
      }
    }

    // 2. Use explicit provider/model if specified
    if (request.provider) {
      return this.callProvider(
        request.provider,
        request.model ?? this.providers.get(request.provider)?.defaultModel ?? "",
        request,
      );
    }

    // 3. Fallback chain
    for (const provider of this.fallbackOrder) {
      if (!this.providers.has(provider)) continue;
      const config = this.providers.get(provider)!;
      const result = await this.callProvider(
        provider,
        request.model ?? config.defaultModel,
        request,
      );
      if (result.ok) return result;
    }

    return Err({
      code: ErrorCodes.CONFIGURATION_ERROR,
      message: "No LLM provider available. Configure at least one provider.",
    });
  }

  /**
   * Quick classification call — uses fastest available model.
   */
  async classify(
    systemPrompt: string,
    input: string,
    categories: string[],
  ): Promise<Result<{ category: string; confidence: number }>> {
    const prompt = `${systemPrompt}\n\nClassify the following input into exactly one of these categories: ${categories.join(", ")}\n\nInput: "${input}"\n\nRespond with JSON: {"category": "<category>", "confidence": <0.0-1.0>}`;

    const result = await this.complete({
      systemPrompt: "You are a precise classifier. Respond only with valid JSON.",
      messages: [{ role: "user", content: prompt }],
      maxTokens: 100,
      temperature: 0,
      responseFormat: "json",
    });

    if (!result.ok) return Err(result.error);

    try {
      const parsed = JSON.parse(result.value.content) as { category: string; confidence: number };
      return Ok(parsed);
    } catch {
      return Err({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `Failed to parse classification response: ${result.value.content}`,
      });
    }
  }

  getAvailableProviders(): LLMProvider[] {
    return Array.from(this.providers.keys());
  }

  // ─── Provider Implementations ───────────────────────────────────────────

  private async callProvider(
    provider: LLMProvider,
    model: string,
    request: LLMRequest,
  ): Promise<Result<LLMResponse>> {
    const startTime = Date.now();

    try {
      switch (provider) {
        case "anthropic":
          return await this.callAnthropic(model, request, startTime);
        case "openai":
          return await this.callOpenAI(model, request, startTime);
        case "ollama":
          return await this.callOllama(model, request, startTime);
        default:
          return Err({
            code: ErrorCodes.CONFIGURATION_ERROR,
            message: `Unknown provider: ${provider}`,
          });
      }
    } catch (error) {
      return Err({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `LLM call to ${provider}/${model} failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private async callAnthropic(
    model: string,
    request: LLMRequest,
    startTime: number,
  ): Promise<Result<LLMResponse>> {
    if (!this.anthropicClient) {
      return Err({
        code: ErrorCodes.CONFIGURATION_ERROR,
        message: "Anthropic client not configured.",
      });
    }

    const response = await this.anthropicClient.messages.create({
      model,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      system: request.systemPrompt,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const textBlock = response.content.find((c) => c.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return Err({
        code: ErrorCodes.INTERNAL_ERROR,
        message: "Anthropic returned no text content.",
      });
    }

    return Ok({
      content: textBlock.text,
      model,
      provider: "anthropic",
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      latencyMs: Date.now() - startTime,
    });
  }

  private async callOpenAI(
    model: string,
    request: LLMRequest,
    startTime: number,
  ): Promise<Result<LLMResponse>> {
    if (!this.openaiClient) {
      return Err({
        code: ErrorCodes.CONFIGURATION_ERROR,
        message: "OpenAI client not configured.",
      });
    }

    const response = await this.openaiClient.chat.completions.create({
      model,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      messages: [
        { role: "system" as const, content: request.systemPrompt },
        ...request.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
      ...(request.responseFormat === "json"
        ? { response_format: { type: "json_object" as const } }
        : {}),
    });

    const content = response.choices[0]?.message.content;
    if (!content) {
      return Err({
        code: ErrorCodes.INTERNAL_ERROR,
        message: "OpenAI returned no content.",
      });
    }

    return Ok({
      content,
      model,
      provider: "openai",
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      latencyMs: Date.now() - startTime,
    });
  }

  private async callOllama(
    model: string,
    request: LLMRequest,
    startTime: number,
  ): Promise<Result<LLMResponse>> {
    if (!this.ollamaBaseUrl) {
      return Err({
        code: ErrorCodes.CONFIGURATION_ERROR,
        message: "Ollama base URL not configured.",
      });
    }

    const response = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: request.systemPrompt },
          ...request.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        ],
        options: {
          temperature: request.temperature ?? 0.7,
          num_predict: request.maxTokens ?? 4096,
        },
        ...(request.responseFormat === "json" ? { format: "json" } : {}),
      }),
    });

    if (!response.ok) {
      return Err({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `Ollama returned ${response.status}: ${await response.text()}`,
      });
    }

    const data = (await response.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return Ok({
      content: data.message?.content ?? "",
      model,
      provider: "ollama",
      usage: {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
      },
      latencyMs: Date.now() - startTime,
    });
  }
}

// ─── Pre-configured Routing Rules ───────────────────────────────────────────

/** Route short classification tasks to the fastest model. */
export const CLASSIFICATION_RULE: RoutingRule = {
  name: "classification_to_haiku",
  condition: (req) =>
    (req.maxTokens !== undefined && req.maxTokens <= 200) ||
    req.responseFormat === "json",
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
};

/** Route complex reasoning to the most capable model. */
export const REASONING_RULE: RoutingRule = {
  name: "reasoning_to_sonnet",
  condition: (req) =>
    req.messages.some((m) => m.content.length > 2000) ||
    (req.maxTokens !== undefined && req.maxTokens > 2000),
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
};
