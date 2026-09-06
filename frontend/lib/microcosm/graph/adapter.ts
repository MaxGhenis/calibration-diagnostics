// Turn a checked-in receipt projection into the payload the view draws, but
// only once the projection has been shown to describe the selected immutable
// candidate. The projection is local evidence data, not a publisher attachment,
// so these checks establish agreement with the identities and aggregate fields
// in the authenticated publisher summary, not authentication of complete receipt
// bytes. Other receipt details, including execution byte digests, remain local
// projection assertions. A disagreement makes the run unavailable; unsupported
// typed dependencies are omitted with a reason. No other candidate is substituted.

import { ArtifactError } from "../../cross-dataset/artifact";
import type { CandidateQualityManifest } from "../quality/types";
import {
  RECEIPT_GRAPH_SCHEMA,
  RECEIPT_PROJECTION_SCHEMA,
  type BindingCheck,
  type ImplementationSet,
  type ProjectionBasis,
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
  type EvidenceProfileReading,
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
  evidence_key?: string | null;
  label: string;
  description: string;
  manifest_sha256: string;
  manifest_schema_version?: number | null;
  content_key: string;
  kernel_calls: number | null;
  source_preparation_calls?: number;
  computed_count: number;
  cache_hit_count: number;
  failed_node_ids: string[];
  blocked_node_ids: string[];
  gate_exception_node_ids: string[];
  release_tier?: string | null;
  decision_count?: number | null;
  nodes: ProjectionNode[];
}

