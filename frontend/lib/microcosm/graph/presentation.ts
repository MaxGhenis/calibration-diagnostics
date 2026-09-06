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
  ProjectionBasis,
  ReceiptGraphNode,
} from "./types";

export const NODE_WIDTH = 184;
export const NODE_HEIGHT = 76;

export interface AxisReading {
  label: string;
  tone: StatusTone;
  help: string;
}

/** Reached only if a member is added to one of these unions and left unworded.
 * The `never` parameter makes that a compile error at the call site; the throw
 * is what happens if a value arrives from outside the type system anyway,
 * because guessing a reading for a state nobody worded is how a step gets
 * described as something it is not. */
function unread(state: never, axis: string): never {
  throw new Error(`No reading is defined for this ${axis}: ${String(state)}.`);
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

/** A gate reading belongs to the receipt that recorded it.
 *
 * Every declared state is named. There is no `default` here on purpose: the
 * mislabel this axis was fixed for — `not_applicable` folded into the passing
 * case — is exactly what a fallback branch hides, so a member added to
 * `GateState` and not handled is a compile error at `unread` below rather than
 * a member silently read as something else. */
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
        // The producer groups this outcome with a pass as certifying, so it is
        // not a failure and does not enter the run's failure list. It still
        // attested nothing about this step, which is why it is not shown as a
        // pass either.
        help: "This step's gate recorded that it did not apply here. The producer counts that as a certifying outcome, alongside a pass, so it is not a failure; it attested nothing about this step, so it is not a pass.",
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
    case "no_gate_record":
      return {
        label: "No gate record",
        tone: "neutral",
        help: "This step recorded no gate. That is not a pass.",
      };
    default:
      return unread(state, "gate state");
  }
}

/** Whether this reading describes a gate the receipt actually recorded. The
 * canvas marks a card that carries a gate, and that is a question about the
 * record: `not_applicable` is a gate, and it is read in the same neutral tone
 * as the absence of one, so the tone cannot answer it. */
export function gateRecorded(state: GateState): boolean {
  return state !== "no_gate_record";
}

/** Three readings, and only one of them warns. A receipt that recorded no typed
 * or opaque artifact succeeded; it is stated neutrally, and its own words say
 * what it did record. Named exhaustively, for the reason `gateReading` is. */
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
    case "not_usable":
      return {
        label: "Outputs not usable",
        tone: "warning",
        help: state.outputs_reason,
      };
    default:
      return unread(state.outputs, "output state");
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
 *
 * `EligibilityStatus` in the quality contract declares four, and all four are
 * worded here. This candidate's evidence carries only `excluded`; the other
 * three are worded so a candidate published with one of them does not read as a
 * fragment. A status outside the declared four is named as a status rather than
 * dropped into a sentence it does not fit. */
export function releaseEligibilityReading(status: string): string {
  switch (status) {
    case "":
      return "Release eligibility not stated";
    case "eligible":
      return "Eligible for release";
    case "ineligible":
      return "Not eligible for release";
    case "excluded":
      return "Excluded from release";
    case "not_evaluated":
      return "Release eligibility not evaluated";
    default:
      return `Release eligibility: ${status.replaceAll("_", " ")}`;
  }
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

/** Each provenance basis is worded explicitly. A future basis must be reviewed
 * here before the browser can present it as either existing kind of evidence. */
export function projectionBasisReading(basis: ProjectionBasis): string {
  switch (basis) {
    case "local_projection": return "Local receipt projection";
    case "authenticated_attachment": return "Authenticated aggregate graph attachment";
    default: return unread(basis, "projection provenance");
  }
}

/* --------------------------------------------- evidence profile wording */

/** A published token, rendered as words. The token is the publisher's and the
 * only change is the separator, so nothing here interprets an abbreviation and
 * a token this dashboard has never seen still renders as itself rather than as
 * a guess about what it means. */
export function tokenReading(token: string): string {
  return token.replaceAll("_", " ");
}

/** The price basis in words.
 *
 * `tokenReading` is deliberately not used here. It only swaps separators, so it
 * would render the publisher's token as "census ccpiu annual 2024" -- which
 * reads like English while telling a reader nothing, and quietly drops that
 * "ccpiu" is the *chained* CPI-U rather than the CPI-U-RS this profile once
 * wrongly named. A basis is worth naming properly or not at all, so each one is
 * worded explicitly and an unrecognised token throws rather than being guessed
 * at. The publisher's own token and the digest of the contract file it was read
 * from are shown beside this reading, never replaced by it. */
export function priceBasisReading(basis: string, targetYear: string): string {
  switch (basis) {
    case "census_ccpiu_annual_2024":
      return `${targetYear} annual average C-CPI-U dollars`;
    default:
      return unread(basis as never, "price basis");
  }
}

const REPORTED_PREFIX = "asec_reported_";
const PRICE_SUFFIX = "_2024_price";

/** Result columns share a prefix and a suffix. Both are stated once above the
 * group and trimmed here, so each row reads as what distinguishes it; the full
 * identifier is shown beside every trimmed name, so the trim is visible rather
 * than hidden. A column that does not carry them is left alone. */
export function reportedColumnReading(column: string): string {
  const withoutPrefix = column.startsWith(REPORTED_PREFIX)
    ? column.slice(REPORTED_PREFIX.length)
    : column;
  const trimmed = withoutPrefix.endsWith(PRICE_SUFFIX)
    ? withoutPrefix.slice(0, -PRICE_SUFFIX.length)
    : withoutPrefix;
  return tokenReading(trimmed);
}

/** Whole counts only. Every number a profile publishes is a count of rows,
 * columns, households or modules, so none of them is ever fractional. */
export function countReading(value: number): string {
  return value.toLocaleString("en-US");
}

/** A share of a whole, for the width of one segment of a composition bar. Zero
 * counts get no segment at all rather than a hairline that reads as a value. */
export function shareOf(count: number, total: number): number {
  return total > 0 ? (count / total) * 100 : 0;
}
