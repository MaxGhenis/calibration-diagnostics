// Turn a checked-in receipt projection into the payload the view draws, but
// only once the projection has been shown to describe the selected immutable
// candidate. The projection is local evidence data, not a publisher attachment,
// so it earns nothing on its own: every identity it claims is re-checked here
// against the candidate manifest the reader authenticated and against the
// publisher's own build-evidence attachment. A single disagreement makes the
// run unavailable; nothing falls back to another candidate's graph.

import { ArtifactError } from "../../cross-dataset/artifact";
import type { CandidateQualityManifest } from "../quality/types";
import {
  RECEIPT_GRAPH_SCHEMA,
  RECEIPT_PROJECTION_SCHEMA,
  type BindingCheck,
  type CacheState,
  type ExecutionEdge,
  type ExecutionState,
  type ExecutionSummary,
  type GateRecord,
  type GateState,
  type MappingAxis,
  type NodeExecutionState,
  type OutputState,
  type ReceiptGraphAvailable,
  type ReceiptGraphNode,
  type TypedArtifactRef,
} from "./types";

/** The shape of the checked-in projection, as `build-receipt-projection.mjs`
 * writes it. Only the fields the dashboard uses are declared. */
export interface ProjectionNode {
  id: string;
  label: string;
  group: string;
  group_label: string;
  role: string | null;
  receipt_present: boolean;
  failed: boolean;
  blocked: boolean;
  gate_exception: boolean;
  execution_record: {
    state: string | null;
    blocked_by: { node: string; key: string }[];
    unavailable_artifacts: string[];
  } | null;
  receipt_outcome: string | null;
  cache: "hit" | "computed";
  node_key: string | null;
  kernel_ref: string | null;
  kernel_impl_hash: string | null;
  determinism: string | null;
  numeric: string | null;
  tolerance: number | null;
  runtime_dependencies: string[];
  seed: string | null;
  wall_time_seconds: number | null;
  frame_key: string | null;
  weight_key: string | null;
  phase: string | null;
  typed_inputs: TypedArtifactRef[];
  typed_outputs: TypedArtifactRef[];
  opaque_artifact_keys: { name: string; key: string }[];
  column_artifact_counts: { entity: string; count: number }[];
  column_artifact_total: number;
  gate: GateRecord | null;
  source_pins: { key: string; label: string; sha256: string }[];
  measures: { key: string; label: string; value: string | number | boolean }[];
}

export interface ProjectionExecution {
  mode: string;
  evidence_key: string;
  label: string;
  description: string;
  manifest_sha256: string;
  manifest_schema_version: number | null;
  content_key: string;
  kernel_calls: number | null;
  computed_count: number;
  cache_hit_count: number;
  failed_node_ids: string[];
  blocked_node_ids: string[];
  gate_exception_node_ids: string[];
  release_tier: string | null;
  decision_count: number;
  nodes: ProjectionNode[];
}

export interface ReceiptProjection {
  schema_version: string;
  projection_version: number;
  is_publisher_attachment: boolean;
  provenance_note: string;
  label_basis: string;
  coverage: { basis: string; complete: boolean; reason: string };
  country: string;
  candidate_release_id: string;
  candidate_manifest_sha256: string;
  run_id: string;
  population_sha256: string;
  build_evidence_sha256: string;
  kernel_impl_hash: string;
  computation_content_key: string;
  content_key_note: string;
  executions: ProjectionExecution[];
}

/** A verification that did not hold. The caller turns this into an explicit
 * "unavailable" answer rather than an error page, because a candidate the
 * dashboard cannot vouch for is a normal state, not a fault. */
export class ReceiptGraphUnavailableError extends Error {}

function refuse(reason: string): never {
  throw new ReceiptGraphUnavailableError(reason);
}

const HEX64 = /^[a-f0-9]{64}$/;

function sameDigest(actual: unknown, expected: string, description: string) {
  if (typeof actual !== "string" || actual !== expected)
    refuse(`${description} does not match the selected candidate.`);
}

/** The publisher's build evidence, read through the existing verified attachment
 * reader. Only the fields this feature checks are named. */
export interface BuildEvidenceCheck {
  manifest_sha256?: unknown;
  implementation_sha256?: unknown;
  population_sha256?: unknown;
  kernel_calls?: unknown;
  release_eligible?: unknown;
  source_sha256?: Record<string, unknown>;
  gate?: { outcome?: unknown; scope?: unknown };
}