export interface ReceiptProjection {
  schema_version: string;
  projection_version: number;
  is_publisher_attachment: boolean;
  basis?: ProjectionBasis;
  implementation_set?: ImplementationSet | null;
  provenance_note: string;
  label_basis: string;
  coverage: { basis: string; complete: boolean; reason: string };
  country: string;
  candidate_release_id: string;
  candidate_manifest_sha256: string;
  run_id: string;
  population_sha256: string;
  build_evidence_sha256: string;
  kernel_impl_hash: string | null;
  computation_content_key: string;
  content_key_note: string;
  /** Only an authenticated attachment that declared a publisher evidence
   * profile carries one. A checked-in local projection never does. */
  evidence_profile?: EvidenceProfileReading | null;
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

function sameDigest(actual: unknown, expected: string | null, description: string) {
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
  gate?: {
    outcome?: unknown;
    scope?: unknown;
    /** The gate's declared capabilities. Only `tolerance_writers` is read, and
     * only to count what the publisher named; nothing here is drawn, and the
     * projection carries no counterpart for any of it. */
    capabilities?: { tolerance_writers?: unknown };
    evidence?: {
      passed?: unknown;
      gates?: Record<string, {
        passed?: unknown;
        failures?: unknown;
        details?: Record<string, unknown>;
      }>;
    };
  };
}

function requireUnique(values: string[], description: string) {
  if (values.some(value => !value) || new Set(values).size !== values.length)
    refuse(`The stored projection has missing or duplicate ${description}.`);
}

/** Check the generator's duplicated state fields without re-deriving the
 * producer's known_failures list. An explicit rejection can set `failed`
 * without being in that list; an executor's unreached record still wins. */
export function verifyExecutionStates(execution: ProjectionExecution) {
  const nodes = new Map(execution.nodes.map(node => [node.id, node]));
  for (const [field, ids] of [
    ["failed", execution.failed_node_ids],
    ["blocked", execution.blocked_node_ids],
    ["gate_exception", execution.gate_exception_node_ids],
  ] as const) {
    requireUnique(ids, `${execution.mode} ${field} node ids`);
    if (ids.some(id => !nodes.get(id)?.[field]) ||
        (field !== "failed" && execution.nodes.some(node => node[field] && !ids.includes(node.id))))
      refuse(`The ${execution.mode} ${field} summary contradicts its node records.`);
  }
  for (const node of execution.nodes) {
    if (node.blocked !== (node.execution_record?.state === "unreached") ||
        node.gate_exception !== (node.execution_record?.state === "gate_exception"))
      refuse(`The ${execution.mode} execution flags for ${node.id} contradict its executor record.`);
  }
}

/** Mirror the generator's reduced gate fields, using only published evidence.
 * Null/empty here mean no recorded verdict/detail, never an inferred pass. */
function publishedGateRecord(gate: NonNullable<BuildEvidenceCheck["gate"]>): GateRecord {
  const passed = gate.evidence?.passed ?? null;
  if (passed !== null && typeof passed !== "boolean")
    refuse("Published gate evidence has an invalid passed value.");
  if ((gate.outcome != null && typeof gate.outcome !== "string") ||
      (gate.scope != null && typeof gate.scope !== "string"))
    refuse("Published gate evidence has an invalid outcome or scope.");
  return {
    outcome: gate.outcome ?? null,
    scope: gate.scope ?? null,
    passed,
    checks: Object.entries(gate.evidence?.gates ?? {}).map(([name, check]) => {
      const checkPassed = check.passed ?? null;
      const failures = check.failures ?? [];
      if ((checkPassed !== null && typeof checkPassed !== "boolean") ||
          !Array.isArray(failures) || failures.some(value => typeof value !== "string"))
        refuse("Published gate check has invalid verdict evidence.");
      return {
        name,
        passed: checkPassed,
        failures,
        details: Object.entries(check.details ?? {})
          .filter(([, value]) => typeof value !== "object")
          .map(([key, value]) => {
            if (!["string", "number", "boolean"].includes(typeof value))
              refuse("Published gate check has invalid detail evidence.");
            return { key, value: value as string | number | boolean };
          }),
      };
    }),
  };
}

function canonicalGateChecks(gate: GateRecord) {
  requireUnique(gate.checks.map(check => check.name), "gate check names");
  return JSON.stringify(gate.checks.map(check => {
    requireUnique(check.details.map(detail => detail.key), "gate detail keys");
    return {
      name: check.name,
      passed: check.passed,
      failures: check.failures,
      details: [...check.details].sort((a, b) => a.key.localeCompare(b.key)),
    };
  }).sort((a, b) => a.name.localeCompare(b.name)));
}

function verifyGate(execution: ProjectionExecution, check: BuildEvidenceCheck) {
  const gates = execution.nodes.filter(node => node.gate !== null);
  if (!check.gate) {
    if (gates.length) refuse(`The ${execution.mode} gate has no published evidence.`);
    return;
  }
  if (gates.length !== 1 || !gates[0].receipt_present || gates[0].role !== "gate")
    refuse(`The ${execution.mode} execution must record the single published gate.`);
  const gate = gates[0].gate!;
  const published = publishedGateRecord(check.gate);
  for (const field of ["outcome", "scope", "passed"] as const)
    if (gate[field] !== published[field])
      refuse(`The ${execution.mode} gate ${field} differs from the one the candidate published.`);
  if (canonicalGateChecks(gate) !== canonicalGateChecks(published))
    refuse(`The ${execution.mode} gate checks differ from the evidence the candidate published.`);
  if (
    (gate.outcome === "pass" &&
      (gate.passed !== true || gate.checks.some(c => c.passed !== true || c.failures.length > 0))) ||
    (gate.outcome === "fail" && gate.passed === true) ||
    // The producer permits diagnostics on these outcomes. Retain the checks
    // without treating them as a gate pass; an affirmative verdict conflicts.
    (["not_applicable", "unreached", "evidence_absent"].includes(gate.outcome ?? "") &&
      gate.passed === true)
  )
    refuse(`The ${execution.mode} gate outcome contradicts its verdict evidence.`);
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
  // The flag above and this basis are two separate claims, and only the flag
  // was pinned. A registered projection declaring `authenticated_attachment`
  // reached `projectionBasisReading`, which labels it an authenticated
  // aggregate graph attachment -- exactly what a local projection is not.
  // Registered projections are local and reviewed, so this is defence in
  // depth; the shipped F001 projection declares no basis at all, and an absent
  // basis still reads as `local_projection` below.
  if (projection.basis !== undefined && projection.basis !== "local_projection")
    refuse("The stored receipt projection claims an authenticated attachment basis.");
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

  if (!projection.executions.length)
    refuse("The stored receipt projection records no executions.");
  requireUnique(projection.executions.map(e => e.mode), "execution modes");
  requireUnique(projection.executions.map(e => e.evidence_key ?? ""), "execution evidence keys");
  requireUnique(projection.executions.map(e => e.manifest_sha256), "execution byte digests");
  // Only publisher checks with a graph content key describe graph executions.
  // The real `direct` check has none and is intentionally not projected.
  const publishedExecutions = Object.entries(
    (buildEvidence.checks ?? {}) as Record<string, BuildEvidenceCheck>,
  ).filter(([, check]) => check?.manifest_sha256 !== undefined);
  if (publishedExecutions.some(([key]) => !projection.executions.some(e => e.evidence_key === key)))
    refuse("The stored receipt projection omits a published graph execution.");

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
        "All recorded receipt implementation hashes agree with the candidate manifest and publisher summary. This checks identity agreement, not authentication of complete receipt bytes.",
    },
  ];

  for (const execution of projection.executions) {
    const check = buildEvidenceCheck(buildEvidence, execution.evidence_key ?? execution.mode);
    sameDigest(execution.content_key, projection.computation_content_key,
      `Projected ${execution.mode} computation content key`);
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
    if (!execution.nodes.some(node => node.receipt_present))
      refuse(`The ${execution.mode} execution records no node receipts.`);
    requireUnique(execution.nodes.map(node => node.id), `${execution.mode} node ids`);
    verifyExecutionStates(execution);
    // These are the generator's recorded cache categories, independent of
    // success, known failures or blocking. Do not reinterpret them as counts
    // of successful work or rewrite the publisher's kernel-call summary.
    const computed = execution.nodes.filter(node => cacheState(node) === "computed").length;
    const hits = execution.nodes.filter(node => cacheState(node) === "hit").length;
    if (typeof check.kernel_calls !== "number" || !Number.isSafeInteger(check.kernel_calls) || check.kernel_calls < 0)
      refuse(`Published build evidence has no usable ${execution.mode} kernel-call count.`);
    if (check.kernel_calls !== computed)
      refuse(
        `Published build evidence reports ${check.kernel_calls} kernel calls for the ${execution.mode} execution, but ${computed} receipts record a computation.`,
      );
    if (execution.computed_count !== computed || execution.cache_hit_count !== hits ||
        execution.kernel_calls !== check.kernel_calls)
      refuse(`The ${execution.mode} projection summary contradicts its receipts or published kernel-call count.`);
    let sourcePins = 0;
    for (const node of execution.nodes) {
      if (node.receipt_present && node.kernel_impl_hash !== projection.kernel_impl_hash)
        refuse(
          `Receipt ${node.id} was produced by an implementation the candidate does not publish.`,
        );
      for (const pin of node.source_pins) {
        const published = check.source_sha256?.[pin.key];
        if (!HEX64.test(pin.sha256) || published !== pin.sha256)
          refuse(
            `The ${pin.label} digest recorded by ${node.id} differs from the one the candidate published.`,
          );
        sourcePins++;
      }
    }
    verifyGate(execution, check);
    checks.push({
      label: `${execution.label} receipts`,
      detail: `${computed} computed and ${hits} served from cache; the computed count matches the published kernel-call count. ${sourcePins} projected source pins agree with the candidate's build evidence.${check.gate ? " The gate outcome, scope, passed verdict and checks agree with the published evidence." : " No gate evidence is published or projected."}`,
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
 * `known_failures`, which is a derived umbrella, not a list of things that
 * failed. In the producer's own `Manifest.known_failures`
 * (`packages/microcosm-graph/src/microcosm/graph/manifest.py`, read on
 * `origin/main` of the local microcosm clone) it collects every gate node whose
 * outcome is outside `_CERTIFYING_GATE_OUTCOMES = {"pass", "not_applicable"}`,
 * plus any node explicitly rejected. `unreached` is outside that set, so a gate
 * the run never reached lands in `known_failures` and, read first, would be
 * reported as a failure. The per-node record is the more specific evidence and
 * is read first instead. A gate exception is the executor's per-node record
 * too, and that one is a real failure.
 *
 * Both manifests this dashboard ships record an empty `known_failures`, so the
 * order is not exercised by the shipped candidate. It is the reading rule, and
 * it is tested against a node carrying both flags. The line numbers the review
 * cited do not match the revision read here, and which revision produced the
 * shipped manifests was not established, so this is the derivation as that file
 * defines it today, not a claim about the run. */
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
    // The producer groups this with a pass as a certifying outcome, so it is
    // not a failure and does not enter `known_failures`. It still attested
    // nothing about this step, so it is not reported as a pass. It refused
    // nothing either, so it withholds no output below.
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

/** Joins a producer id to a consumer id into one map key. Node ids are dotted
 * identifiers, so a character that cannot appear in one keeps the pair
 * unambiguous. It is written as an escape on purpose: the byte itself, typed
 * into the source, makes this whole file read as binary to `file`, to `grep -I`
 * and to anything else that stops at the first NUL, which silently removes the
 * module from a reviewer's search results. The string built here is the same
 * either way. */
export const PAIR_SEPARATOR = "\u0000";

/** Edges come only from typed artifact inputs a receipt actually declared, and
 * only when the named producer is a receipt in the same execution whose own key
 * and declared output artifact/key/type/version agree with the input. Missing
 * or ambiguous evidence is dropped rather than turned into a structural edge. */
function recordedEdges(projection: ReceiptProjection): {
  edges: ExecutionEdge[];
  dropped: string[];
} {
  const byPair = new Map<string, ExecutionEdge>();
  const dropped: string[] = [];
  for (const execution of projection.executions) {
    const producers = new Map(execution.nodes.map((node) => [node.id, node]));
    for (const node of execution.nodes) {
      if (!node.receipt_present) continue;
      for (const input of node.typed_inputs) {
        if (!input.name || node.typed_inputs.filter(entry => entry.name === input.name).length !== 1) {
          dropped.push(`${execution.mode}: ${node.id} recorded an ambiguous input slot ${input.name}.`);
          continue;
        }
        const producer = input.producer;
        const receipt = producer ? producers.get(producer) : undefined;
        if (!producer || !receipt?.receipt_present) {
          dropped.push(
            `${execution.mode}: ${node.id} names producer ${producer ?? "(none)"}, which has no receipt in this execution.`,
          );
          continue;
        }
        if (!input.producer_key || !HEX64.test(input.producer_key) || receipt.node_key !== input.producer_key) {
          dropped.push(
            `${execution.mode}: ${node.id} ${input.producer_key ? "recorded a different key" : "recorded no key"} for producer ${producer}.`,
          );
          continue;
        }
        // `name` is the consumer's local slot; `artifact` identifies the
        // producer's declaration and need not have the same local name.
        const outputs = receipt.typed_outputs.filter(output => output.artifact === input.artifact);
        const output = outputs[0];
        if (outputs.length !== 1 || !input.artifact || !input.artifact_key ||
            !HEX64.test(input.artifact_key) || !input.type || !Number.isSafeInteger(input.type_version) ||
            input.type_version === null || input.type_version < 1 ||
            output.artifact_key !== input.artifact_key || output.type !== input.type ||
            output.type_version !== input.type_version) {
          dropped.push(`${execution.mode}: ${node.id} input ${input.name} has no unique matching artifact key, type and version declared by producer ${producer}.`);
          continue;
        }
        const pair = `${producer}${PAIR_SEPARATOR}${node.id}`;
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
        if (!existing.artifacts.some((entry) => entry.name === artifact.name &&
            entry.artifact_key === artifact.artifact_key && entry.type === artifact.type &&
            entry.type_version === artifact.type_version))
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

/* ------------------------------------------------------------------ wording */

/** Small counts read as words in these sentences, which are prose rather than
 * a table; anything larger reads as a figure. Exported so a test asserts the
 * same spelling the sentence uses instead of writing the word out again. */
export const COUNT_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

function countWord(value: number): string {
  return COUNT_WORDS[value] ?? value.toLocaleString("en-US");
}

function opening(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

function plural(count: number, singular: string, suffix = "s"): string {
  return count === 1 ? singular : `${singular}${suffix}`;
}

/** A status the publisher recorded, said plainly. The reader's manifest is
 * validated against a closed vocabulary before it reaches here, so this is not
 * where an unknown value is caught; it is where an empty one stops reading as
 * a missing word in a sentence. */
function statedAs(value: string): string {
  return value.trim() ? value.replaceAll("_", " ") : "not stated";
}

/** How many kernel calls the publisher recorded, without saying which
 * execution is which. That pairing is this projection's, not the publisher's,
 * and this clause is about what the publisher bound. */
function kernelCallClause(counts: number[]): string {
  const calls = (value: number) =>
    value === 0
      ? "no kernel calls"
      : `${countWord(value)} ${plural(value, "kernel call")}`;
  if (counts.length === 1) return `computing ${calls(counts[0])}`;
  const each = counts.map((value) =>
    value === 0 ? "one computing none" : `one computing ${calls(value)}`,
  );
  return `${each.slice(0, -1).join(", ")} and ${each[each.length - 1]}`;
}

/** The publisher's per-execution kernel-call counts, or nothing when any of
 * them is not a count. Verification forces each to equal the published figure,
 * so this guard only holds for a caller that skipped it. */
function publishedKernelCalls(projection: ReceiptProjection): number[] | null {
  const counts = projection.executions.map((execution) => execution.kernel_calls);
  return counts.every(
    (value): value is number =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
  )
    ? counts
    : null;
}

/** A column name's entity, when every named column shares one and it is a
 * plain identifier. Anything else is left unnamed rather than pasted into a
 * sentence: this string is derived from publisher bytes and ends up in a
 * response body, so it may not carry a path, a host or punctuation. */
const ENTITY = /^[a-z][a-z0-9_]*$/;

function sharedEntity(columns: string[]): string | null {
  const entities = new Set(
    columns.map((column) =>
      column.includes(".") ? column.slice(0, column.indexOf(".")) : "",
    ),
  );
  const only = entities.size === 1 ? [...entities][0] : "";
  return ENTITY.test(only) ? only : null;
}

/** The one slice of column ownership the publisher binds: for each column
 * inside a gate's declared tolerance scope, which steps wrote it. It is read
 * from the build evidence because the projection carries no counterpart, and
 * it is read only to say how much of it there is — this view draws none of it.
 *
 * A column counts only when the record actually names a writing step for it.
 * An absent, empty or unreadable record therefore yields nothing, and the
 * sentence built from this says the publisher named none rather than guessing
 * at a number. Nothing here refuses: this is a count for a sentence, not an
 * identity the run is bound by, and a candidate whose gate capabilities cannot
 * be parsed is still a candidate whose receipts were verified. */
export function publishedToleranceColumns(
  projection: ReceiptProjection,
  buildEvidence: Record<string, unknown>,
): string[] {
  const columns = new Set<string>();
  for (const execution of projection.executions) {
    if (projection.is_publisher_attachment) continue;
    const writers = buildEvidenceCheck(buildEvidence, execution.evidence_key ?? execution.mode)
      .gate?.capabilities?.tolerance_writers;
    if (!writers || typeof writers !== "object" || Array.isArray(writers)) continue;
    for (const [column, steps] of Object.entries(
      writers as Record<string, unknown>,
    ))
      if (
        column &&
        Array.isArray(steps) &&
        steps.length &&
        steps.every((step) => typeof step === "string" && step.length > 0)
      )
        columns.add(column);
  }
  return [...columns].sort();
}

/** A published descriptor is not a loaded artifact or a node-level mapping. */
function attachmentMapping(
  manifest: CandidateQualityManifest,
  name: string,
  label: string,
): Pick<MappingAxis, "state" | "reason"> {
  const attachment = manifest.attachments[name];
  if (!attachment || attachment.status === "missing")
    return {
      state: "missing",
      reason: attachment?.reason ?? "The selected candidate publishes no evidence of this kind.",
    };
  if (attachment.status === "available")
    return {
      state: "unresolved",
      reason: `The candidate manifest declares an available ${label} attachment. This graph view has not loaded its contents or mapped it to steps.`,
    };
  return {
    state: "unresolved",
    reason: `The candidate manifest records this attachment as ${attachment.status}. ${attachment.reason ?? "No graph mapping has been established."}`,
  };
}

/**
 * Build the payload the view draws. Callers must have verified the binding
 * first; this function assumes it and does not re-derive identity.
 *
 * The build evidence is taken for the sentences that state what the publisher
 * bound — how many executions it records, how many kernel calls each computed,
 * and how many columns its gate capabilities name a writer for. Those numbers
 * have no counterpart in the projection, and stating them from anywhere else
 * would be describing this run from memory. Nothing structural is read from it
 * here and no edge is drawn from it.
 */
export function buildReceiptGraph(
  projection: ReceiptProjection,
  manifest: CandidateQualityManifest,
  buildEvidence: Record<string, unknown>,
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
      receipt_count: execution.nodes.filter(node => node.receipt_present).length,
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

  // Everything the sentences below state about this run, read from the run.
  // Each of these was a literal until it was derived, and each was true only
  // of the one projection registered at the time.
  const executionCount = executions.length;
  const kernelCalls = publishedKernelCalls(projection);
  const toleranceColumns = publishedToleranceColumns(projection, buildEvidence);
  const toleranceEntity = sharedEntity(toleranceColumns);
  const projectedSourcePins = projection.executions.reduce(
    (total, execution) =>
      total +
      execution.nodes.reduce((count, node) => count + node.source_pins.length, 0),
    0,
  );

  const mappings: MappingAxis[] = [
    {
      key: "calibration",
      label: "Calibration diagnostic",
      ...attachmentMapping(manifest, "calibration_diagnostics", "calibration diagnostic"),
    },
    {
      key: "target_binding",
      label: "Target and measurement binding",
      state: "unresolved",
      reason:
        "This graph view records no link from a calibration target or measurement to a step; it has not inspected calibration attachment contents.",
    },
    {
      key: "chronicle_fact",
      label: "Chronicle published fact",
      state: "unresolved",
      reason:
        "This graph view records no link from a step to a Chronicle fact and has not inspected attachment contents for fact metadata. Nothing here is ingested into Chronicle.",
    },
    {
      key: "concept_alignment",
      label: "Semantic concept alignment",
      state: "unresolved",
      reason:
        "This graph view records no semantic concept alignment; it does not infer one from an attachment or a stage name.",
    },
    {
      key: "cross_dataset",
      label: "Cross-dataset evaluation",
      ...attachmentMapping(manifest, "cross_dataset", "cross-dataset evaluation"),
    },
  ];

  const basis = projection.basis ?? "local_projection";
  const attached = basis === "authenticated_attachment";
  const limits = [
    projection.coverage.reason,
    // The compiled structural declaration is not missing from the world; it is
    // missing from anything the publisher pinned. Saying "unpinned, so unused"
    // is the accurate scope limitation, and it is the reason two relationships
    // this run does have — the boundary step's base and the gate step's
    // population — are absent from the canvas.
    ...(attached ? [] : ["The producer also compiles a structural declaration of the graph, holding the base and population relationships, the column-level flow and the source edges that a run manifest does not carry. No publisher attachment pins its bytes, so this view neither reads it nor draws from it: the relationships it records are absent here, not absent from the run."]),
    // Read from the publisher's gate capabilities, not from this candidate. A
    // run whose gates name no writer for any column gets the second sentence,
    // because there is then no published slice to point at.
    ...(attached ? [] : [toleranceColumns.length
      ? `One narrow slice of column ownership is published: the build evidence names, for the ${countWord(toleranceColumns.length)} ${toleranceEntity ? `${toleranceEntity} ` : ""}${plural(toleranceColumns.length, "column")} inside the ${gateRecords.length === 1 ? "gate's declared tolerance scope" : "gates' declared tolerance scopes"}, which steps wrote each of them. It is not drawn either, because it describes that scope rather than the graph.`
      : "No column ownership is published alongside that declaration: the build evidence records no writer for any column inside a gate's declared tolerance scope, so nothing here names which step wrote a column."]),
    "Stage names are plain renderings of the native node ids, which are shown next to them.",
    "Cache state, execution state and gate state are read separately. A gate covers only its own declared scope and attests to nothing else in the run.",
    `Recorded execution and release eligibility are separate readings: the candidate manifest records this run's execution as ${statedAs(manifest.execution_status)} and its release eligibility as ${statedAs(manifest.release_eligibility.status)}.`,
    "The numeric-reproducibility platform tag recorded on each artifact is deliberately not carried into this view.",
    // Precise in both directions. How many executions there were, and how many
    // kernel calls each computed, is the publisher's own record: one check
    // block per execution, and verification refuses a projection whose counts
    // disagree with them. What this projection asserts is only the pairing:
    // which recorded manifest bytes belong to which of them. The evidence's own
    // manifest digest is the shared content key, so it pins no byte digest.
    // The closing clause names source digests only where receipts declared a
    // source pin for that binding to have happened to.
    attached
      ? "The authenticated publisher attachment declares aggregate graph structure. The build summary binds each exact execution-manifest byte digest separately from its computation content key. These are pointers to recorded raw execution evidence; this dashboard has not independently interpreted those raw manifest bytes or recomputed array parity. Source preparation is a separate recorded call count, never a graph node. No scientific gate is inferred from parity or cache equality."
      : `The publisher's build evidence records ${countWord(executionCount)} ${plural(executionCount, "execution")} of this run${kernelCalls ? `, ${kernelCallClause(kernelCalls)}` : ""}. It does not pin ${executionCount === 1 ? "the recorded run manifest's" : executionCount === 2 ? "either recorded run manifest's" : "any recorded run manifest's"} byte digest — its own manifest digest is the content key ${executionCount === 1 ? "it uses" : "they share"} — so which bytes shown here belong to ${executionCount === 1 ? "that execution" : "which execution"} is paired by this projection, not published. The population, implementation${projectedSourcePins ? ", content-key and source digests" : " and content-key digests"} checked above are bound by that same build evidence.`,
    ...(divergentPins.length
      ? [
          `The recorded executions disagree about the frame or weight key on ${divergentPins.join(", ")}. All readings are kept.`,
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
      is_publisher_attachment: projection.is_publisher_attachment,
      basis,
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
      implementation_set: projection.implementation_set ?? null,
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
      complete: projection.coverage.complete && dropped.length === 0,
      basis: projection.coverage.basis,
      reason: projection.coverage.reason,
      connected_nodes: nodes.filter((node) => !node.unconnected).length,
      unconnected_nodes: nodes.filter((node) => node.unconnected).length,
      recorded_edges: edges.length,
    },
    gates: {
      records: gateRecords.length,
      // Counted, and keyed off the count. Keyed off the declared scopes, a
      // gate that recorded an outcome without one produced `records: 1` beside
      // the sentence "No gate record in this run" — the payload contradicting
      // itself. A gate is still a gate record when it declared no scope.
      note: gateRecords.length
        ? `${opening(countWord(gateRecords.length))} ${plural(gateRecords.length, "gate record")} in this run, ${gateScopes.length ? `scoped to ${gateScopes.join(", ")}` : "with no declared scope"}. ${gateRecords.length === 1 ? "It attests to its own scope" : "They attest to their own scopes"} and to nothing else here.`
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
      // The card's own heading, composed here rather than in the component, so
      // one run's execution count is stated in one place. Verification has
      // already forced the byte digests apart and the content keys together,
      // so the only thing that varies between runs is how many there were.
      title:
        executionCount === 1
          ? "One recorded execution"
          : `Same computation, ${countWord(executionCount)} executions`,
      execution_note:
        attached
          ? `The publisher authenticates ${countWord(executionCount)} recorded ${plural(executionCount, "execution")} with distinct execution-manifest byte digests and a shared computation content key${kernelCalls ? `, ${kernelCallClause(kernelCalls)}` : ""}. The build summary binds both identities for each execution. This authenticates aggregate evidence and its declared pointers; the browser does not independently interpret the raw execution manifests.`
          : executionCount === 1
          ? `One recorded run manifest, so this is a single recorded execution${kernelCalls ? `, ${kernelCallClause(kernelCalls)}` : ""}. The publisher's build evidence carries one check for it. What it does not pin is that manifest's bytes: its own manifest digest is the content key, so which bytes belong to this execution is paired by this projection.`
          : `The recorded run manifests have different byte digests, so these are ${countWord(executionCount)} executions; the shared content key says the computation and its outputs were the same. That there were ${countWord(executionCount)} is also the publisher's own record — its build evidence carries a check for each${kernelCalls ? `, ${kernelCallClause(kernelCalls)}` : ""}. What it does not pin is ${executionCount === 2 ? "either" : "any"} manifest's bytes: its own manifest digest is the content key they share, so which bytes belong to which execution is paired by this projection.`,
      output_identity: comparison,
      cache_differences: cacheDifferences,
    },
    mappings,
    ...(projection.evidence_profile ? { evidence_profile: projection.evidence_profile } : {}),
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
