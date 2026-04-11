/**
 * Graph Engine — LangGraph-style stateful workflow orchestration.
 * Supports nodes, edges, conditional branching, cycles, parallel execution,
 * and checkpoint/restore for time-travel debugging.
 *
 * This is the framework's workflow orchestration primitive — agents can define
 * complex multi-step workflows as directed graphs with governed tool calls at each node.
 */

import { v4 as uuidv4 } from "uuid";
import {
  type Result,
  Ok,
  Err,
  ErrorCodes,
} from "./types.js";

// ─── Graph Types ────────────────────────────────────────────────────────────

/** Immutable state snapshot passed between nodes. */
export interface GraphState {
  readonly id: string;
  readonly data: Record<string, unknown>;
  readonly metadata: {
    readonly startedAt: string;
    readonly stepCount: number;
    readonly currentNode: string;
    readonly visitedNodes: readonly string[];
    readonly errors: readonly GraphError[];
  };
}

export interface GraphError {
  readonly nodeId: string;
  readonly message: string;
  readonly timestamp: string;
}

/** A node in the graph — executes a function and returns updated state. */
export interface GraphNode<S extends GraphState = GraphState> {
  readonly id: string;
  readonly name: string;
  readonly execute: (state: S) => Promise<S>;
  readonly retryPolicy?: {
    readonly maxRetries: number;
    readonly backoffMs: number;
  };
}

/** Edge types for controlling flow. */
export type EdgeType = "direct" | "conditional";

export interface DirectEdge {
  readonly type: "direct";
  readonly from: string;
  readonly to: string;
}

export interface ConditionalEdge {
  readonly type: "conditional";
  readonly from: string;
  readonly condition: (state: GraphState) => string; // returns target node ID
  readonly targets: readonly string[];
}

export type GraphEdge = DirectEdge | ConditionalEdge;

/** Checkpoint for time-travel debugging. */
export interface Checkpoint {
  readonly checkpointId: string;
  readonly graphId: string;
  readonly nodeId: string;
  readonly state: GraphState;
  readonly timestamp: string;
  readonly stepNumber: number;
}

/** Graph execution result. */
export interface GraphExecutionResult {
  readonly success: boolean;
  readonly finalState: GraphState;
  readonly checkpoints: readonly Checkpoint[];
  readonly executionTimeMs: number;
  readonly nodesExecuted: readonly string[];
}

// Special node IDs
export const START_NODE = "__start__";
export const END_NODE = "__end__";

// ─── Graph Builder ──────────────────────────────────────────────────────────

export class GraphBuilder<S extends GraphState = GraphState> {
  private nodes = new Map<string, GraphNode<S>>();
  private edges: GraphEdge[] = [];
  private entryPoint: string | null = null;

  addNode(
    id: string,
    name: string,
    execute: (state: S) => Promise<S>,
    retryPolicy?: { maxRetries: number; backoffMs: number },
  ): this {
    this.nodes.set(id, { id, name, execute, retryPolicy });
    return this;
  }

  addEdge(from: string, to: string): this {
    this.edges.push({ type: "direct", from, to });
    return this;
  }

  addConditionalEdge(
    from: string,
    condition: (state: GraphState) => string,
    targets: string[],
  ): this {
    this.edges.push({ type: "conditional", from, condition, targets });
    return this;
  }

  setEntryPoint(nodeId: string): this {
    this.entryPoint = nodeId;
    return this;
  }

  build(): Result<StateGraph<S>> {
    if (!this.entryPoint) {
      return Err({
        code: ErrorCodes.CONFIGURATION_ERROR,
        message: "Graph must have an entry point. Call setEntryPoint().",
      });
    }

    if (!this.nodes.has(this.entryPoint)) {
      return Err({
        code: ErrorCodes.CONFIGURATION_ERROR,
        message: `Entry point "${this.entryPoint}" is not a registered node.`,
      });
    }

    // Validate all edges reference existing nodes
    for (const edge of this.edges) {
      if (edge.from !== START_NODE && !this.nodes.has(edge.from)) {
        return Err({
          code: ErrorCodes.CONFIGURATION_ERROR,
          message: `Edge references unknown source node: "${edge.from}"`,
        });
      }

      if (edge.type === "direct") {
        if (edge.to !== END_NODE && !this.nodes.has(edge.to)) {
          return Err({
            code: ErrorCodes.CONFIGURATION_ERROR,
            message: `Edge references unknown target node: "${edge.to}"`,
          });
        }
      } else {
        for (const target of edge.targets) {
          if (target !== END_NODE && !this.nodes.has(target)) {
            return Err({
              code: ErrorCodes.CONFIGURATION_ERROR,
              message: `Conditional edge references unknown target: "${target}"`,
            });
          }
        }
      }
    }

    return Ok(new StateGraph(
      new Map(this.nodes),
      [...this.edges],
      this.entryPoint,
    ));
  }
}

// ─── State Graph (Executable) ───────────────────────────────────────────────

export class StateGraph<S extends GraphState = GraphState> {
  private readonly nodes: Map<string, GraphNode<S>>;
  private readonly edges: GraphEdge[];
  private readonly entryPoint: string;
  private readonly maxSteps: number;

  constructor(
    nodes: Map<string, GraphNode<S>>,
    edges: GraphEdge[],
    entryPoint: string,
    maxSteps: number = 100,
  ) {
    this.nodes = nodes;
    this.edges = edges;
    this.entryPoint = entryPoint;
    this.maxSteps = maxSteps;
  }