export function buildEvidenceCheck(
  evidence: Record<string, unknown>,
  key: string,
): BuildEvidenceCheck {
  const checks = evidence.checks;
  const check =
    checks && typeof checks === "object"
      ? (checks as Record<string, unknown>)[key]
      : undefined;
  if (!check || typeof check !== "object")
    refuse(`Published build evidence records no ${key} execution.`);
  return check as BuildEvidenceCheck;
}

/**
 * Everything that has to agree before a single node is drawn. Returns the
 * sentences the view shows under "what was checked"; throws
 * ReceiptGraphUnavailableError on the first disagreement.
 */
export function verifyProjectionBinding(
  projection: ReceiptProjection,
  manifest: CandidateQualityManifest,
  requestedManifestSha256: string,
  buildEvidence: Record<string, unknown>,
): BindingCheck[] {
  if (projection.schema_version !== RECEIPT_PROJECTION_SCHEMA)
    refuse("The stored receipt projection uses an unsupported schema.");
  if (projection.is_publisher_attachment !== false)
    refuse("The stored receipt projection claims to be a publisher attachment.");
  if (projection.country !== manifest.country)
    refuse("The stored receipt projection is for a different country.");
  if (projection.candidate_release_id !== manifest.candidate_release_id)
    refuse("The stored receipt projection is for a different candidate.");
  sameDigest(
    projection.candidate_manifest_sha256,
    requestedManifestSha256,
    "Receipt projection candidate manifest digest",
  );
  if (projection.run_id !== manifest.run_id)
    refuse("The stored receipt projection names a different build run.");
  if (!manifest.population)
    refuse("The selected candidate published no population identity.");
  sameDigest(
    projection.population_sha256,
    manifest.population.sha256,
    "Receipt projection population digest",
  );
  const implementation = manifest.provenance.source_implementation_sha256;
  if (!implementation)
    refuse(
      "The selected candidate does not publish the source implementation hash its receipts would have to match.",
    );
  sameDigest(
    projection.kernel_impl_hash,
    implementation,
    "Receipt projection implementation hash",
  );
  if (!HEX64.test(projection.computation_content_key))
    refuse("The stored receipt projection has no usable computation content key.");

  const attachment = manifest.attachments.build_manifest;
  if (!attachment || attachment.status !== "available")
    refuse(
      attachment?.reason ??
        "The selected candidate publishes no build evidence, so its receipts cannot be associated with it.",
    );
  if (attachment.scope !== "run")
    refuse("Build evidence for this candidate is not run-scoped.");
  sameDigest(
    projection.build_evidence_sha256,
    attachment.sha256!,
    "Receipt projection build evidence digest",
  );

  if (buildEvidence.candidate_release_id !== manifest.candidate_release_id)
    refuse("Published build evidence names a different candidate.");
  if (buildEvidence.run_id !== manifest.run_id)
    refuse("Published build evidence names a different build run.");

  const checks: BindingCheck[] = [
    {
      label: "Candidate manifest",
      detail: `Authenticated by its own digest and read for ${manifest.candidate_release_id}.`,
    },
    {
      label: "Build evidence",
      detail:
        "Read through the published run-scoped attachment the candidate manifest binds, and verified against its digest.",
    },
    {
      label: "Population",
      detail:
        "The projection, the candidate manifest and every recorded execution name one population digest.",
    },
    {
      label: "Implementation",
      detail:
        "Every receipt was produced by the source implementation the candidate manifest publishes.",
    },
  ];

  for (const execution of projection.executions) {
    const check = buildEvidenceCheck(buildEvidence, execution.evidence_key);
    sameDigest(
      check.manifest_sha256,
      execution.content_key,
      `Published ${execution.mode} computation content key`,
    );
    sameDigest(
      check.implementation_sha256,
      projection.kernel_impl_hash,
      `Published ${execution.mode} implementation hash`,
    );
    sameDigest(
      check.population_sha256,
      projection.population_sha256,
      `Published ${execution.mode} population digest`,
    );
    if (!HEX64.test(execution.manifest_sha256))
      refuse(`The ${execution.mode} execution has no recorded manifest digest.`);
    const computed = execution.nodes.filter(
      (node) => node.cache === "computed",
    ).length;
    if (typeof check.kernel_calls === "number" && check.kernel_calls !== computed)
      refuse(
        `Published build evidence reports ${check.kernel_calls} kernel calls for the ${execution.mode} execution, but ${computed} receipts record a computation.`,
      );
    for (const node of execution.nodes) {
      if (node.kernel_impl_hash && node.kernel_impl_hash !== projection.kernel_impl_hash)
        refuse(
          `Receipt ${node.id} was produced by an implementation the candidate does not publish.`,
        );
      for (const pin of node.source_pins) {
        const published = check.source_sha256?.[pin.key];
        if (published !== undefined && published !== pin.sha256)
          refuse(
            `The ${pin.label} digest recorded by ${node.id} differs from the one the candidate published.`,
          );
      }
    }
    const gate = execution.nodes.find((node) => node.gate);
    const publishedGate = check.gate;
    if (publishedGate && gate?.gate) {
      if (
        typeof publishedGate.outcome === "string" &&
        publishedGate.outcome !== gate.gate.outcome
      )
        refuse(
          `The ${execution.mode} gate outcome differs from the one the candidate published.`,
        );
      if (
        typeof publishedGate.scope === "string" &&
        publishedGate.scope !== gate.gate.scope
      )
        refuse(
          `The ${execution.mode} gate scope differs from the one the candidate published.`,
        );
    }
    checks.push({
      label: `${execution.label} receipts`,
      detail: `${computed} computed and ${execution.nodes.length - computed} served from cache, matching the published kernel-call count; source digests agree with the candidate's build evidence.`,
    });
  }
  return checks;
}

