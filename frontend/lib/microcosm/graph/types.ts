// The contract between the receipt graph route and the view. Everything here is
// safe to send to a browser: aggregate counts, content keys, enumerated states
// and authored sentences. No filesystem path, host, artifact payload, person
// record or individual identifier belongs in any of these shapes.

export const RECEIPT_GRAPH_SCHEMA = "microcosm.dashboard.receipt_graph.v1";
export const RECEIPT_PROJECTION_SCHEMA =
  "microcosm.dashboard.receipt_projection.v1";

/** What a receipt says happened. Ordered by precedence: a failed or blocked
 * receipt, and a node with no receipt at all, all outrank the presence of an
 * output artifact key. */
export type ExecutionState =
  | "failed"
  | "blocked"
  | "recorded"
  | "not_evidenced";

/** Whether the result came out of the cache. Independent of execution state: a
 * cache hit is still a recorded execution, and a computed node is not thereby
 * complete. */
export type CacheState = "hit" | "computed" | "unknown";

/** A gate belongs to the receipt that recorded it and to its declared scope
 * only. Most receipts have none, which is not a pass. Neither is a gate that
 * declared itself not applicable: the producer counts that outcome as
 * certifying, alongside a pass, so it is not a failure, but it attested nothing
 * about the step, so it keeps its own reading rather than borrowing the passing
 * one. Every member here is a declared outcome of the producer's own gate
 * vocabulary; none is invented by this dashboard.
 *
 * Adding a member here is a compile error until it is worded in
 * `presentation.ts`. That is deliberate: a fallback branch is how
 * `not_applicable` came to be read as a pass. */
export type GateState =
  | "pass"
  | "not_applicable"
  | "fail"
  | "no_gate_record"
  | "evidence_absent"
  | "unreached";

/** What this receipt recorded on its output side. Three readings, not two:
 * outputs that may be offered, outputs withheld because this step failed, was
 * never reached or had its own gate refuse them, and the separate case of a
 * receipt that simply declared no typed or opaque artifact. The third is not a
 * warning and is not a claim that the step recorded nothing at all. Worded
 * exhaustively in `presentation.ts` for the same reason `GateState` is. */
export type OutputState = "usable" | "no_typed_artifact" | "not_usable";

/** Whether a mapping to another system exists. Missing is not failure. */
export type MappingState = "present" | "missing" | "conflicting" | "unresolved";

export interface TypedArtifactRef {
  name: string;
  artifact: string;
  type: string | null;
  type_version: number | null;
  artifact_key: string | null;
  numeric: string | null;
  tolerance: number | null;
  producer?: string | null;
  producer_key?: string | null;
}

export interface ReceiptMeasure {
  key: string;
  label: string;
  value: string | number | boolean;
}

export interface ReceiptSourcePin {
  key: string;
  label: string;
  sha256: string;
}

export interface GateCheck {
  name: string;
  passed: boolean | null;
  failures: string[];
  details: { key: string; value: string | number | boolean }[];
}

export interface GateRecord {
  outcome: string | null;
  scope: string | null;
  passed: boolean | null;
  checks: GateCheck[];
}

/** One node's state inside one execution. */
export interface NodeExecutionState {
  mode: string;
  execution: ExecutionState;
  cache: CacheState;
  gate: GateState;
  gate_record: GateRecord | null;
  /** Which of the three output readings this receipt earned. */
  outputs: OutputState;
  /** Outputs are only offered as usable when this receipt's own execution and
   * its own gate allow it. A gate elsewhere in the run never sets this. It is
   * false both for outputs that were withheld and for a receipt that declared
   * no typed or opaque artifact; `outputs` is what tells those apart. */
  outputs_usable: boolean;
  outputs_reason: string;
  node_key: string | null;
  output_keys: { name: string; artifact_key: string | null }[];
  /** Content keys for the population frame and weights this receipt recorded.
   * They are kept per execution, not merged, so a run that used a different
   * frame shows two values rather than one. */
  frame_key: string | null;
  weight_key: string | null;
  wall_time_seconds: number | null;
}