  /**
   * Execute the graph from the entry point.
   * Produces checkpoints at each step for time-travel debugging.
   */
  async execute(initialData: Record<string, unknown>): Promise<Result<GraphExecutionResult>> {
    const startTime = Date.now();
    const graphId = uuidv4();
    const checkpoints: Checkpoint[] = [];
    const nodesExecuted: string[] = [];

    let state = {
      id: graphId,
      data: { ...initialData },
      metadata: {
        startedAt: new Date().toISOString(),
        stepCount: 0,
        currentNode: this.entryPoint,
        visitedNodes: [] as string[],
        errors: [] as GraphError[],
      },
    } as unknown as S;

    let currentNodeId = this.entryPoint;
    let stepCount = 0;

    while (currentNodeId !== END_NODE && stepCount < this.maxSteps) {
      stepCount++;

      const node = this.nodes.get(currentNodeId);
      if (!node) {
        return Err({
          code: ErrorCodes.INTERNAL_ERROR,
          message: `Node "${currentNodeId}" not found during execution.`,
        });
      }

      // Create checkpoint BEFORE execution
      checkpoints.push({
        checkpointId: uuidv4(),
        graphId,
        nodeId: currentNodeId,
        state: structuredClone(state) as S,
        timestamp: new Date().toISOString(),
        stepNumber: stepCount,
      });

      // Execute node with retry
      const maxRetries = node.retryPolicy?.maxRetries ?? 0;
      const backoffMs = node.retryPolicy?.backoffMs ?? 1000;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          state = await node.execute(state);
          nodesExecuted.push(currentNodeId);
          lastError = null;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt < maxRetries) {
            await sleep(backoffMs * Math.pow(2, attempt));
          }
        }
      }

      if (lastError) {
        state = {
          ...state,
          metadata: {
            ...state.metadata,
            errors: [
              ...state.metadata.errors,
              {
                nodeId: currentNodeId,
                message: lastError.message,
                timestamp: new Date().toISOString(),
              },
            ],
          },
        } as S;

        return Ok({
          success: false,
          finalState: state,
          checkpoints,
          executionTimeMs: Date.now() - startTime,
          nodesExecuted,
        });
      }

      // Update state metadata
      state = {
        ...state,
        metadata: {
          ...state.metadata,
          stepCount,
          currentNode: currentNodeId,
          visitedNodes: [...state.metadata.visitedNodes, currentNodeId],
        },
      } as S;

      // Determine next node
      currentNodeId = this.getNextNode(currentNodeId, state);
    }

    if (stepCount >= this.maxSteps) {
      return Err({
        code: ErrorCodes.INTERNAL_ERROR,
        message: `Graph execution exceeded maximum steps (${this.maxSteps}). Possible infinite loop.`,
      });
    }

    // Final checkpoint
    checkpoints.push({
      checkpointId: uuidv4(),
      graphId,
      nodeId: END_NODE,
      state: structuredClone(state) as S,
      timestamp: new Date().toISOString(),
      stepNumber: stepCount + 1,
    });

    return Ok({
      success: true,
      finalState: state,
      checkpoints,
      executionTimeMs: Date.now() - startTime,
      nodesExecuted,
    });
  }

  /**
   * Resume execution from a checkpoint (time-travel).
   */
  async resumeFrom(
    checkpoint: Checkpoint,
    stateOverride?: Partial<Record<string, unknown>>,
  ): Promise<Result<GraphExecutionResult>> {
    const resumeData = {
      ...checkpoint.state.data,
      ...stateOverride,
    };

    // Create a sub-graph starting from the checkpoint's next node
    const nextNode = this.getNextNode(checkpoint.nodeId, checkpoint.state);
    if (nextNode === END_NODE) {
      return Ok({
        success: true,
        finalState: checkpoint.state,
        checkpoints: [checkpoint],
        executionTimeMs: 0,
        nodesExecuted: [],
      });
    }

    // Build new state starting from checkpoint
    const newEntryGraph = new StateGraph(
      this.nodes,
      this.edges,
      nextNode,
      this.maxSteps - checkpoint.stepNumber,
    );

    return newEntryGraph.execute(resumeData);
  }

  /**
   * Visualize the graph as a Mermaid diagram string.
   */
  toMermaid(): string {
    const lines: string[] = ["graph TD"];

    // Nodes
    for (const [id, node] of this.nodes) {
      const shape = id === this.entryPoint ? `([${node.name}])` : `[${node.name}]`;
      lines.push(`    ${id}${shape}`);
    }
    lines.push(`    ${END_NODE}((END))`);

    // Edges
    for (const edge of this.edges) {
      if (edge.type === "direct") {
        lines.push(`    ${edge.from} --> ${edge.to}`);
      } else {
        for (const target of edge.targets) {
          lines.push(`    ${edge.from} -.->|condition| ${target}`);
        }
      }
    }

    return lines.join("\n");
  }

  getNodeIds(): string[] {
    return Array.from(this.nodes.keys());
  }

  private getNextNode(currentNodeId: string, state: GraphState): string {
    // Find edges from current node
    const outEdges = this.edges.filter((e) => e.from === currentNodeId);

    if (outEdges.length === 0) {
      return END_NODE;
    }

    for (const edge of outEdges) {
      if (edge.type === "direct") {
        return edge.to;
      }

      if (edge.type === "conditional") {
        const target = edge.condition(state);
        if (edge.targets.includes(target) || target === END_NODE) {
          return target;
        }
      }
    }

    return END_NODE;
  }
}

// ─── Helper Factories ───────────────────────────────────────────────────────

/**
 * Create initial graph state from data.
 */
export function createGraphState(data: Record<string, unknown>): GraphState {
  return {
    id: uuidv4(),
    data,
    metadata: {
      startedAt: new Date().toISOString(),
      stepCount: 0,
      currentNode: START_NODE,
      visitedNodes: [],
      errors: [],
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