/** Execution, cache and gate are three separate readings of one receipt.
 * Failure, blocking and absence all outrank the presence of an output.
 *
 * Blocking is read before failure, and the order matters. `blocked` comes from
 * the executor's own per-node record, `receipt.execution.state === "unreached"`
 * — a statement about this node. `failed` comes from the run manifest's
 * `known_failures`, a run-level list carried through as recorded; its
 * derivation belongs to the producer and is not defined here. Where the two
 * disagree about one node, the direct per-node record is the one shown, so a
 * step the executor recorded as never reached reads that way rather than as
 * failed. A gate exception is the executor's per-node record too, and that one
 * is a real failure.
 *
 * Both manifests this dashboard ships record an empty `known_failures`, so the
 * order is not exercised by the shipped candidate. It is the reading rule, and
 * it is tested against a node carrying both flags. */
export function executionState(node: ProjectionNode | undefined): ExecutionState {
  if (!node || !node.receipt_present) return "not_evidenced";
  if (node.gate_exception) return "failed";
  if (node.blocked) return "blocked";
  if (node.failed) return "failed";
  return "recorded";
}

export function cacheState(node: ProjectionNode | undefined): CacheState {
  if (!node || !node.receipt_present) return "unknown";
  return node.cache === "hit" ? "hit" : "computed";
}

/** A gate belongs to the receipt that recorded it. A receipt with no gate has
 * no gate result, which is not the same as passing, and a gate elsewhere in the
 * run says nothing about this one. */
export function gateState(node: ProjectionNode | undefined): GateState {
  if (!node || !node.receipt_present) return "unreached";
  if (!node.gate) return "no_gate_record";
  switch (node.gate.outcome) {
    case "pass":
      return "pass";
    // A gate that declared itself not applicable certified nothing, so it is
    // not reported as a pass. It also refused nothing, so it withholds no
    // output below.
    case "not_applicable":
      return "not_applicable";
    case "fail":
      return "fail";
    case "unreached":
      return "unreached";
    default:
      return "evidence_absent";
  }
}

/** What this receipt recorded on its output side, in three readings rather than
 * two. Only this receipt's own execution and its own gate are consulted.
 *
 * The third reading exists because "this step's outputs were withheld" and
 * "this step declared no typed or opaque artifact" are different facts and were
 * being told to the reader in the same warning words. Two of the six receipts
 * in the only run this dashboard ships are the second kind: they succeeded,
 * their gate passed or they had none, and they simply have nothing this view
 * draws a dependency from. */
