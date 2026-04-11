/**
 * Observability — OpenTelemetry-based tracing, metrics, and spans.
 * Every tool call, agent action, and message gets a span.
 * Exportable to Jaeger, Zipkin, Datadog, Azure Monitor, etc.
 */

import {
  trace,
  metrics,
  SpanStatusCode,
  type Tracer,
  type Meter,
  type Span,
  type Counter,
  type Histogram,
} from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { MeterProvider } from "@opentelemetry/sdk-metrics";

// ─── Tracer & Meter Initialization ─────────────────────────────────────────

const SERVICE_NAME = "qdb-agent-framework";

let tracerProvider: NodeTracerProvider | null = null;
let meterProvider: MeterProvider | null = null;

export function initializeObservability(): void {
  if (!tracerProvider) {
    tracerProvider = new NodeTracerProvider();
    tracerProvider.register();
  }

  if (!meterProvider) {
    meterProvider = new MeterProvider();
    metrics.setGlobalMeterProvider(meterProvider);
  }
}

function getTracer(): Tracer {
  return trace.getTracer(SERVICE_NAME, "1.0.0");
}

function getMeter(): Meter {
  return metrics.getMeter(SERVICE_NAME, "1.0.0");
}

// ─── Metrics ────────────────────────────────────────────────────────────────

let _toolInvocationCounter: Counter | null = null;
let _toolLatencyHistogram: Histogram | null = null;
let _messageCounter: Counter | null = null;
let _escalationCounter: Counter | null = null;
let _governanceDenialCounter: Counter | null = null;
let _llmTokenCounter: Counter | null = null;
let _llmLatencyHistogram: Histogram | null = null;

function getToolInvocationCounter(): Counter {
  if (!_toolInvocationCounter) {
    _toolInvocationCounter = getMeter().createCounter("tool_invocations_total", {
      description: "Total number of tool invocations",
    });
  }
  return _toolInvocationCounter;
}

function getToolLatencyHistogram(): Histogram {
  if (!_toolLatencyHistogram) {
    _toolLatencyHistogram = getMeter().createHistogram("tool_latency_ms", {
      description: "Tool execution latency in milliseconds",
      unit: "ms",
    });
  }
  return _toolLatencyHistogram;
}

function getMessageCounter(): Counter {
  if (!_messageCounter) {
    _messageCounter = getMeter().createCounter("messages_total", {
      description: "Total inter-agent messages",
    });
  }
  return _messageCounter;
}

function getEscalationCounter(): Counter {
  if (!_escalationCounter) {
    _escalationCounter = getMeter().createCounter("escalations_total", {
      description: "Total escalations to human",
    });
  }
  return _escalationCounter;
}

function getGovernanceDenialCounter(): Counter {
  if (!_governanceDenialCounter) {
    _governanceDenialCounter = getMeter().createCounter("governance_denials_total", {
      description: "Total governance policy denials",
    });
  }
  return _governanceDenialCounter;
}

function getLLMTokenCounter(): Counter {
  if (!_llmTokenCounter) {
    _llmTokenCounter = getMeter().createCounter("llm_tokens_total", {
      description: "Total LLM tokens consumed",
    });
  }
  return _llmTokenCounter;
}

function getLLMLatencyHistogram(): Histogram {
  if (!_llmLatencyHistogram) {
    _llmLatencyHistogram = getMeter().createHistogram("llm_latency_ms", {
      description: "LLM call latency in milliseconds",
      unit: "ms",
    });
  }
  return _llmLatencyHistogram;
}

// ─── Span Wrappers ──────────────────────────────────────────────────────────

/**
 * Trace a tool invocation with full span attributes.
 */
export async function traceToolInvocation<T>(
  toolId: string,
  agentId: string,
  correlationId: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();

  return tracer.startActiveSpan(`tool.${toolId}`, async (span) => {
    span.setAttribute("tool.id", toolId);
    span.setAttribute("agent.id", agentId);
    span.setAttribute("correlation.id", correlationId);
    span.setAttribute("component", "tool-registry");

    try {
      const result = await fn(span);

      getToolInvocationCounter().add(1, {
        tool_id: toolId,
        agent_id: agentId,
        status: "success",
      });

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.recordException(error instanceof Error ? error : new Error(message));

      getToolInvocationCounter().add(1, {
        tool_id: toolId,
        agent_id: agentId,
        status: "error",
      });

      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Trace an agent message handling.
 */
export async function traceAgentAction<T>(
  agentId: string,
  action: string,
  correlationId: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();

  return tracer.startActiveSpan(`agent.${agentId}.${action}`, async (span) => {
    span.setAttribute("agent.id", agentId);
    span.setAttribute("agent.action", action);
    span.setAttribute("correlation.id", correlationId);
    span.setAttribute("component", "agent-runtime");

    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.recordException(error instanceof Error ? error : new Error(message));
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Trace a message bus publish/request.
 */
export async function traceMessage<T>(
  sourceAgent: string,
  targetAgent: string,
  action: string,
  correlationId: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();

  return tracer.startActiveSpan(`message.${sourceAgent}->${targetAgent}`, async (span) => {
    span.setAttribute("message.source", sourceAgent);
    span.setAttribute("message.target", targetAgent);
    span.setAttribute("message.action", action);
    span.setAttribute("correlation.id", correlationId);
    span.setAttribute("component", "message-bus");

    getMessageCounter().add(1, {
      source_agent: sourceAgent,
      target_agent: targetAgent,
    });

    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Trace an LLM call with token tracking.
 */
export async function traceLLMCall<T>(
  provider: string,
  model: string,
  fn: (span: Span) => Promise<T & { usage?: { inputTokens: number; outputTokens: number } }>,
): Promise<T & { usage?: { inputTokens: number; outputTokens: number } }> {
  const tracer = getTracer();
  const startTime = Date.now();

  return tracer.startActiveSpan(`llm.${provider}.${model}`, async (span) => {
    span.setAttribute("llm.provider", provider);
    span.setAttribute("llm.model", model);
    span.setAttribute("component", "llm-router");

    try {
      const result = await fn(span);

      const latency = Date.now() - startTime;
      getLLMLatencyHistogram().record(latency, { provider, model });

      if (result.usage) {
        getLLMTokenCounter().add(result.usage.inputTokens, {
          provider,
          model,
          direction: "input",
        });
        getLLMTokenCounter().add(result.usage.outputTokens, {
          provider,
          model,
          direction: "output",
        });
        span.setAttribute("llm.tokens.input", result.usage.inputTokens);
        span.setAttribute("llm.tokens.output", result.usage.outputTokens);
      }

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Record a governance denial.
 */
export function recordGovernanceDenial(
  agentId: string,
  toolId: string,
  reason: string,
): void {
  getGovernanceDenialCounter().add(1, {
    agent_id: agentId,
    tool_id: toolId,
    reason,
  });
}

/**
 * Record an escalation event.
 */
export function recordEscalation(
  agentId: string,
  reason: string,
  level: string,
): void {
  getEscalationCounter().add(1, {
    agent_id: agentId,
    escalation_reason: reason,
    autonomy_level: level,
  });
}

/**
 * Record tool execution latency.
 */
export function recordToolLatency(
  toolId: string,
  agentId: string,
  durationMs: number,
  success: boolean,
): void {
  getToolLatencyHistogram().record(durationMs, {
    tool_id: toolId,
    agent_id: agentId,
    status: success ? "success" : "error",
  });
}
