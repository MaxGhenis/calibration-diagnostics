// Presentation rules for the receipt graph: how each separate state axis is
// worded, how the canvas is laid out, and how one hop of recorded dependency is
// read off the edges. Kept out of the component so the wording and the layout
// can be tested without a browser.

import dagre from "dagre";
import type { StatusTone } from "@/components/shared/status-pill";
import type { GraphSelectionReadiness } from "./navigation";
import type {
  CacheState,
  ExecutionEdge,
  ExecutionState,
  GateState,
  NodeExecutionState,
  ReceiptGraphNode,
} from "./types";

export const NODE_WIDTH = 184;
export const NODE_HEIGHT = 76;

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
    case "not_applicable":
      return {
        label: "Gate not applicable",
        tone: "neutral",
        help: "This step's gate recorded that it did not apply here. It certified nothing and withheld nothing.",
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

/** Three readings, and only one of them warns. A receipt that recorded no typed
 * or opaque artifact succeeded; it is stated neutrally, and its own words say
 * what it did record. */
export function outputReading(state: NodeExecutionState): AxisReading {
  switch (state.outputs) {
    case "usable":
      return { label: "Outputs recorded", tone: "info", help: state.outputs_reason };
    case "no_typed_artifact":
      return {
        label: "No typed artifact output",
        tone: "neutral",
        help: state.outputs_reason,
      };
    default:
      return {
        label: "Outputs not usable",
        tone: "warning",
        help: state.outputs_reason,
      };
  }
}

/** The reading for a step this execution has no state for at all. Annotated so
 * the compiler checks it against the contract rather than accepting whatever
 * subset of the fields happens to be written here. */
const NO_STATE_RECORDED: Omit<NodeExecutionState, "mode"> = {
  execution: "not_evidenced",
  cache: "unknown",
  gate: "unreached",
  gate_record: null,
  outputs: "not_usable",
  outputs_usable: false,
  outputs_reason: "No receipt for this step in this execution.",
  node_key: null,
  output_keys: [],
  frame_key: null,
  weight_key: null,
  wall_time_seconds: null,
};

export function stateFor(
  node: ReceiptGraphNode,
  mode: string,
): NodeExecutionState {
  return (
    node.states.find((state) => state.mode === mode) ??
    node.states[0] ?? { mode, ...NO_STATE_RECORDED }
  );
}

/** Release eligibility as a sentence, for whatever the manifest happens to say.
 * The two statuses this evidence uses are worded properly; anything else is
 * named as a status rather than dropped into a sentence it does not fit. */
export function releaseEligibilityReading(status: string): string {
  if (!status) return "Release eligibility not stated";
  if (status === "eligible") return "Eligible for release";
  if (status === "excluded") return "Excluded from release";
  return `Release eligibility: ${status.replaceAll("_", " ")}`;
}

/** What the reader is told when the selection cannot produce a request at all.
 * A selection missing half of its immutable identity leaves the query disabled,
 * so it has to be stated as incomplete rather than left reading as a fetch that
 * never finishes. */
export function selectionNotice(readiness: GraphSelectionReadiness): {
  title: string;
  description: string;
} {
  return readiness === "no_candidate"
    ? {
        title: "No candidate selected",
        description:
          "Build receipts belong to one immutable candidate. Choose one in the population selector above, or follow a candidate link from Quality evidence, and its recorded run appears here.",
      }
    : {
        title: "Incomplete candidate selection",
        description:
          "This link names a candidate but no usable manifest digest. Build receipts are requested by both halves of the immutable identity, so nothing is fetched. Reselect the candidate in the population selector above to restore its manifest digest.",
      };
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
  graph.setGraph({ rankdir: "LR", ranksep: 64, nodesep: 26, marginx: 8, marginy: 8 });
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
      x: index * (NODE_WIDTH + 26) + 8,
      y: bottom + 48,
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