export function outputAvailability(node: ProjectionNode | undefined): {
  state: OutputState;
  usable: boolean;
  reason: string;
} {
  const withheld = (reason: string) =>
    ({ state: "not_usable", usable: false, reason }) as const;
  const execution = executionState(node);
  if (execution === "not_evidenced")
    return withheld(
      "No receipt for this step in this execution, so nothing it would produce is evidenced.",
    );
  if (execution === "blocked")
    return withheld(
      `This step was never reached: ${
        node?.execution_record?.blocked_by.map((entry) => entry.node).join(", ") ||
        "its required inputs were unavailable"
      }.`,
    );
  if (execution === "failed")
    return withheld(
      node?.gate_exception
        ? "The gate raised, so the executor recorded its declared outputs as unavailable."
        : "This step is in the run's recorded failures, so its outputs are not usable.",
    );
  const gate = gateState(node);
  if (gate === "fail") return withheld("This step's own gate failed.");
  if (gate === "evidence_absent" || gate === "unreached")
    return withheld("This step's own gate recorded no usable verdict.");
  if (!node?.typed_outputs.length && !node?.opaque_artifact_keys.length) {
    const columns = node?.column_artifact_total ?? 0;
    return {
      state: "no_typed_artifact",
      usable: false,
      // Not "no output". This receipt succeeded; it recorded no typed or opaque
      // artifact, which is what this view draws dependencies from, and it may
      // well have recorded other things. Where it recorded per-column
      // artifacts, say how many rather than imply there were none.
      reason: columns
        ? `This receipt recorded no typed or opaque artifact, which is what a recorded dependency is drawn from. It did record ${columns.toLocaleString("en-US")} per-column artifacts, which the saved manifests do not name a consumer for.`
        : "This receipt recorded no typed or opaque artifact, which is what a recorded dependency is drawn from.",
    };
  }
  return {
    state: "usable",
    usable: true,
    reason:
      "This receipt recorded its own outputs and its own gate, if any, allowed them.",
  };
}

function nodeState(mode: string, node: ProjectionNode | undefined): NodeExecutionState {
  const availability = outputAvailability(node);
  return {
    mode,
    execution: executionState(node),
    cache: cacheState(node),
    gate: gateState(node),
    gate_record: node?.gate ?? null,
    outputs: availability.state,
    outputs_usable: availability.usable,
    outputs_reason: availability.reason,
    node_key: node?.node_key ?? null,
    output_keys: (node?.typed_outputs ?? []).map((output) => ({
      name: output.name,
      artifact_key: output.artifact_key,
    })),
    frame_key: node?.frame_key ?? null,
    weight_key: node?.weight_key ?? null,
    wall_time_seconds: node?.wall_time_seconds ?? null,
  };
}

/** The frame and weight keys a receipt recorded are input-side identity, so
 * they are not part of the output comparison. They still have to be checked:
 * two executions that recorded different frames are not two readings of one
 * step, and the view has to say so rather than show the first one. */
export function pinDifferences(
  projection: ReceiptProjection,
  ids: string[],
): string[] {
  const byMode = new Map(
    projection.executions.map((execution) => [
      execution.mode,
      new Map(execution.nodes.map((node) => [node.id, node])),
    ]),
  );
  return ids.filter((id) =>
    (["frame_key", "weight_key"] as const).some(
      (field) =>
        new Set(
          projection.executions.map(
            (execution) => byMode.get(execution.mode)!.get(id)?.[field] ?? null,
          ),
        ).size > 1,
    ),
  );
}

/** Edges come only from typed artifact inputs a receipt actually declared, and
 * only when the named producer is a receipt in the same execution whose own key
 * is the one the consumer recorded. An input naming an absent or mismatched
 * producer is dropped rather than drawn. */
function recordedEdges(projection: ReceiptProjection): {
  edges: ExecutionEdge[];
  dropped: string[];
} {
  const byPair = new Map<string, ExecutionEdge>();
  const dropped: string[] = [];
  for (const execution of projection.executions) {
    const keys = new Map(execution.nodes.map((node) => [node.id, node.node_key]));
    for (const node of execution.nodes) {
      for (const input of node.typed_inputs) {
        const producer = input.producer;
        if (!producer || !keys.has(producer)) {
          dropped.push(
            `${execution.mode}: ${node.id} names producer ${producer ?? "(none)"}, which has no receipt in this execution.`,
          );
          continue;
        }
        if (input.producer_key && keys.get(producer) !== input.producer_key) {
          dropped.push(
            `${execution.mode}: ${node.id} recorded a different key for producer ${producer}.`,
          );
          continue;
        }
        const pair = `${producer} ${node.id}`;
        const existing = byPair.get(pair);
        const artifact = {
          name: input.name,
          type: input.type,
          type_version: input.type_version,
          artifact_key: input.artifact_key,
        };
        if (!existing) {
          byPair.set(pair, {
            kind: "execution",
            basis: "typed_artifact",
            from: producer,
            to: node.id,
            modes: [execution.mode],
            artifacts: [artifact],
          });
          continue;
        }
        if (!existing.modes.includes(execution.mode))
          existing.modes.push(execution.mode);
        if (!existing.artifacts.some((entry) => entry.name === artifact.name))
          existing.artifacts.push(artifact);
      }
    }
  }
  return { edges: [...byPair.values()], dropped };
}

