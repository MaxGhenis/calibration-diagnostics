// Presentation rules for the receipt graph: how each separate state axis is
// worded, how the canvas is laid out, and how one hop of recorded dependency is
// read off the edges. Kept out of the component so the wording and the layout
// can be tested without a browser.

import dagre from "dagre";
import type { StatusTone } from "@/components/shared/status-pill";
import type {
  CacheState,
  ExecutionEdge,
  ExecutionState,
  GateState,
  NodeExecutionState,
  ReceiptGraphNode,
} from "./types";

export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 78;

export interface AxisReading {
  label: string;
  tone: StatusTone;
  help: string;
}

/** What the receipt says happened. Never "passed": a recorded execution is not
 * a verdict. */
export function executionReading(state: ExecutionState): AxisReading {
  switch (state) {
    case "recorded":
      return {
        label: "Receipt recorded",
        tone: "info",
        help: "This execution recorded a receipt for this step.",
      };
    case "failed":
      return {
        label: "Failed",
        tone: "danger",
        help: "The run recorded this step as a failure.",
      };
    case "blocked":
      return {
        label: "Never reached",
        tone: "warning",
        help: "Required inputs were unavailable, so this step did not run.",
      };
    default:
      return {
        label: "Not evidenced",
        tone: "neutral",
        help: "This execution recorded no receipt for this step.",
      };
  }
}

/** Whether the result was reused. Independent of whether the step succeeded. */
export function cacheReading(state: CacheState): AxisReading {
  switch (state) {
    case "hit":
      return {
        label: "Served from cache",
        tone: "neutral",
        help: "The stored result was reused; no kernel call was made.",
      };
    case "computed":
      return {
        label: "Computed",
        tone: "info",
        help: "A kernel call produced this result in this execution.",
      };
    default:
      return {
        label: "Cache state unknown",
        tone: "neutral",
        help: "No receipt in this execution, so there is no cache state.",
      };
  }
}

/** A gate reading belongs to the receipt that recorded it. */
export function gateReading(state: GateState): AxisReading {
  switch (state) {
    case "pass":
      return {
        label: "Gate passed",
        tone: "success",
        help: "This step's own gate passed, within its declared scope.",
      };
    case "fail":
      return {
        label: "Gate failed",
        tone: "danger",
        help: "This step's own gate failed.",
      };
    case "evidence_absent":
      return {
        label: "Gate evidence absent",
        tone: "warning",
        help: "This step's gate recorded no usable verdict.",
      };
    case "unreached":
      return {
        label: "Gate unreached",
        tone: "warning",
        help: "This step's gate did not run.",
      };
    default:
      return {
        label: "No gate record",
        tone: "neutral",
        help: "This step recorded no gate. That is not a pass.",
      };
  }
}

export function outputReading(state: NodeExecutionState): AxisReading {
  return state.outputs_usable
    ? { label: "Outputs recorded", tone: "info", help: state.outputs_reason }
    : { label: "Outputs not usable", tone: "warning", help: state.outputs_reason };
}

export function stateFor(
  node: ReceiptGraphNode,
  mode: string,
): NodeExecutionState {
  return (
    node.states.find((state) => state.mode === mode) ??
    node.states[0] ?? {
      mode,
      execution: "not_evidenced",
      cache: "unknown",
      gate: "unreached",
      gate_record: null,
      outputs_usable: false,
      outputs_reason: "No receipt for this step in this execution.",
      node_key: null,
      output_keys: [],
      wall_time_seconds: null,
    }
  );
}

/** One hop of recorded dependency, in both directions. Only typed artifacts a
 * receipt declared appear here. */
export function neighbours(edges: ExecutionEdge[], id: string) {
  return {
    builtFrom: edges
      .filter((edge) => edge.to === id)
      .map((edge) => edge.from)
      .sort(),
    usedBy: edges
      .filter((edge) => edge.from === id)
      .map((edge) => edge.to)
      .sort(),
  };
}

export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
}

/**
 * Lay the recorded dependencies left to right with Dagre, then set the receipts
 * that no recorded artifact connects to anything in their own row underneath.
 * They are not placed inside the flow, because nothing in the evidence says
 * where in it they belong.
 */
export function layoutReceiptGraph(
  nodes: ReceiptGraphNode[],
  edges: ExecutionEdge[],
): LaidOutNode[] {
  const connected = nodes.filter((node) => !node.unconnected);
  const unconnected = nodes.filter((node) => node.unconnected);
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", ranksep: 96, nodesep: 30, marginx: 8, marginy: 8 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of connected)
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  const ids = new Set(connected.map((node) => node.id));
  for (const edge of edges)
    if (ids.has(edge.from) && ids.has(edge.to)) graph.setEdge(edge.from, edge.to);
  dagre.layout(graph);

  const placed: LaidOutNode[] = connected.map((node) => {
    const laid = graph.node(node.id);
    return {
      id: node.id,
      x: Math.round((laid?.x ?? 0) - NODE_WIDTH / 2),
      y: Math.round((laid?.y ?? 0) - NODE_HEIGHT / 2),
    };
  });
  const bottom = placed.length
    ? Math.max(...placed.map((node) => node.y)) + NODE_HEIGHT
    : 0;
  unconnected.forEach((node, index) => {
    placed.push({
      id: node.id,
      x: index * (NODE_WIDTH + 30) + 8,
      y: bottom + 72,
    });
  });
  return placed;
}

export function formatMeasure(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value.toLocaleString("en-US");
    if (Math.abs(value) >= 1000)
      return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
    return String(Number(value.toPrecision(6)));
  }
  return value;
}

export function shortDigest(value: string | null): string {
  return value ? `${value.slice(0, 12)}…` : "—";
}