export interface ReceiptGraphNode {
  id: string;
  label: string;
  group: string;
  group_label: string;
  role: string | null;
  kernel_ref: string | null;
  kernel_impl_hash: string | null;
  determinism: string | null;
  numeric: string | null;
  tolerance: number | null;
  runtime_dependencies: string[];
  seed: string | null;
  phase: string | null;
  typed_inputs: TypedArtifactRef[];
  typed_outputs: TypedArtifactRef[];
  opaque_artifact_keys: { name: string; key: string }[];
  column_artifact_counts: { entity: string; count: number }[];
  column_artifact_total: number;
  measures: ReceiptMeasure[];
  source_pins: ReceiptSourcePin[];
  states: NodeExecutionState[];
  /** True when the executions disagree about this node's own identity — its
   * node key, its recorded outputs, or the frame and weight keys it recorded.
   * The per-execution values stay in `states`; nothing is merged away. */
  identity_differs: boolean;
  /** No recorded typed artifact connects this receipt to any other. */
  unconnected: boolean;
}

/** Artifact dependency, documentary citation and semantic alignment are three
 * different claims. Only the first is recorded here, and only from typed
 * artifacts a receipt actually declared. */
export interface ExecutionEdge {
  kind: "execution";
  basis: "typed_artifact";
  from: string;
  to: string;
  modes: string[];
  artifacts: {
    name: string;
    type: string | null;
    type_version: number | null;
    artifact_key: string | null;
  }[];
}

export interface EdgeFamily {
  kind: "provenance" | "semantic_alignment";
  label: string;
  state: MappingState;
  reason: string;
  edges: never[];
}

export interface ExecutionSummary {
  mode: string;
  label: string;
  description: string;
  /** The byte digest of the recorded run manifest. This is what tells two
   * executions apart; the content key does not. */
  manifest_sha256: string;
  content_key: string;
  kernel_calls: number | null;
  computed_count: number;
  cache_hit_count: number;
  receipt_count: number;
  wall_time_seconds: number | null;
}

export interface MappingAxis {
  key: string;
  label: string;
  state: MappingState;
  reason: string;
}

export interface BindingCheck {
  label: string;
  detail: string;
}

export interface ReceiptGraphCoverage {
  complete: boolean;
  basis: string;
  reason: string;
  connected_nodes: number;
  unconnected_nodes: number;
  recorded_edges: number;
}

export interface OutputIdentityComparison {
  identical: boolean;
  compared_nodes: number;
  compared_artifacts: number;
  differences: { id: string; field: string; values: { mode: string; value: string | null }[] }[];
}

export interface ReceiptGraphComparison {
  same_computation_content_key: boolean;
  content_key: string;
  content_key_note: string;
  distinct_executions: boolean;
  /** How this run's executions are headed. Composed with the note below rather
   * than written into the component, so the number of executions is stated in
   * one place and cannot be right in the body and wrong in the heading. */
  title: string;
  execution_note: string;
  output_identity: OutputIdentityComparison;
  cache_differences: {
    id: string;
    label: string;
    states: { mode: string; cache: CacheState }[];
  }[];
}

/* ------------------------------------------------- evidence profiles */

/** A publisher evidence profile is a closed, named extension of the aggregate
 * wire contract: a second export shape whose extra fields are each validated by
 * name before anything here is drawn. It is not a licence for unknown fields,
 * and an attachment that declares none keeps the original contract exactly.
 * `null` on the payload means the attachment declared no profile. */
export interface EvidenceProfileScope {
  households: number;
  persons: number;
  tax_units: number;
  households_by_source_cohort: { income_year: string; households: number }[];
  money_field_axes: number;
  housing_universe_evidence_fields: number;
  housing_universe_carried_cells: number;
  loaded_module_count: number;
  note: string;
}

/** What the publisher says this evidence does not establish. `score` is null by
 * contract: an engineering run measures agreement with no external total, so
 * there is no number to show and none is invented in its place. */
export interface EvidenceProfileQuality {
  status: string;
  basis: string;
  score: null;
  score_reason: string;
  missing: string[];
  note: string;
}

/** What the accounted quantity is: a measure, the nominal amounts it came from,
 * the price target it was restated to, the period it is observed over, and what
 * the residual column does and does not mean. Every member is a published
 * token this reader pins; none is inferred from a column name. */
export interface ReportedIncomeBasis {
  measure: string;
  nominal_source: string;
  price_target: string;
  reference_period: string;
  residual_meaning: string;
  note: string;
}