/** Output-first: the receipts whose typed outputs nothing else consumes come
 * first, then what they were built from, then the receipts no recorded artifact
 * connects to anything. */
export function outputFirstOrder(
  ids: string[],
  edges: ExecutionEdge[],
): string[] {
  const consumed = new Set(edges.map((edge) => edge.from));
  const producers = new Map<string, string[]>();
  const connected = new Set<string>();
  for (const edge of edges) {
    producers.set(edge.to, [...(producers.get(edge.to) ?? []), edge.from]);
    connected.add(edge.to);
    connected.add(edge.from);
  }
  const terminals = ids
    .filter((id) => connected.has(id) && !consumed.has(id))
    .sort();
  const ordered: string[] = [];
  const seen = new Set<string>();
  const queue = [...terminals];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
    for (const producer of (producers.get(id) ?? []).slice().sort())
      if (!seen.has(producer)) queue.push(producer);
  }
  for (const id of ids.filter((id) => connected.has(id)).sort())
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  for (const id of ids.filter((id) => !connected.has(id)).sort())
    ordered.push(id);
  return ordered;
}

function compareOutputs(projection: ReceiptProjection, ids: string[]) {
  const differences: {
    id: string;
    field: string;
    values: { mode: string; value: string | null }[];
  }[] = [];
  let comparedArtifacts = 0;
  const byMode = new Map(
    projection.executions.map((execution) => [
      execution.mode,
      new Map(execution.nodes.map((node) => [node.id, node])),
    ]),
  );
  for (const id of ids) {
    const present = projection.executions.map((execution) => ({
      mode: execution.mode,
      node: byMode.get(execution.mode)!.get(id),
    }));
    const fields: [string, (node: ProjectionNode | undefined) => string | null][] = [
      ["node key", (node) => node?.node_key ?? null],
      [
        "typed outputs",
        (node) =>
          node
            ? node.typed_outputs
                .map((output) => `${output.name}=${output.artifact_key}`)
                .sort()
                .join(" ") || "(none)"
            : null,
      ],
      [
        "opaque artifacts",
        (node) =>
          node
            ? node.opaque_artifact_keys
                .map((entry) => `${entry.name}=${entry.key}`)
                .sort()
                .join(" ") || "(none)"
            : null,
      ],
    ];
    const node = present[0]?.node;
    comparedArtifacts +=
      (node?.typed_outputs.length ?? 0) + (node?.opaque_artifact_keys.length ?? 0);
    for (const [field, read] of fields) {
      const values = present.map((entry) => ({
        mode: entry.mode,
        value: read(entry.node),
      }));
      if (new Set(values.map((entry) => entry.value)).size > 1)
        differences.push({ id, field, values });
    }
  }
  return {
    identical: differences.length === 0,
    compared_nodes: ids.length,
    compared_artifacts: comparedArtifacts,
    differences,
  };
}

/**
 * Build the payload the view draws. Callers must have verified the binding
 * first; this function assumes it and does not re-derive identity.
 */
