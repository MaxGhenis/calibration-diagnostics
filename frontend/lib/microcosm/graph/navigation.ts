// Where the reader is in the receipt view, kept in the URL beside the candidate
// so a copied link reopens the same reading.
//
// Two rules hold everything together. The candidate selection is never touched
// here: `execution` and `node` are added to whatever the URL already carries,
// and the global selector clears them by itself when the population changes. And
// a value the current run does not offer is ignored rather than obeyed, so a
// link carrying another candidate's step opens on that candidate's own run
// instead of on an empty inspector.

import {
  candidateReleaseToken,
  parseCandidateToken,
  type QualitySelection,
} from "@/lib/microcosm/quality/selection";

/** Whether the global selection is enough to ask for anything at all. The
 * request needs both halves of the immutable identity, so a URL that carries a
 * candidate and no usable manifest digest is an incomplete selection — a state
 * the reader is told about, not a request left permanently in flight. */
export type GraphSelectionReadiness =
  | "no_candidate"
  | "incomplete_identity"
  | "ready";

/** The identity the request is made with, or nothing. One spelling, used by the
 * query hook and by the view that explains why there is no query, so the two
 * cannot drift apart. */
export function receiptGraphIdentity(selection: QualitySelection) {
  return parseCandidateToken(candidateReleaseToken(selection));
}

export function graphSelectionReadiness(
  selection: QualitySelection,
): GraphSelectionReadiness {
  if (!selection.candidate) return "no_candidate";
  return receiptGraphIdentity(selection) ? "ready" : "incomplete_identity";
}

export interface GraphSelectionRequest {
  execution: string | null;
  node: string | null;
}

export interface GraphSelectionOffer {
  executions: { mode: string }[];
  nodes: { id: string }[];
}

export interface GraphSelection {
  mode: string;
  selectedId: string;
}

export function resolveGraphSelection(
  request: GraphSelectionRequest,
  offer: GraphSelectionOffer | undefined,
): GraphSelection {
  const modes = offer?.executions.map((execution) => execution.mode) ?? [];
  const requestedMode = request.execution ?? "";
  const requestedNode = request.node ?? "";
  return {
    mode: modes.includes(requestedMode) ? requestedMode : (modes[0] ?? ""),
    selectedId: offer?.nodes.some((node) => node.id === requestedNode)
      ? requestedNode
      : "",
  };
}

/** Add or drop the view's own keys, leaving every other parameter — country,
 * candidate, manifest digest, incumbent — exactly as it was.
 *
 * The history API receives the complete URL, preserving the app's base path
 * and fragment without navigating to a different route. This is the same
 * shape `selectionUrl` returns for the candidate selector. */
export function graphSelectionUrl(
  current: string,
  patch: Partial<Record<"execution" | "node", string>>,
): string {
  const url = new URL(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return url.toString();
}

export type StepMove = number | "first" | "last";

/** The step the arrow keys land on. Movement is clamped at both ends rather
 * than wrapping, so holding a key never cycles the reader past where they
 * started. */
export function nextStep(
  order: string[],
  from: string,
  move: StepMove,
): string | undefined {
  if (!order.length) return undefined;
  if (move === "first") return order[0];
  if (move === "last") return order[order.length - 1];
  const index = order.indexOf(from);
  if (index < 0) return order[0];
  return order[Math.min(Math.max(index + move, 0), order.length - 1)];
}