export interface ReportedIncomeColumn {
  name: string;
  dtype: string;
  sha256: string;
}

export interface ReportedIncomeResult {
  column: string;
  sha256: string;
  negative: number;
  zero: number;
  positive: number;
}

export interface ReportedIncomeZeroOrigin {
  income_year: string;
  classes: { key: string; count: number }[];
  total: number;
}

export interface ReportedIncomeAccounting {
  rows: number;
  accounting_column_count: number;
  accounting_row_bytes: number;
  arithmetic_order: string;
  /** The published arithmetic string split at its own separators. Each entry is
   * one published statement, carried through unaltered. */
  arithmetic_statements: string[];
  columns: ReportedIncomeColumn[];
  results: ReportedIncomeResult[];
  zero_origin: ReportedIncomeZeroOrigin[];
  typed_evidence_axis_count: number;
  raw_public_assistance_evidence_count: number;
  alternative_association_sha256: string;
  alternative_association_differs: boolean;
  basis: ReportedIncomeBasis;
  not_claimed: string[];
}

/** One artifact the direct and graph paths each encoded. The two digests are
 * kept apart rather than forced equal, and `differs` is checked against them
 * rather than believed. */
export interface PathOutputIdentity {
  key: string;
  direct_sha256: string;
  graph_sha256: string;
  differs: boolean;
  body_sha256: string | null;
}

/** One recorded path. The direct path is not a graph execution: it records no
 * execution manifest and no cache reading, and `graph_execution` says so rather
 * than leaving a reader to infer it from empty fields. */
export interface EvidencePath {
  key: string;
  label: string;
  description: string;
  graph_execution: boolean;
  receipt_sha256: string;
  execution_manifest_sha256: string | null;
  computation_content_key: string | null;
  kernel_calls: number | null;
  source_preparation_calls: number;
  cache_hit_count: number | null;
  reported_income_rows: number | null;
  reported_income_body_sha256: string;
  reported_income_payload_sha256: string;
}

export interface EvidenceProfileReading {
  id: string;
  scope: EvidenceProfileScope;
  quality: EvidenceProfileQuality;
  reported_income: ReportedIncomeAccounting;
  path_output_identities: { artifacts: PathOutputIdentity[]; note: string };
  lineage_divergence: { fields: string[]; count: number; note: string };
  paths: EvidencePath[];
  identities: { key: string; sha256: string }[];
}

export type ProjectionBasis = "local_projection" | "authenticated_attachment";

export interface ImplementationSet {
  sha256: string;
  by_node: Record<string, { kernel_ref: string; kernel_impl_hash: string }>;
}

export interface ReceiptGraphAvailable {
  schema_version: typeof RECEIPT_GRAPH_SCHEMA;
  available: true;
  projection: {
    schema_version: string;
    version: number;
    is_publisher_attachment: boolean;
    basis: ProjectionBasis;
    note: string;
    label_basis: string;
  };
  candidate: {
    country: string;
    id: string;
    run_id: string;
    execution_status: string;
    release_eligibility: { status: string; reason: string };
    population: { sha256: string; period: string; entity: string } | null;
    geography: { levels: string[]; vintage?: string } | null;
  };
  binding: {
    candidate_manifest_sha256: string;
    build_evidence_sha256: string;
    population_sha256: string;
    kernel_impl_hash: string | null;
    implementation_set: ImplementationSet | null;
    computation_content_key: string;
    checks: BindingCheck[];
  };
  executions: ExecutionSummary[];
  nodes: ReceiptGraphNode[];
  edges: ExecutionEdge[];
  edge_families: EdgeFamily[];
  coverage: ReceiptGraphCoverage;
  gates: {
    records: number;
    note: string;
  };
  comparison: ReceiptGraphComparison;
  mappings: MappingAxis[];
  /** Present only when the attachment declared a publisher evidence profile.
   * An attachment that declares none, and every checked-in local projection,
   * answer with exactly the payload they answered with before profiles
   * existed -- the key is absent rather than null. */
  evidence_profile?: EvidenceProfileReading;
  limits: string[];
}

export interface ReceiptGraphUnavailable {
  schema_version: typeof RECEIPT_GRAPH_SCHEMA;
  available: false;
  reason: string;
}

export type ReceiptGraphPayload =
  | ReceiptGraphAvailable
  | ReceiptGraphUnavailable;