export function buildReceiptGraph(
  projection: ReceiptProjection,
  manifest: CandidateQualityManifest,
  checks: BindingCheck[],
): ReceiptGraphAvailable {
  const { edges, dropped } = recordedEdges(projection);
  const ids = [
    ...new Set(
      projection.executions.flatMap((execution) =>
        execution.nodes.map((node) => node.id),
      ),
    ),
  ];
  const order = outputFirstOrder(ids, edges);
  const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const byMode = new Map(
    projection.executions.map((execution) => [
      execution.mode,
      new Map(execution.nodes.map((node) => [node.id, node])),
    ]),
  );
  const comparison = compareOutputs(projection, order);
  const divergentPins = pinDifferences(projection, order);
  const identityDiffers = new Set([
    ...comparison.differences.map((difference) => difference.id),
    ...divergentPins,
  ]);

  const nodes: ReceiptGraphNode[] = order.map((id) => {
    // Descriptive fields are taken from the first execution that recorded this
    // receipt; anything the executions disagree about is flagged and kept
    // per-execution rather than merged away.
    const first = projection.executions
      .map((execution) => byMode.get(execution.mode)!.get(id))
      .find(Boolean)!;
    return {
      id,
      label: first.label,
      group: first.group,
      group_label: first.group_label,
      role: first.role,
      kernel_ref: first.kernel_ref,
      kernel_impl_hash: first.kernel_impl_hash,
      determinism: first.determinism,
      numeric: first.numeric,
      tolerance: first.tolerance,
      runtime_dependencies: first.runtime_dependencies,
      seed: first.seed,
      phase: first.phase,
      typed_inputs: first.typed_inputs,
      typed_outputs: first.typed_outputs,
      opaque_artifact_keys: first.opaque_artifact_keys,
      column_artifact_counts: first.column_artifact_counts,
      column_artifact_total: first.column_artifact_total,
      measures: first.measures,
      source_pins: first.source_pins,
      states: projection.executions.map((execution) =>
        nodeState(execution.mode, byMode.get(execution.mode)!.get(id)),
      ),
      identity_differs: identityDiffers.has(id),
      unconnected: !connected.has(id),
    };
  });

  const executions: ExecutionSummary[] = projection.executions.map((execution) => {
    const total = execution.nodes.reduce(
      (sum, node) => sum + (node.wall_time_seconds ?? 0),
      0,
    );
    return {
      mode: execution.mode,
      label: execution.label,
      description: execution.description,
      manifest_sha256: execution.manifest_sha256,
      content_key: execution.content_key,
      kernel_calls: execution.kernel_calls,
      computed_count: execution.computed_count,
      cache_hit_count: execution.cache_hit_count,
      receipt_count: execution.nodes.length,
      wall_time_seconds: total ? Number(total.toFixed(3)) : null,
    };
  });

  const cacheDifferences = nodes
    .filter(
      (node) => new Set(node.states.map((state) => state.cache)).size > 1,
    )
    .map((node) => ({
      id: node.id,
      label: node.label,
      states: node.states.map((state) => ({
        mode: state.mode,
        cache: state.cache,
      })),
    }));

  const gateRecords = nodes.filter((node) =>
    node.states.some((state) => state.gate_record),
  );
  const gateScopes = [
    ...new Set(
      gateRecords.flatMap((node) =>
        node.states
          .map((state) => state.gate_record?.scope)
          .filter((scope): scope is string => Boolean(scope)),
      ),
    ),
  ];

  const missingReason = (name: string) =>
    manifest.attachments[name]?.reason ??
    "The selected candidate publishes no evidence of this kind.";

  const mappings: MappingAxis[] = [
    {
      key: "calibration",
      label: "Calibration diagnostic",
      state: "missing",
      reason: missingReason("calibration_diagnostics"),
    },
    {
      key: "target_binding",
      label: "Target and measurement binding",
      state: "unresolved",
      reason:
        "No target surface is bound to this run, so no step here can be named as the producer or consumer of a calibration target.",
    },
    {
      key: "chronicle_fact",
      label: "Chronicle published fact",
      state: "unresolved",
      reason:
        "No published fact is attached to this run. Nothing here is ingested into, or asserted by, Chronicle.",
    },
    {
      key: "concept_alignment",
      label: "Semantic concept alignment",
      state: "unresolved",
      reason:
        "No concept alignment is recorded for this run, so no encoded legal rule can be linked from it.",
    },
    {
      key: "cross_dataset",
      label: "Cross-dataset evaluation",
      state: "missing",
      reason: missingReason("cross_dataset"),
    },
  ];

  const limits = [
    projection.coverage.reason,
    // The compiled structural declaration is not missing from the world; it is
    // missing from anything the publisher pinned. Saying "unpinned, so unused"
    // is the accurate scope limitation, and it is the reason two relationships
    // this run does have — the boundary step's base and the gate step's
    // population — are absent from the canvas.
    "The producer also compiles a structural declaration of the graph, holding the base and population relationships, the column-level flow and the source edges that a run manifest does not carry. No publisher attachment pins its bytes, so this view neither reads it nor draws from it: the relationships it records are absent here, not absent from the run.",
    "Stage names are plain renderings of the native node ids, which are shown next to them.",
    "Cache state, execution state and gate state are read separately. A gate covers only its own declared scope and attests to nothing else in the run.",
    "Completed execution and release eligibility are separate: this candidate completed and is excluded from release.",
    "The numeric-reproducibility platform tag recorded on each artifact is deliberately not carried into this view.",
    // Everything else in the binding block is re-derived from bytes the
    // publisher attached. This one is not, and the difference is worth stating
    // rather than letting the two sit side by side as if equally evidenced.
    "Two executions are told apart here by the byte digest of each recorded run manifest. Neither manifest byte digest is pinned by anything the publisher attached, so that separation is asserted by this projection. The population, implementation, content-key and source digests checked above are bound by the publisher's own build evidence.",
    ...(divergentPins.length
      ? [
          `The recorded executions disagree about the frame or weight key on ${divergentPins.join(", ")}. Both readings are kept.`,
        ]
      : []),
    ...dropped,
  ];

  return {
    schema_version: RECEIPT_GRAPH_SCHEMA,
    available: true,
    projection: {
      schema_version: projection.schema_version,
      version: projection.projection_version,
      is_publisher_attachment: false,
      note: projection.provenance_note,
      label_basis: projection.label_basis,
    },
    candidate: {
      country: manifest.country,
      id: manifest.candidate_release_id,
      run_id: manifest.run_id,
      execution_status: manifest.execution_status,
      release_eligibility: manifest.release_eligibility,
      population: manifest.population,
      geography: manifest.geography,
    },
    binding: {
      candidate_manifest_sha256: projection.candidate_manifest_sha256,
      build_evidence_sha256: projection.build_evidence_sha256,
      population_sha256: projection.population_sha256,
      kernel_impl_hash: projection.kernel_impl_hash,
      computation_content_key: projection.computation_content_key,
      checks,
    },
    executions,
    nodes,
    edges,
    edge_families: [
      {
        kind: "provenance",
        label: "Documentary citation",
        state: "unresolved",
        reason:
          "No documentary citation is recorded against any receipt in this run, so none is drawn.",
        edges: [],
      },
      {
        kind: "semantic_alignment",
        label: "Semantic alignment",
        state: "unresolved",
        reason:
          "No concept alignment is recorded against any receipt in this run, so none is drawn.",
        edges: [],
      },
    ],
    coverage: {
      complete: projection.coverage.complete,
      basis: projection.coverage.basis,
      reason: projection.coverage.reason,
      connected_nodes: nodes.filter((node) => !node.unconnected).length,
      unconnected_nodes: nodes.filter((node) => node.unconnected).length,
      recorded_edges: edges.length,
    },
    gates: {
      records: gateRecords.length,
      note: gateScopes.length
        ? `One gate record in this run, scoped to ${gateScopes.join(", ")}. It attests to its own scope and to nothing else here.`
        : "No gate record in this run. That is not a pass.",
    },
    comparison: {
      same_computation_content_key:
        new Set(executions.map((execution) => execution.content_key)).size === 1,
      content_key: projection.computation_content_key,
      content_key_note: projection.content_key_note,
      distinct_executions:
        new Set(executions.map((execution) => execution.manifest_sha256)).size ===
        executions.length,
      execution_note:
        "The recorded run manifests have different byte digests, so these are two executions; the shared content key says the computation and its outputs were the same. The digests themselves are asserted by this projection: the publisher's build evidence pins the shared content key, not either manifest's bytes.",
      output_identity: comparison,
      cache_differences: cacheDifferences,
    },
    mappings,
    limits,
  };
}

/** Convenience for callers that would otherwise have to distinguish a refusal
 * from a genuine read failure. */
export function isUnavailable(error: unknown): error is ReceiptGraphUnavailableError {
  return error instanceof ReceiptGraphUnavailableError;
}

export function unavailableReason(error: unknown): string {
  if (isUnavailable(error)) return error.message;
  if (error instanceof ArtifactError) return error.message;
  return "The selected candidate's build receipts could not be read.";
}
