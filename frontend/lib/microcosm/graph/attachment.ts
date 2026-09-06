// Authenticate publisher aggregate graph receipts and normalize into the existing
// ProjectionExecution/Node path. No raw manifests, source files or array values
// are read here. Shape validation is closed before any publisher text is drawn.
import { createHash } from "node:crypto";
import { COMBINED_AGE_PROFILE, normalizeCombinedAgeAttachment } from "./combined-age";
import { CandidateQualityReader } from "../quality/artifact";
import type { CandidateQualityManifest } from "../quality/types";
import {
  PAIR_SEPARATOR,
  ReceiptGraphUnavailableError,
  cacheState,
  verifyExecutionStates,
  type ProjectionExecution,
  type ReceiptProjection,
} from "./adapter";
import type { BindingCheck, EvidenceProfileReading, ImplementationSet } from "./types";
export const MAX_GRAPH_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const GRAPH_RECEIPTS_SCHEMA = "microcosm.graph_receipts.v1";
const BUILD_SCHEMA = "microcosm.graph_build_summary.v1";
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,159}$/;
const REF = /^[A-Za-z0-9_][A-Za-z0-9_.:@-]{0,159}$/;
const PROVENANCE = [
  "run_head",
  "run_receipt_sha256",
  "runner_sha256",
  "roster_sha256",
  "approval_sha256",
  "exporter_sha256",
  "operator_declaration_sha256",
  "runtime_identity_sha256"
] as const;
type RecordValue = Record<string, any>;
type Check = (value: any) => void;
const refuse = (): never => {
  throw new ReceiptGraphUnavailableError("The selected candidate's graph attachment has malformed or inconsistent aggregate evidence.");
};

const assert = (condition: unknown): void => {
  if (!condition)
    refuse();
};

const object = (value: unknown): RecordValue => {
  assert(value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
  return value as RecordValue;
};

/** Folded before matching, exactly as the exporter's `safe_text` matches
 * against `value.lower()`. The exporter's `/`, `\` and `/users/` markers are
 * covered by the control and separator class below, which rejects both slashes
 * outright; the last three markers are this side's additions and are folded
 * with the rest. Only the comparison is folded: the publisher's own text is
 * returned and rendered exactly as it was published. */
const TEXT_MARKERS = [
  ".local",
  ".h5",
  "macbook",
  "person_id",
  "household_id",
  "_buildo-runtime"
];
const text = (value: unknown, max = 160): void => {
  assert(typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f/\\]/.test(value));
  const folded = (value as string).toLowerCase();
  assert(!TEXT_MARKERS.some(marker => folded.includes(marker)));
};

const id: Check = value => {
  text(value);
  assert(ID.test(value));
};

const digest: Check = value => {
  assert(typeof value === "string" && HEX.test(value));
};

const bool: Check = value => {
  assert(typeof value === "boolean");
};

const count: Check = value => {
  assert(Number.isSafeInteger(value) && value >= 0);
};

const number: Check = value => {
  assert(typeof value === "number" && Number.isFinite(value) && value >= 0);
};

const scalar: Check = value => {
  if (typeof value === "string")
    text(value);
  else
    assert(typeof value === "boolean" || typeof value === "number" && Number.isFinite(value));
};

const nullable = (check: Check): Check => value => {
  if (value !== null)
    check(value);
};

const reason: Check = value => text(value, 2048);
/** One of a closed set. A named function expression, not an arrow, so a refusal
 * from inside it keeps its own frame: `oneOf` beside the enclosing check names
 * both what kind of rule refused and which block it belongs to. */
const enumeration = (...values: unknown[]): Check =>
  function oneOf(value) {
    assert(values.includes(value));
  };
const list = (check: Check, max = 64, min = 0): Check =>
  function boundedList(value) {
    assert(Array.isArray(value) && value.length >= min && value.length <= max);
    value.forEach(check);
  };

function shape(value: unknown, fields: Record<string, Check>): RecordValue {
  const o = object(value);
  assert(Object.keys(o).length === Object.keys(fields).length && Object.keys(o).every(k => Object.hasOwn(fields, k)));
  for (const [key, check] of Object.entries(fields))
    check(o[key]);
  return o;
}

const unique = (values: unknown[]) => assert(new Set(values).size === values.length);
/** One column of a keyed row table, added up. Named and on one line so the frame
 * a refusal carries says which total disagreed. */
const sumOf = (rows: RecordValue[], key: string): number =>
  rows.reduce((total, row) => total + (row[key] as number), 0);
/** Several named columns of one row, added up. Same reason: a total that
 * disagrees should say which total it was. */
const sumKeys = (row: RecordValue, keys: readonly string[]): number =>
  keys.reduce((total, key) => total + (row[key] as number), 0);
/** What the per-node source-pin check actually covered in this execution. The
 * unconditional "source pins agree" sentence was true of the invented fixture
 * and vacuous for the genuine export, whose four receipts declare no pin at
 * all. Zero says so, and still says what was bound, because the two artifacts'
 * source maps are compared whether or not any receipt pins one. */
const sourcePinReading = (pins: number): string =>
  pins === 0
    ? "These receipts declare no per-node source pin; the aggregate source map this attachment carries is the one the build summary carries."
    : pins === 1
      ? "The one recorded node source pin agrees with the bound aggregate source map."
      : `All ${pins} recorded node source pins agree with the bound aggregate source map.`;

/** Typed inputs name a producer recorded in the same execution, so what they
 * declare is a directed graph. The exporter emits its nodes in a strict
 * topological order, but nothing in the wire contract required one, and a
 * cycle was accepted and drawn. The shared renderer is cycle-safe and does not
 * hang; it just picks an arbitrary order for a dependency claim no execution
 * can have produced, so the attachment is refused instead of drawn.
 *
 * The union across executions is checked, because the canvas unions their
 * edges into one graph. Nodes with no typed inputs, nodes nothing consumes and
 * disconnected nodes are all acyclic and unaffected, as are failed, unreached
 * and receipt-absent nodes; none of those readings implies an edge. */
function assertAcyclic(dependencies: Map<string, Set<string>>): void {
  const remaining = new Map([...dependencies].map(([node, producers]) => [node, new Set(producers)]));
  for (let settled = true; settled;) {
    settled = false;
    for (const [node, producers] of remaining)
      if (producers.size === 0) {
        remaining.delete(node);
        for (const rest of remaining.values())
          rest.delete(node);
        settled = true;
      }
  }
  assert(remaining.size === 0);
}
const equal = (a: unknown, b: unknown) => assert(a === b);
const sourceMap: Check = value => {
  const o = object(value);
  assert(Object.keys(o).length <= 64);
  for (const [key, v] of Object.entries(o)) {
    id(key);
    digest(v);
  }
};

function canonical(value: any): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return JSON.stringify(value.map(entry => JSON.parse(canonical(entry))));
  return JSON.stringify(Object.fromEntries(
    Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))]),
  ));
}
function boundedArtifact(value: unknown) {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  }
  catch {
    refuse();
  }
  assert(Buffer.byteLength(encoded!, "utf8") <= MAX_GRAPH_ATTACHMENT_BYTES);
  function walk(v: unknown, depth: number) {
    assert(depth <= 16);
    if (v && typeof v === "object") {
      for (const [key, child] of Object.entries(v)) {
        assert(key !== "candidate_manifest_sha256");
        walk(child, depth + 1);
      }
    }
  }
  walk(value, 0);
}

/** Keep the existing reader's exact-byte hash and identity verification, with
 * a narrower transport bound for these two aggregate graph attachments. */
export function boundedGraphReader(
  country: CandidateQualityManifest["country"],
  readBytes: (relativePath: string) => Promise<Uint8Array>,
): CandidateQualityReader {
  return new CandidateQualityReader({
    country,
    readBytes: async (relativePath) => {
      const bytes = await readBytes(relativePath);
      assert(bytes.byteLength <= MAX_GRAPH_ATTACHMENT_BYTES);
      return bytes;
    }
  });
}

export function safePublisherReason(value: unknown): string {
  reason(value);
  return value as string;
}

/** Validate all manifest strings the shared response can carry, before reading
 * attachments whose unavailable reasons might otherwise bypass this boundary. */
export function verifyGraphManifestPresentation(manifest: CandidateQualityManifest): void {
  safePublisherReason(manifest.release_eligibility.reason);
  assert(Object.keys(manifest.attachments).length <= 64);
  for (const attachment of Object.values(manifest.attachments))
    if (attachment.reason !== undefined)
      safePublisherReason(attachment.reason);
  if (manifest.geography) {
    list(id)(manifest.geography.levels);
    if (manifest.geography.vintage !== undefined)
      text(manifest.geography.vintage);
  }
}

export function implementationSetDigest(value: unknown): string {
  const byNode = object(value), ids = Object.keys(byNode).sort();
  assert(ids.length > 0 && ids.length <= 64);
  for (const key of ids) {
    id(key);
    shape(byNode[key], {
      kernel_ref: v => {
        text(v);
        assert(REF.test(v));
      },
      kernel_impl_hash: digest
    });
  }
  return createHash("sha256").update(ids.map(key => `${key}\t${byNode[key].kernel_impl_hash}\n`).join(""), "ascii").digest("hex");
}

const implementation: Check = value => {
  const o = shape(value, {
    sha256: digest,
    by_node: v => {
      implementationSetDigest(v);
    }
  });
  equal(o.sha256, implementationSetDigest(o.by_node));
};

const pin: Check = value => {
  shape(value, {
    key: id,
    label: text,
    sha256: digest
  });
};

const typedFields = {
  name: id,
  artifact: id,
  type: nullable(id),
  type_version: nullable(v => {
    count(v);
    assert(v > 0);
  }),
  artifact_key: nullable(digest),
  numeric: nullable(id),
  tolerance: nullable(number)
};

const output: Check = value => {
  shape(value, typedFields);
};

const input: Check = value => {
  shape(value, {
    ...typedFields,
    producer: nullable(id),
    producer_key: nullable(digest)
  });
};

const gate: Check = value => {
  const o = shape(value, {
    outcome: nullable(enumeration("pass", "fail", "evidence_absent", "not_applicable", "unreached")),
    scope: nullable(id),
    passed: nullable(bool),
    checks: list(v => {
      const c = shape(v, {
        name: id,
        passed: nullable(bool),
        failures: list(reason),
        details: list(d => {
          shape(d, {
            key: id,
            value: scalar
          });
        })
      });
      unique(c.details.map((d: RecordValue) => d.key));
    })
  });
  unique(o.checks.map((c: RecordValue) => c.name));
  assert(!(o.outcome === "pass" && (o.passed !== true || o.checks.some((c: RecordValue) => c.passed !== true || c.failures.length > 0))));
  assert(!(o.outcome === "fail" && o.passed === true));
  assert(!(["not_applicable", "unreached", "evidence_absent"].includes(o.outcome) && o.passed === true));
};

const node: Check = value => {
  const n = shape(value, {
    id,
    label: text,
    group: id,
    group_label: text,
    role: nullable(id),
    receipt_present: bool,
    failed: bool,
    blocked: bool,
    gate_exception: bool,
    execution_record: nullable(v => {
      shape(v, {
        state: nullable(enumeration("unreached", "gate_exception")),
        blocked_by: list(b => {
          shape(b, {
            node: id,
            key: digest
          });
        }),
        unavailable_artifacts: list(id)
      });
    }),
    receipt_outcome: nullable(id),
    cache: enumeration("hit", "computed"),
    node_key: nullable(digest),
    kernel_ref: nullable(v => {
      text(v);
      assert(REF.test(v));
    }),
    kernel_impl_hash: nullable(digest),
    determinism: nullable(id),
    numeric: nullable(id),
    tolerance: nullable(number),
    runtime_dependencies: list(id),
    seed: nullable(v => {
      assert(typeof v === "string" && v.length <= 32 && /^-?[0-9]+$/.test(v));
    }),
    wall_time_seconds: nullable(number),
    frame_key: nullable(digest),
    weight_key: nullable(digest),
    phase: nullable(id),
    typed_inputs: list(input, 128),
    typed_outputs: list(output, 128),
    opaque_artifact_keys: list(v => {
      shape(v, {
        name: id,
        key: digest
      });
    }, 128),
    column_artifact_counts: list(v => {
      shape(v, {
        entity: id,
        count
      });
    }),
    column_artifact_total: count,
    gate: nullable(gate),
    source_pins: list(pin),
    measures: list(v => {
      shape(v, {
        key: id,
        label: text,
        value: scalar
      });
    })
  });
  for (const [field, key] of [
    ["typed_inputs", "name"],
    ["typed_outputs", "name"],
    ["typed_outputs", "artifact"],
    ["opaque_artifact_keys", "name"],
    ["column_artifact_counts", "entity"],
    ["source_pins", "key"],
    ["measures", "key"]
  ])
    unique(n[field].map((v: RecordValue) => v[key]));
  equal(n.column_artifact_total, n.column_artifact_counts.reduce((sum: number, v: RecordValue) => sum + v.count, 0));
  if (n.receipt_present) {
    digest(n.node_key);
    digest(n.kernel_impl_hash);
    assert(n.kernel_ref !== null);
  }
  if (n.gate !== null || n.gate_exception)
    equal(n.role, "gate");
  for (const output of n.typed_outputs) {
    const opaque = n.opaque_artifact_keys.find((o: RecordValue) => o.name === output.artifact);
    if (opaque)
      equal(opaque.key, output.artifact_key);
  }
};

const executionFields = {
  mode: id,
  label: text,
  description: reason,
  execution_manifest_sha256: digest,
  computation_content_key: digest,
  kernel_calls: count,
  source_preparation_calls: count,
  computed_count: count,
  cache_hit_count: count,
  failed_node_ids: list(id),
  blocked_node_ids: list(id),
  gate_exception_node_ids: list(id),
  nodes: list(node, 64, 1)
};

const provenanceFields = Object.fromEntries(PROVENANCE.map(k => [k, k === "run_head" ? (v: unknown) => assert(typeof v === "string" && /^[a-f0-9]{40}$/.test(v)) : digest]));
const commonFields = {
  country: id,
  candidate_release_id: (v: unknown) => {
    assert(typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,299}$/.test(v));
  },
  run_id: id,
  ...provenanceFields,
  implementation_set: implementation,
  source_sha256: sourceMap
};

const EXECUTION_CHECK_FIELDS = {
  population_sha256: digest,
  receipt_sha256: digest,
  execution_manifest_sha256: digest,
  computation_content_key: digest,
  kernel_calls: count,
  source_preparation_calls: count,
  direct_checkpoint_table_weight_parity: bool,
  direct_real_engine_array_parity: bool,
  money_33_fields_all_axes_parity: bool
};

const DIRECT_CHECK_FIELDS = {
  population_sha256: digest,
  receipt_sha256: digest,
  household_count: count,
  person_count: count,
  source_preparation_calls: count
};

/* ------------------------------------------------- evidence profiles */

/** A second export shape, declared by name and validated field by field.
 *
 * The four-node contract above is the shape an attachment gets when it declares
 * no profile, and it is unchanged: `shape()` still counts keys exactly, so an
 * attachment cannot smuggle one of the fields below into it. A profile is not a
 * relaxation and not a passthrough for unknown fields. It names a closed set of
 * additional fields, each with its own check, and both artifacts must declare
 * the same one -- a graph carrying a profile beside a build summary that does
 * not, or two different profiles, is refused rather than partly read.
 *
 * Every roster and contract number below was read from the exporter that emits
 * these bytes, which hard-codes each of them from a closed table. They are
 * pinned here for the same reason: this profile describes exactly one accepted
 * run, so a payload that disagrees about how many households it holds, or which
 * columns it accounts, is not a variant of it. */
export const INCOME_V3_PROFILE = "us_asec_income_v3_five_node_15hh";
/** The sample-size-aware successor.
 *
 * Same semantics, same five nodes, same accounting, same price basis -- the one
 * thing that differs is that its sample size is carried by the payload and
 * reconciled, rather than pinned here. It is a separate name because it is a
 * separate contract: this reader validates a sized payload against its own
 * table and refuses to read it as the fifteen-household one, and refuses a
 * fifteen-household payload under the sized table. Neither is a relaxation of
 * the other, and the original's checks below are untouched. */
export const INCOME_SIZED_PROFILE = "us_asec_income_v3_five_node_sized_v1";
const PROFILES = [INCOME_V3_PROFILE, INCOME_SIZED_PROFILE];
/** Both income profiles share the five-node semantics, so every place that asks
 * "is this the income shape?" asks this rather than naming one of them. */
const isIncomeProfile = (profile: string | null): boolean =>
  profile === INCOME_V3_PROFILE || profile === INCOME_SIZED_PROFILE;

const INCOME_V3 = {
  nodes: [
    "asec_prepared.create",
    "asec_prepared.select_households",
    "asec_prepared.cps_carried_current",
    "asec_prepared.engine_current_money",
    "asec_prepared.reported_income"
  ],
  phase: "prepare_asec_current_money_slice",
  modes: ["cold", "warm"],
  households: 15,
  persons: 52,
  taxUnits: 25,
  incomeYears: ["2022", "2023", "2024"],
  moneyFieldAxes: 33,
  housingUniverseEvidenceFields: 7,
  accountingColumns: 28,
  accountingRowBytes: 91,
  dtypeBytes: {
    "<f8": 8,
    "<i8": 8,
    u1: 1
  } as Record<string, number>,
  arithmeticOrder: "W=WSAL_VAL;E=SEMP_VAL+FRSE_VAL;S=SSI_VAL;P=PAW_VAL_2024_price;T=PTOTVAL;U=T-(((W+E)+S)+P)",
  resultColumns: [
    "asec_reported_wage_income_2024_price",
    "asec_reported_net_self_employment_income_2024_price",
    "asec_reported_ssi_2024_price",
    "asec_reported_cash_public_assistance_2024_price",
    "asec_reported_total_income_2024_price",
    "asec_reported_income_unallocated_2024_price"
  ],
  signClasses: ["negative", "positive", "zero"],
  zeroClasses: [
    "observed_amount",
    "niu_below_receipt_age",
    "reported_receipt_zero_amount",
    "reported_no_receipt",
    "niu_in_age_universe"
  ],
  notClaimed: [
    "simulated_ssi",
    "simulated_tanf",
    "acs_other_income",
    "completed_eight_component_acs_bridge",
    "prior_wages"
  ],
  // Nine, not ten. `prior_wages` is deliberately absent: the exporter excludes
  // it because this profile's scope is cross-sectional, so prior wages are not
  // something it failed to measure. It stays in `not_claimed` above, which is
  // where "we do not assert this" belongs.
  missing: [
    "calibration",
    "fit",
    "holdouts",
    "national_totals",
    "congressional_district_pass",
    "completed_eight_component_acs_bridge",
    "distributions",
    "support",
    "model_validation"
  ],
  // The conversion basis is the kernel's own contract, and the exporter now
  // publishes it as three bound fields rather than one asserted name. The basis
  // is chained CPI-U from the Census P60 annual index workbook, not CPI-U-RS;
  // the digest is the contract file the accounting node records having read, so
  // a payload naming the series without naming those bytes is refused.
  basis: {
    measure: "observed_reported_source_income",
    nominal_source: "asec_reported_nominal_amounts",
    price_basis: "census_ccpiu_annual_2024",
    price_target_year: "2024",
    price_basis_resource_sha256:
      "88cec207a3c73e5de93d677acf16e8db9ddae9761c644c06da92cacf0feb3f63",
    reference_period: "interview_household_one_year_after_income_year",
    residual_meaning: "signed_source_accounting_residual_not_acs_other_income"
  },
  /** Which earlier node each node's typed inputs may name.
   *
   * Keyed by node id, mirroring the exporter's own `INPUT_PRODUCERS`, which it
   * in turn read from the five kernels rather than inferring from roster order.
   * Keyed rather than positional on purpose: a roster this small is easy to
   * silently shear by one if it is read by index, and the whole point of the
   * rule is which specific node may name which specific producer.
   *
   * The row that matters is the last: the accounting node consumes the prepared
   * frame and the selection, and **never the engine**. The generic reader
   * already refuses an input whose producer is absent from the execution, is
   * the node itself, or disagrees about the artifact -- but it would accept an
   * accounting node that consumed the engine, which is exactly the edge the
   * exporter now refuses by name, and exactly the edge that would let this
   * dashboard draw a model-informed arrow into a block labelled "what the
   * source reported". */
  inputProducers: {
    "asec_prepared.create": [],
    "asec_prepared.select_households": ["asec_prepared.create"],
    "asec_prepared.cps_carried_current": [
      "asec_prepared.create",
      "asec_prepared.select_households"
    ],
    "asec_prepared.engine_current_money": ["asec_prepared.cps_carried_current"],
    "asec_prepared.reported_income": [
      "asec_prepared.create",
      "asec_prepared.select_households"
    ]
  } as Record<string, readonly string[]>
};

/** The accounting layout, as the production producer defines it:
 * `COORDINATES + RESULT_COLUMNS + EVIDENCE_COLUMNS` in `graph_asec_income.py`,
 * with `ACCOUNTING_DTYPES` alongside. Twenty-eight schema column names, in the
 * order the exporter republishes them.
 *
 * This roster exists because these are **schema labels, not values**. The first
 * one is literally `person_id`, which the publisher-text check refuses -- and
 * should keep refusing, because that marker is what stops a raw per-person
 * identifier arriving as prose. So column names are validated against this
 * closed roster instead of being routed through that check: a name is accepted
 * because it is one of these twenty-eight, never because it looked safe.
 * Anything not on the list is refused, so widening this list is the only way to
 * admit a new name, and that is a review rather than an accident. */
const ACCOUNTING_COLUMN_ROSTER: readonly { name: string; dtype: string }[] = [
  { name: "person_id", dtype: "<i8" },
  { name: "income_year", dtype: "<i8" },
  { name: "A_AGE", dtype: "<i8" },
  { name: "asec_reported_wage_income_2024_price", dtype: "<f8" },
  { name: "asec_reported_net_self_employment_income_2024_price", dtype: "<f8" },
  { name: "asec_reported_ssi_2024_price", dtype: "<f8" },
  { name: "asec_reported_cash_public_assistance_2024_price", dtype: "<f8" },
  { name: "asec_reported_total_income_2024_price", dtype: "<f8" },
  { name: "asec_reported_income_unallocated_2024_price", dtype: "<f8" },
  { name: "WSAL_VAL.status", dtype: "u1" },
  { name: "WSAL_VAL.validity", dtype: "u1" },
  { name: "WSAL_VAL.zero_origin", dtype: "u1" },
  { name: "SEMP_VAL.status", dtype: "u1" },
  { name: "SEMP_VAL.validity", dtype: "u1" },
  { name: "SEMP_VAL.zero_origin", dtype: "u1" },
  { name: "FRSE_VAL.status", dtype: "u1" },
  { name: "FRSE_VAL.validity", dtype: "u1" },
  { name: "FRSE_VAL.zero_origin", dtype: "u1" },
  { name: "SSI_VAL.status", dtype: "u1" },
  { name: "SSI_VAL.validity", dtype: "u1" },
  { name: "SSI_VAL.zero_origin", dtype: "u1" },
  { name: "PTOTVAL.status", dtype: "u1" },
  { name: "PTOTVAL.validity", dtype: "u1" },
  { name: "PTOTVAL.zero_origin", dtype: "u1" },
  { name: "PAW_VAL.status", dtype: "u1" },
  { name: "PAW_VAL.validity", dtype: "u1" },
  { name: "PAW_VAL.zero_origin", dtype: "u1" },
  { name: "PAW_VAL.source_encoding_class", dtype: "u1" }
];

/** A schema column name, checked against the closed roster above rather than
 * against the publisher-text markers. Still an identifier by shape, so a name
 * that somehow passed the roster but was not one is refused twice. */
const columnName: Check = value => {
  assert(typeof value === "string" && ID.test(value));
  assert(ACCOUNTING_COLUMN_ROSTER.some(column => column.name === value));
};

/** The three published price fields, each its own named check.
 *
 * Named rather than folded into `enumeration(...)` calls because these are the
 * fields that were wrong before, and a refusal that cannot say which of the
 * three it came from is a refusal nobody can act on. A named check keeps its
 * own frame in a stack, so a test can pin *where* the refusal happened rather
 * than only that one happened. */
const priceBasisSeries: Check = value => {
  equal(value, INCOME_V3.basis.price_basis);
};
const priceTargetYear: Check = value => {
  equal(value, INCOME_V3.basis.price_target_year);
};
/** The digest of the contract file the accounting node records having converted
 * with. Checked as a digest first, then against the one this profile pins, so
 * a payload that names the right series over the wrong bytes is refused. */
const priceBasisResourceDigest: Check = value => {
  digest(value);
  equal(value, INCOME_V3.basis.price_basis_resource_sha256);
};

/** An exact roster, in the published order. Order is part of the contract here
 * because the exporter writes each of these from a fixed tuple; a reordered
 * list is a different publisher, not a rearranged one.
 *
 * The returned check is a named function expression rather than an arrow, so a
 * refusal from inside it says `exactRoster` in a stack instead of
 * `<anonymous>`. That is the difference between a test that can pin which check
 * refused and one that can only say that something did. */
const exactList = (expected: readonly string[]): Check =>
  function exactRoster(value) {
    assert(Array.isArray(value) && value.length === expected.length);
    // A plain loop, not `forEach`: an anonymous callback puts an unnamed frame
    // between this check and the refusal it raised, which is the one thing a
    // stack read for evidence cannot afford.
    for (const [index, entry] of (value as unknown[]).entries()) {
      id(entry);
      equal(entry, expected[index]);
    }
  };

/** Rows keyed by a name, one per expected key, in the expected order. */
const keyedRows = (
  key: string,
  expected: readonly string[],
  fields: Record<string, Check>
): Check =>
  function keyedRowSet(value) {
    assert(Array.isArray(value) && value.length === expected.length);
    (value as unknown[]).forEach((entry, index) => {
      const row = shape(entry, {
        [key]: id,
        ...fields
      });
      equal(row[key], expected[index]);
    });
  };

const bounded = (min: number, max: number): Check =>
  function boundedCount(value) {
    count(value);
    assert(value >= min && value <= max);
  };

/** A scope count. Positive, because a scope of zero households describes
 * nothing, and `count` alone would accept it. */
const positiveCount: Check = function positiveScopeCount(value) {
  count(value);
  assert((value as number) >= 1);
};

/** The fifteen-household scope: every count pinned, exactly as reviewed. */
const incomeScope: Check = value => {
  const s = shape(value, {
    households: count,
    persons: count,
    tax_units: count,
    households_by_source_cohort: keyedRows("income_year", INCOME_V3.incomeYears, {
      households: count
    }),
    money_field_axes: count,
    housing_universe_evidence_fields: count,
    housing_universe_carried_cells: count,
    loaded_module_count: bounded(1, 1024),
    note: reason
  });
  equal(s.households, INCOME_V3.households);
  equal(s.persons, INCOME_V3.persons);
  equal(s.tax_units, INCOME_V3.taxUnits);
  equal(s.money_field_axes, INCOME_V3.moneyFieldAxes);
  equal(s.housing_universe_evidence_fields, INCOME_V3.housingUniverseEvidenceFields);
  assert(
    s.housing_universe_carried_cells >= s.housing_universe_evidence_fields &&
    s.housing_universe_carried_cells <= 64
  );
  equal(
    s.households_by_source_cohort.reduce((total: number, cohort: RecordValue) => total + cohort.households, 0),
    s.households
  );
};

/** Entities the sized profile will carry a row count for, and the three it
 * always requires. Closed, so a payload cannot invent an entity and have it
 * drawn as if the run had counted one. */
const SIZED_ENTITIES = [
  "household",
  "person",
  "family",
  "spm_unit",
  "tax_unit",
  "marital_unit"
];
const SIZED_REQUIRED_ENTITIES = ["household", "person", "tax_unit"];
/** The producer schemas the exporter has explicit adapters for. Named, not
 * open: an unrecognised producer is refused rather than read under whichever
 * table happens to fit. */
const SIZED_PRODUCER_SCHEMAS = ["income_v3_first_genuine", "income_v3_measured_505hh"];
/** The one sampler contract the sized profile supports, and the scope it ranges
 * over. Both are pinned here for the reason every other roster on this page is:
 * they are closed tables in the exporter, not free fields, and the surface draws
 * a sentence about how the sample was chosen. A rule string the exporter never
 * validated would otherwise arrive as prose and be drawn as a method. */
const SIZED_SELECTION_RULE = "floor(fraction * eligible)";
const SIZED_SELECTION_RULE_SCOPE = "per_source_cohort";
/** Entities that can nest inside a household. The exporter records nesting for
 * everything except the household itself and the person, so a nesting row for
 * either is a contradiction rather than an extra fact. */
const SIZED_NESTED_ENTITIES = SIZED_ENTITIES.filter(
  entity => entity !== "household" && entity !== "person"
);

/** The lede the exporter templates from the counts beside it.
 *
 * It is one more recording of the same three facts, not free prose, so it is
 * rebuilt here from the validated counts and compared. Before this the note was
 * read as prose: a payload could say "505 sampled households ... holding 1,300
 * people" directly above a stat row reading 41 and 107, and the page drew both. */
const sizedNote = (s: RecordValue): string =>
  `${s.households} sampled households from ${INCOME_V3.incomeYears.length} source cohorts, ` +
  `holding ${s.persons} people and ${s.tax_units} tax units. ` +
  "An engineering sample of this size establishes no population accuracy.";

/** The rule, replayed against the operands published beside it.
 *
 * The publisher pins the rule string, the fraction and every cohort's eligible
 * households, and the surface draws all three beside the realised counts as the
 * method the sample came out of. Pinning the string says only that the publisher
 * named a rule this reader supports; it does not say the counts are what that
 * rule produces. Without this, a payload whose cohorts sum, whose eligible total
 * adds up and whose lede agrees -- and whose fraction or eligible cohort is not
 * the one those counts came out of -- was accepted and drawn as a method.
 *
 * An equality rather than a bound, because a stratum that added units beyond its
 * draw is refused on the publisher's side, so realised is the request. Both
 * sides evaluate `floor(fraction * eligible)` in IEEE doubles over the same two
 * published numbers, so this refuses exactly what the exporter refuses --
 * including the floor: a share of `x.9` is `x`, and rounding it would refuse a
 * correct run. */
function cohortSelectionRule(cohorts: RecordValue[], fraction: number): void {
  for (const cohort of cohorts)
    equal(Math.floor(fraction * (cohort.eligible_households as number)), cohort.households);
}

/** The sized scope: the same closed semantics, with the size carried and
 * reconciled instead of pinned.
 *
 * Nothing here trusts a single number. The publisher states how many places
 * inside its run recorded each count, the cohorts must sum to the households,
 * the people cannot be fewer than the households, and every other table that
 * restates a count -- the entity rows, the nesting rows, the recorded-location
 * listing and the lede -- has to agree with it. Everything that is *not* the
 * size -- the money field axes, the housing evidence fields, the cohort year
 * roster and its order -- is pinned exactly as it is for the fifteen-household
 * profile. */
const sizedScope: Check = value => {
  const s = shape(value, {
    households: positiveCount,
    persons: positiveCount,
    tax_units: positiveCount,
    entity_rows: function entityRowSet(rows) {
      assert(Array.isArray(rows) && rows.length >= SIZED_REQUIRED_ENTITIES.length && rows.length <= SIZED_ENTITIES.length);
      const names: string[] = [];
      for (const row of rows as unknown[]) {
        const r = shape(row, { entity: id, rows: positiveCount });
        assert(SIZED_ENTITIES.includes(r.entity as string));
        names.push(r.entity as string);
      }
      unique(names);
      assert(SIZED_REQUIRED_ENTITIES.every(entity => names.includes(entity)));
    },
    households_by_source_cohort: keyedRows("income_year", INCOME_V3.incomeYears, {
      households: positiveCount,
      eligible_households: positiveCount
    }),
    money_field_axes: count,
    housing_universe_evidence_fields: count,
    housing_universe_carried_cells: count,
    loaded_module_count: bounded(1, 1024),
    producer_schema: function producerSchema(name) {
      id(name);
      assert(SIZED_PRODUCER_SCHEMAS.includes(name as string));
    },
    measurement: sizedMeasurement,
    note: reason
  });
  // Size-invariant semantics, pinned exactly as they are for the original.
  equal(s.money_field_axes, INCOME_V3.moneyFieldAxes);
  equal(s.housing_universe_evidence_fields, INCOME_V3.housingUniverseEvidenceFields);
  assert(
    s.housing_universe_carried_cells >= s.housing_universe_evidence_fields &&
    s.housing_universe_carried_cells <= 64
  );
  // A sample of whole households cannot hold fewer people than households.
  assert(s.persons >= s.households);
  equal(sumOf(s.households_by_source_cohort as RecordValue[], "households"), s.households);
  for (const cohort of s.households_by_source_cohort as RecordValue[])
    assert(cohort.eligible_households >= cohort.households);
  // The entity table and the three headline counts are the same facts written
  // twice; they have to say the same thing.
  const rows = new Map(
    (s.entity_rows as RecordValue[]).map(row => [row.entity as string, row.rows as number])
  );
  equal(rows.get("household"), s.households);
  equal(rows.get("person"), s.persons);
  equal(rows.get("tax_unit"), s.tax_units);
  const measurement = s.measurement as RecordValue;
  // The nesting table records the same entity row counts a second time, under a
  // different question ("how many of these sit inside one household"). The
  // exporter refuses a disagreement; so does this. A nesting row for an entity
  // nobody counted, or for the household or the person, is a contradiction.
  for (const entry of measurement.nesting as RecordValue[]) {
    assert(SIZED_NESTED_ENTITIES.includes(entry.entity as string));
    assert(rows.has(entry.entity as string));
    equal(rows.get(entry.entity as string), entry.rows);
  }
  // Every count the publisher lists must be one this scope also declares, and
  // every count this scope declares must be listed. A closed set in both
  // directions: an open one let a fact nobody counts -- a district total, say --
  // arrive and be drawn under "how this size was measured".
  const recorded = new Map(
    (measurement.recorded_count_locations as RecordValue[]).map(
      entry => [entry.fact as string, entry]
    )
  );
  for (const [entity, count_] of rows) {
    const entry = recorded.get(entity);
    assert(entry !== undefined);
    equal(entry!.count, count_);
  }
  for (const cohort of s.households_by_source_cohort as RecordValue[]) {
    const entry = recorded.get(`cohort_${cohort.income_year}`);
    assert(entry !== undefined);
    equal(entry!.count, cohort.households);
  }
  equal(recorded.size, rows.size + INCOME_V3.incomeYears.length);
  // Households and people are what everything else is sized by, so each must
  // have been written down in more than one place inside the run. Places, not
  // measurements: the publisher counts a cold and warm restatement of one
  // location apart, and this reads the location count.
  for (const entity of ["household", "person"])
    assert((recorded.get(entity)!.locations as number) >= 2);
  // The rule's own operands. The eligible total is the per-cohort eligible
  // counts added up, so the number drawn beside the rule is the one the cohort
  // table can be checked against.
  equal(sumOf(s.households_by_source_cohort as RecordValue[], "eligible_households"), measurement.eligible_households);
  // And the rule replayed over them, per cohort. After the checks above, so a
  // payload that is wrong about a count refuses at the count rather than here.
  cohortSelectionRule(
    s.households_by_source_cohort as RecordValue[],
    measurement.sampling_fraction as number
  );
  // Last, because it restates counts this block has already reconciled: a payload
  // whose size is wrong should refuse at the size, not at the sentence about it.
  equal(s.note, sizedNote(s));
};

/** How the size was arrived at, as the publisher recorded it.
 *
 * Every entry names one fact, the count it carries, how many distinct places
 * inside the run recorded it, how many of those were a cold or warm execution
 * restating the same place, and which places they were. The word is *location*,
 * not measurement, and the distinction is the publisher's: the two execution
 * manifests share one computation content key, so a warm copy of a recorded node
 * counter is the cold copy read again and cannot disagree with it. Counting it
 * as a second place would have made a byte-identical restatement read as
 * corroboration. Nothing here claims two locations are statistically
 * independent; the claim is that more than one exists and that they agree.
 *
 * The selection rule is drawn on the page, so it is pinned to the one sampler
 * contract the exporter supports rather than read as free text, and its scope
 * and operands are read beside it. */
function sizedMeasurement(value: unknown): void {
  const m = shape(value, {
    basis: enumeration("measured_from_recorded_outputs_and_reconciled"),
    selection_rule: function selectionRule(rule) {
      text(rule, 128);
      equal(rule, SIZED_SELECTION_RULE);
    },
    selection_rule_scope: enumeration(SIZED_SELECTION_RULE_SCOPE),
    sampling_fraction: function samplingFraction(fraction) {
      assert(typeof fraction === "number" && Number.isFinite(fraction));
      assert((fraction as number) > 0 && (fraction as number) <= 1);
    },
    eligible_households: positiveCount,
    entity_structure_recorded: bool,
    nesting: list(function nestedRow(v) {
      shape(v, {
        entity: function nestedEntity(name) {
          id(name);
          assert(SIZED_NESTED_ENTITIES.includes(name as string));
        },
        rows: positiveCount,
        within_one_household: enumeration(true)
      });
    }, 8),
    recorded_count_locations: list(function recordedCountLocation(v) {
      const entry = shape(v, {
        fact: id,
        count: positiveCount,
        locations: bounded(1, 64),
        phase_restatements: bounded(0, 64),
        sources: list(v2 => text(v2, 160), 64, 1)
      });
      // The claimed number of locations is the number of places named, and no
      // place is named twice -- a repeated name is a restatement, which the
      // publisher counts in its own field.
      equal(entry.locations, (entry.sources as unknown[]).length);
      unique(entry.sources as unknown[]);
    }, 64, 1),
    note: reason
  });
  unique((m.recorded_count_locations as RecordValue[]).map(entry => entry.fact));
  unique((m.nesting as RecordValue[]).map(entry => entry.entity));
  // A nesting table is recorded only when the producer wrote one.
  assert(m.entity_structure_recorded === ((m.nesting as unknown[]).length > 0));
}

/** No score, and the absence is the contract rather than a missing field. A
 * profile that published a number here would be describing different evidence. */
const incomeQuality: Check = value => {
  shape(value, {
    status: enumeration("incomplete"),
    basis: enumeration("engineering_completion_only"),
    score: enumeration(null),
    score_reason: reason,
    missing: exactList(INCOME_V3.missing),
    note: reason
  });
};

/** The accounting block's field table, under one of the two size policies.
 *
 * `pinned` keeps the reviewed profile exactly as reviewed: each zero-origin
 * class is capped at fifty-two. `measured` reads them as plain counts and holds
 * them to the arithmetic instead, in `reportedTotals` below. */
const reportedFields = (measured: boolean): Record<string, Check> => {
  const zeroOrigin: Check = keyedRows(
    "income_year",
    INCOME_V3.incomeYears,
    Object.fromEntries(
      INCOME_V3.zeroClasses.map(name => [
        name,
        // Deliberately unbounded under the measured policy: the producer builds
        // these as a partition of the accounted person rows by cohort year and
        // class, so they add up exactly or the block is contradictory. A cap
        // against a constant would be a weaker statement, not a stronger one.
        measured ? count : bounded(0, INCOME_V3.persons)
      ])
    )
  );
  return {
    rows: count,
    accounting_column_count: count,
    accounting_row_bytes: count,
    arithmetic_order: v => {
      text(v, 256);
      equal(v, INCOME_V3.arithmeticOrder);
    },
    accounting_columns: v => {
      assert(Array.isArray(v) && v.length === INCOME_V3.accountingColumns);
      const names: string[] = [];
      for (const [index, column] of (v as unknown[]).entries()) {
        const c = shape(column, {
          name: columnName,
          dtype: enumeration(...Object.keys(INCOME_V3.dtypeBytes)),
          sha256: digest
        });
        // Exact roster, in order, name and width together. The producer builds
        // this layout from one fixed tuple, so a reordered or renamed column is
        // a different schema rather than a rearranged one -- and the dtype is
        // pinned per position because the published bytes carry no offset to
        // derive it from, so an <i8 swapped for an <f8 would otherwise be
        // invisible: both are eight bytes wide.
        equal(c.name, ACCOUNTING_COLUMN_ROSTER[index].name);
        equal(c.dtype, ACCOUNTING_COLUMN_ROSTER[index].dtype);
        names.push(c.name);
      }
      unique(names);
      assert(INCOME_V3.resultColumns.every(name => names.includes(name)));
    },
    result_column_sha256: keyedRows("column", INCOME_V3.resultColumns, {
      sha256: digest
    }),
    typed_evidence_axis_count: bounded(1, 64),
    raw_public_assistance_evidence_count: bounded(1, 32),
    alternative_association_sha256: digest,
    alternative_association_differs: bool,
    signed_value_counts: keyedRows(
      "column",
      INCOME_V3.resultColumns,
      Object.fromEntries(INCOME_V3.signClasses.map(name => [name, count]))
    ),
    zero_origin_class_counts: zeroOrigin,
    basis: v => {
      shape(v, {
        measure: enumeration(INCOME_V3.basis.measure),
        nominal_source: enumeration(INCOME_V3.basis.nominal_source),
        // Three fields, not one. The series name alone was what went wrong
        // before: it was published as an assertion and it named the wrong
        // series. The digest is the accounting node's own recorded contract
        // file, so the name is checked against bytes rather than believed.
        price_basis: priceBasisSeries,
        price_target_year: priceTargetYear,
        price_basis_resource_sha256: priceBasisResourceDigest,
        reference_period: enumeration(INCOME_V3.basis.reference_period),
        residual_meaning: enumeration(INCOME_V3.basis.residual_meaning),
        note: reason
      });
    },
    not_claimed: exactList(INCOME_V3.notClaimed)
  };
};

/** The row width the pinned column roster's own dtypes add up to: three
 * eight-byte coordinates, six eight-byte results and nineteen one-byte evidence
 * flags reach 91 bytes exactly one way. Derived rather than restated, so the
 * published width and the published layout have to agree with each other. */
const rosterRowBytes = (): number =>
  ACCOUNTING_COLUMN_ROSTER.reduce((total, c) => total + INCOME_V3.dtypeBytes[c.dtype], 0);
/** Every accounted row falls in exactly one zero-origin class in exactly one
 * cohort year, so these counts add to the accounted rows. */
const zeroOriginTotal = (r: RecordValue): number =>
  (r.zero_origin_class_counts as RecordValue[]).reduce(
    (total, entry) => total + sumKeys(entry, INCOME_V3.zeroClasses),
    0
  );

/** The totals both policies share, plus the one the measured policy adds.
 *
 * Each total is asserted on one line through a named helper. A refusal names the
 * line it came from, and three multi-line `equal(` calls all reported the same
 * bare text, so a test could not tell which total had disagreed. */
function reportedTotals(r: RecordValue, measured: boolean): void {
  if (measured)
    positiveCount(r.rows);
  else
    equal(r.rows, INCOME_V3.persons);
  equal(r.accounting_column_count, INCOME_V3.accountingColumns);
  equal(r.accounting_row_bytes, rosterRowBytes());
  equal(r.accounting_row_bytes, INCOME_V3.accountingRowBytes);
  // Every accounted row is classified exactly once per result column, so the
  // three signed classes cover the person rows and nothing is unaccounted.
  for (const row of r.signed_value_counts)
    equal(sumKeys(row, INCOME_V3.signClasses), r.rows);
  if (measured)
    // The same statement one axis over.
    equal(zeroOriginTotal(r), r.rows);
}

/** Named function expressions, not arrows returned by a factory: the frame name
 * a refusal carries is part of what the contract tests read, so each policy
 * gets its own name and calls `shape` itself. */
const incomeReported: Check = function incomeReported(value) {
  reportedTotals(shape(value, reportedFields(false)), false);
};
const sizedReported: Check = function sizedReported(value) {
  reportedTotals(shape(value, reportedFields(true)), true);
};

const pathIdentity = (extra: Record<string, Check> = {}): Check => value => {
  const o = shape(value, {
    direct_sha256: digest,
    graph_sha256: digest,
    differs: bool,
    ...extra
  });
  // The publisher states whether the two paths encoded the same bytes. The
  // digests are right there, so the statement is checked rather than repeated.
  equal(o.differs, o.direct_sha256 !== o.graph_sha256);
};

const incomePathIdentities: Check = value => {
  shape(value, {
    engine_evaluation: pathIdentity(),
    reported_income: pathIdentity({
      body_sha256: digest
    }),
    note: reason
  });
};

const incomeLineage: Check = value => {
  const o = shape(value, {
    fields: v => {
      assert(Array.isArray(v) && v.length >= 1 && v.length <= 16);
      v.forEach(id);
      unique(v);
    },
    count,
    note: reason
  });
  equal(o.count, o.fields.length);
};

/** The identities a profile adds to the run's own. They are provenance, so they
 * are bound to the candidate manifest exactly as the original eight are, and
 * they are carried on both artifacts because the publisher writes one identity
 * block into each. A build summary that omits them is a different publisher. */
const PROFILE_PROVENANCE = [
  "root_output_review_sha256",
  "base_exporter_sha256",
  "loaded_module_manifest_sha256"
] as const;
/** The sized profile publishes a fourth.
 *
 * `base_exporter_sha256` names `graph_evidence.py` on both profiles, and the
 * sized exporter also imports the reviewed fifteen-household profile, so that
 * file gets its own key rather than borrowing the base one. It used to be
 * published *as* the base digest, which meant the same key named two different
 * sources depending on which profile you were reading -- so the two profiles'
 * identity blocks could not be compared at all. Named separately, both are
 * bound to the manifest and required to agree across all three artifacts. */
const SIZED_PROFILE_PROVENANCE = [
  ...PROFILE_PROVENANCE,
  "reviewed_exporter_sha256"
] as const;
const profileProvenance = (profile: string | null): readonly string[] =>
  profile === INCOME_SIZED_PROFILE ? SIZED_PROFILE_PROVENANCE : PROFILE_PROVENANCE;

const profileName: Check = v => {
  id(v);
  assert(PROFILES.includes(v as string));
};

const profileCommonFields = (profile: string | null): Record<string, Check> =>
  profile === null
    ? {}
    : {
        profile: profileName,
        ...Object.fromEntries(profileProvenance(profile).map(key => [key, digest]))
      };

const INCOME_V3_GRAPH_FIELDS: Record<string, Check> = {
  scope: incomeScope,
  quality: incomeQuality,
  reported_income: incomeReported,
  path_output_identities: incomePathIdentities,
  lineage_divergence: incomeLineage
};

/** The sized profile's own table. Same five field names, two of them under the
 * measured policy; everything else is the identical check object, so the two
 * profiles cannot drift apart on anything that is not the size. */
const INCOME_SIZED_GRAPH_FIELDS: Record<string, Check> = {
  scope: sizedScope,
  quality: incomeQuality,
  reported_income: sizedReported,
  path_output_identities: incomePathIdentities,
  lineage_divergence: incomeLineage
};

const incomeGraphFields = (profile: string): Record<string, Check> =>
  profile === INCOME_SIZED_PROFILE ? INCOME_SIZED_GRAPH_FIELDS : INCOME_V3_GRAPH_FIELDS;

const INCOME_DIRECT_FIELDS: Record<string, Check> = {
  tax_unit_count: count,
  reported_income_rows: count,
  reported_income_body_sha256: digest
};

const INCOME_EXECUTION_FIELDS: Record<string, Check> = {
  reported_income_payload_sha256: digest,
  reported_income_body_sha256: digest
};

/** Read the declared profile from both artifacts before either is shaped. Both
 * must declare the same one; one profile and one silence is a contradiction, not
 * a default. */
function declaredProfile(raw: unknown, rawBuild: unknown): string | null {
  const graph = object(raw), build = object(rawBuild);
  const onGraph = Object.hasOwn(graph, "profile") ? graph.profile : null;
  const onBuild = Object.hasOwn(build, "profile") ? build.profile : null;
  assert(onGraph === onBuild);
  if (onGraph === null)
    return null;
  profileName(onGraph);
  return onGraph as string;
}

/** Both artifacts have already passed the unchanged candidate reader's byte and
 * embedded identity checks. This entry point adds strict shape, per-node and
 * separate execution-byte/content-key binding; all interpretation stays shared. */
/** Whether this profile permits this node to consume that producer.
 *
 * The generic reader already refuses a typed input whose producer is absent
 * from the execution, is the node itself, or disagrees about the artifact --
 * but all three would accept an accounting node consuming the engine, which is
 * the one edge that changes what the drawn surface means. "What the source
 * reported" stops being what the source reported the moment a model output
 * flows into it, and the canvas would draw that arrow without comment.
 *
 * The exporter refuses it by name through its own `INPUT_PRODUCERS`; this is
 * the reader's half of the same rule, so a payload that got past the exporter
 * by some other route still cannot be drawn. A node with no roster row at all
 * is refused rather than waved through, so adding a sixth node cannot silently
 * arrive unconstrained. */
function permittedInputProducer(node: string, producer: string): void {
  const permitted = INCOME_V3.inputProducers[node];
  assert(permitted !== undefined);
  assert(permitted.includes(producer));
}

export function normalizeGraphAttachment(
  raw: unknown,
  manifest: CandidateQualityManifest,
  manifestSha256: string,
  rawBuild: unknown,
): {
  projection: ReceiptProjection;
  checks: BindingCheck[];
} {
  boundedArtifact(raw);
  boundedArtifact(rawBuild);
  digest(manifestSha256);
  verifyGraphManifestPresentation(manifest);
  if (object(raw).profile === COMBINED_AGE_PROFILE || object(rawBuild).profile === COMBINED_AGE_PROFILE)
    return normalizeCombinedAgeAttachment(raw, manifest, manifestSha256, rawBuild, { node, implementation });
  const profile = declaredProfile(raw, rawBuild);
  const profileCommon = profileCommonFields(profile);
  const graph = shape(raw, {
    schema_version: enumeration(GRAPH_RECEIPTS_SCHEMA),
    ...commonFields,
    ...profileCommon,
    ...(isIncomeProfile(profile) ? incomeGraphFields(profile!) : {}),
    population_sha256: digest,
    period: text,
    entity: id,
    period_basis: id,
    period_reason: reason,
    computation_content_key: digest,
    provenance_note: reason,
    label_basis: reason,
    coverage: v => {
      shape(v, {
        basis: id,
        complete: bool,
        reason
      });
    },
    content_key_note: reason,
    executions: list(v => {
      shape(v, executionFields);
    }, 8, 1)
  });
  const build = shape(rawBuild, {
    schema_version: enumeration(BUILD_SCHEMA),
    ...commonFields,
    ...profileCommon,
    graph_receipts_sha256: digest,
    checks: v => {
      object(v);
    }
  });
  for (const key of Object.keys(profileCommon))
    equal(build[key], graph[key]);
  if (profile !== null)
    for (const key of profileProvenance(profile))
      equal(graph[key], manifest.provenance[key as keyof typeof manifest.provenance]);
  if (profile === INCOME_SIZED_PROFILE)
    // Two keys, two files. If they ever carried one digest the sized profile
    // would be publishing the base exporter twice and the reviewed profile not
    // at all, which is the state this key split exists to end.
    assert(graph.base_exporter_sha256 !== graph.reviewed_exporter_sha256);
  const descriptor = manifest.attachments.graph_receipts, buildDescriptor = manifest.attachments.build_manifest;
  assert(descriptor?.status === "available" && descriptor.scope === "population");
  assert(buildDescriptor?.status === "available" && buildDescriptor.scope === "run");
  digest(descriptor.sha256);
  digest(buildDescriptor.sha256);
  equal(build.graph_receipts_sha256, descriptor.sha256);
  for (const key of ["country", "candidate_release_id", "run_id"]) {
    equal(graph[key], manifest[key as keyof CandidateQualityManifest]);
    equal(build[key], graph[key]);
  }
  for (const key of PROVENANCE) {
    equal(graph[key], manifest.provenance[key]);
    equal(build[key], graph[key]);
  }
  assert(!Object.hasOwn(manifest.provenance, "source_implementation_sha256"));
  equal(manifest.provenance.implementation_set_sha256, graph.implementation_set.sha256);
  equal(canonical(build.implementation_set), canonical(graph.implementation_set));
  equal(canonical(build.source_sha256), canonical(graph.source_sha256));
  assert(manifest.population !== null);
  equal(graph.population_sha256, manifest.population!.sha256);
  equal(graph.period, manifest.population!.period);
  equal(graph.entity, manifest.population!.entity);
  equal(manifest.release_eligibility.status, "excluded");
  const executions: ProjectionExecution[] = graph.executions.map((e: RecordValue) => ({
    mode: e.mode,
    label: e.label,
    description: e.description,
    manifest_sha256: e.execution_manifest_sha256,
    content_key: e.computation_content_key,
    kernel_calls: e.kernel_calls,
    source_preparation_calls: e.source_preparation_calls,
    computed_count: e.computed_count,
    cache_hit_count: e.cache_hit_count,
    failed_node_ids: e.failed_node_ids,
    blocked_node_ids: e.blocked_node_ids,
    gate_exception_node_ids: e.gate_exception_node_ids,
    nodes: e.nodes
  }));
  unique(executions.map(e => e.mode));
  unique(executions.map(e => e.manifest_sha256));
  assert(!executions.some(e => e.mode === "direct"));
  equal(canonical(Object.keys(build.checks).sort()), canonical(["direct", ...executions.map(e => e.mode)].sort()));
  const direct = shape(build.checks.direct, {
    ...DIRECT_CHECK_FIELDS,
    ...(isIncomeProfile(profile) ? INCOME_DIRECT_FIELDS : {})
  });
  equal(direct.population_sha256, graph.population_sha256);
  const expectedIds = Object.keys(graph.implementation_set.by_node).sort();
  const checks: BindingCheck[] = [
    {
      label: "Candidate manifest",
      detail: "Authenticated by its selected immutable digest."
    },
    {
      label: "Graph attachment",
      detail: "Population-scoped aggregate graph bytes authenticated by the candidate reader; the run-scoped build summary names this attachment digest."
    },
    {
      label: "Implementation set",
      detail: "The canonical ASCII node-id and hash set digest agrees with the manifest. Each node separately agrees with its declared kernel reference and implementation hash."
    },
    {
      label: "Run and exporter identities",
      detail: "Original run head, receipt, runner, roster and approval identities remain distinct from exporter code, operator declaration and runtime identities."
    }
  ];
  let exceptional = false;
  const dependencies = new Map<string, Set<string>>(expectedIds.map(nodeId => [nodeId, new Set<string>()]));
  // A receipt carrying the same node key in two executions is the same recorded
  // computation, so the typed inputs it declares belong to that key rather than
  // to the execution. Root removed node b's input from the second execution
  // only: it was accepted, and because the drawn inspector reads descriptive
  // fields from the first execution that recorded the node, the reader saw the
  // first execution's inputs for both. `identity_differs` stayed false, since
  // that comparison reads node keys, typed outputs and opaque keys and never
  // inputs.
  //
  // Compared canonically per local input slot, so declaration order is
  // irrelevant and an added, removed or mutated slot is a contradiction rather
  // than a silently-dropped edge. Nothing else is required to agree: cache
  // state, execution state, wall time and gate readings legitimately differ
  // between a cold computation and a warm hit. A receipt absent from an
  // execution, one that records no node key, and one whose key genuinely
  // differs are each compared with nothing.
  const contracts = new Map<string, string>();
  for (const e of executions) {
    const c = build.checks[e.mode];
    shape(c, {
      ...EXECUTION_CHECK_FIELDS,
      ...(isIncomeProfile(profile) ? INCOME_EXECUTION_FIELDS : {})
    });
    equal(c.population_sha256, graph.population_sha256);
    equal(c.execution_manifest_sha256, e.manifest_sha256);
    equal(c.computation_content_key, e.content_key);
    equal(e.content_key, graph.computation_content_key);
    assert(e.manifest_sha256 !== e.content_key);
    equal(c.kernel_calls, e.kernel_calls);
    equal(c.source_preparation_calls, e.source_preparation_calls);
    unique(e.nodes.map(n => n.id));
    equal(canonical(e.nodes.map(n => n.id).sort()), canonical(expectedIds));
    verifyExecutionStates(e);
    const computed = e.nodes.filter(n => cacheState(n) === "computed").length, hits = e.nodes.filter(n => cacheState(n) === "hit").length;
    equal(e.computed_count, computed);
    equal(e.cache_hit_count, hits);
    equal(e.kernel_calls, computed);
    const failed = e.nodes.some(n => n.failed || n.blocked || n.gate_exception || !n.receipt_present);
    exceptional ||= failed;
    if (!failed)
      for (const field of ["direct_checkpoint_table_weight_parity", "direct_real_engine_array_parity", "money_33_fields_all_axes_parity"])
        equal(c[field], true);
    const nodes = new Map(e.nodes.map(n => [n.id, n]));
    let sourcePins = 0;
    for (const n of e.nodes) {
      const declared = graph.implementation_set.by_node[n.id];
      equal(n.kernel_ref, declared.kernel_ref);
      equal(n.kernel_impl_hash, declared.kernel_impl_hash);
      for (const p of n.source_pins) {
        equal(p.sha256, graph.source_sha256[p.key]);
        sourcePins++;
      }
      for (const a of n.typed_inputs) {
        const producer = a.producer ? nodes.get(a.producer) : undefined;
        assert(producer && producer.id !== n.id && producer.node_key === a.producer_key && a.producer_key !== null);
        const outputs = producer!.typed_outputs.filter(o => o.artifact === a.artifact);
        assert(outputs.length === 1 && a.artifact_key !== null && a.type !== null && a.type_version !== null);
        const o = outputs[0];
        equal(o.artifact_key, a.artifact_key);
        equal(o.type, a.type);
        equal(o.type_version, a.type_version);
        // The reproducibility reading a consumer records for an artifact is a
        // property of the artifact, not of the consumer. Root's invented
        // mismatch -- an input claiming a different numeric mode from the
        // output its own named producer declared -- was accepted, and the
        // inspector showed both readings side by side as if both were true.
        // Both fields are nullable in the wire contract, so two nulls agree.
        equal(o.numeric, a.numeric);
        equal(o.tolerance, a.tolerance);
        if (isIncomeProfile(profile))
          permittedInputProducer(n.id as string, a.producer as string);
        dependencies.get(n.id)!.add(a.producer as string);
      }
      if (n.receipt_present && n.node_key !== null) {
        const identity = `${n.id}${PAIR_SEPARATOR}${n.node_key}`;
        const declared = canonical(Object.fromEntries(n.typed_inputs.map((a: RecordValue) => [a.name, a])));
        const recorded = contracts.get(identity);
        if (recorded === undefined)
          contracts.set(identity, declared);
        else
          equal(recorded, declared);
      }
    }
    checks.push({
      label: `${e.label} receipts`,
      detail: `${computed} computed and ${hits} served from cache; ${e.source_preparation_calls} source preparation calls are counted separately. Exact execution-manifest byte digest and computation content key agree with the build summary. ${sourcePinReading(sourcePins)}`
    });
  }
  assertAcyclic(dependencies);
  assert(exceptional ? ["completed", "failed"].includes(manifest.execution_status) : manifest.execution_status === "completed");
  const evidenceProfile = isIncomeProfile(profile)
    ? incomeReading(profile!, graph, build, direct, executions)
    : null;
  if (profile !== null)
    checks.push({
      label: "Declared evidence profile",
      detail: `Both artifacts declare the ${profile} profile, and every field it adds -- scope, quality, the reported-income accounting, the two paths' output identities and the lineage roster -- was checked by name against this profile's own closed tables before anything was drawn.`
    });
  return {
    projection: {
      schema_version: GRAPH_RECEIPTS_SCHEMA,
      projection_version: 1,
      is_publisher_attachment: true,
      basis: "authenticated_attachment",
      implementation_set: graph.implementation_set as ImplementationSet,
      provenance_note: graph.provenance_note,
      label_basis: graph.label_basis,
      coverage: graph.coverage,
      country: graph.country,
      candidate_release_id: graph.candidate_release_id,
      candidate_manifest_sha256: manifestSha256,
      run_id: graph.run_id,
      population_sha256: graph.population_sha256,
      build_evidence_sha256: buildDescriptor.sha256!,
      kernel_impl_hash: null,
      computation_content_key: graph.computation_content_key,
      content_key_note: graph.content_key_note,
      ...(evidenceProfile ? { evidence_profile: evidenceProfile } : {}),
      executions
    },
    checks
  };
}

/* --------------------------------------------- income-v3 composition */

const PATH_DESCRIPTIONS: Record<string, string> = {
  direct: "Ran the same work outside the graph. It records no execution manifest and no cache reading, so it is a comparison path here, not a third execution.",
  cold: "Computed every graph node once, with source preparation counted separately from the kernels.",
  warm: "Reused every recorded result in a separate process, calling no kernel."
};

/** Compose what the profile publishes into the shape the view draws, after the
 * two artifacts have been checked against each other. Nothing is authored here
 * beyond the three path descriptions above: every number, digest and sentence
 * below is the publisher's own, rearranged. */
function incomeReading(
  profile: string,
  graph: RecordValue,
  build: RecordValue,
  direct: RecordValue,
  executions: ProjectionExecution[],
): EvidenceProfileReading {
  const scope = graph.scope as RecordValue;
  // The build summary counts the same sample the graph scope describes. The
  // reviewed reader validated these three as bare counts and never compared
  // them to anything, so a summary could disagree with the scope beside it and
  // still be drawn. They are the same facts written twice, so they are checked
  // against each other for both profiles.
  equal(direct.household_count, scope.households);
  equal(direct.person_count, scope.persons);
  equal(direct.tax_unit_count, scope.tax_units);
  const reported = graph.reported_income as RecordValue;
  // The accounted row count is the person count, written in the accounting
  // block rather than the scope block.
  equal(reported.rows, scope.persons);
  const identities = graph.path_output_identities as RecordValue;
  const accounting = identities.reported_income as RecordValue;
  // The accounting body is one artifact with one digest, whichever path wrote
  // it: that is the whole point of publishing the two payload digests apart. So
  // every path must agree about the body, and the graph paths must agree with
  // the graph payload digest the identities block names.
  equal(direct.reported_income_rows, reported.rows);
  equal(direct.reported_income_body_sha256, accounting.body_sha256);
  for (const execution of executions) {
    const check = build.checks[execution.mode];
    equal(check.reported_income_body_sha256, accounting.body_sha256);
    equal(check.reported_income_payload_sha256, accounting.graph_sha256);
  }
  // Exactly the two recorded graph paths this profile describes, and exactly the
  // five nodes. A run with another mode, or a sixth node, is a different run.
  equal(canonical(executions.map(e => e.mode).sort()), canonical([...INCOME_V3.modes].sort()));
  equal(
    canonical(Object.keys(graph.implementation_set.by_node).sort()),
    canonical([...INCOME_V3.nodes].sort())
  );
  for (const execution of executions)
    for (const node of execution.nodes) {
      equal(node.kernel_ref, `us.${node.id}@3`);
      equal(node.phase, INCOME_V3.phase);
    }
  const warm = executions.find(e => e.mode === "warm")!, cold = executions.find(e => e.mode === "cold")!;
  equal(warm.kernel_calls, 0);
  equal(warm.source_preparation_calls, 0);
  equal(cold.kernel_calls, INCOME_V3.nodes.length);
  equal(cold.source_preparation_calls, 1);
  const signed = new Map(
    (reported.signed_value_counts as RecordValue[]).map(row => [row.column, row])
  );
  const paths = [
    {
      key: "direct",
      label: "Direct path",
      description: PATH_DESCRIPTIONS.direct,
      graph_execution: false,
      receipt_sha256: direct.receipt_sha256,
      execution_manifest_sha256: null,
      computation_content_key: null,
      kernel_calls: null,
      source_preparation_calls: direct.source_preparation_calls,
      cache_hit_count: null,
      reported_income_rows: direct.reported_income_rows,
      reported_income_body_sha256: direct.reported_income_body_sha256,
      reported_income_payload_sha256: accounting.direct_sha256
    },
    ...executions.map(execution => {
      const check = build.checks[execution.mode];
      return {
        key: execution.mode,
        label: execution.label,
        description: PATH_DESCRIPTIONS[execution.mode] ?? execution.description,
        graph_execution: true,
        receipt_sha256: check.receipt_sha256,
        execution_manifest_sha256: execution.manifest_sha256,
        computation_content_key: execution.content_key,
        kernel_calls: execution.kernel_calls,
        source_preparation_calls: execution.source_preparation_calls ?? 0,
        cache_hit_count: execution.cache_hit_count,
        reported_income_rows: null,
        reported_income_body_sha256: check.reported_income_body_sha256,
        reported_income_payload_sha256: check.reported_income_payload_sha256
      };
    })
  ];
  return {
    id: graph.profile,
    scope: graph.scope,
    quality: graph.quality,
    reported_income: {
      rows: reported.rows,
      accounting_column_count: reported.accounting_column_count,
      accounting_row_bytes: reported.accounting_row_bytes,
      arithmetic_order: reported.arithmetic_order,
      // Split at the publisher's own separator. Each statement is carried
      // through exactly as published; none is rewritten into words.
      arithmetic_statements: (reported.arithmetic_order as string).split(";"),
      columns: reported.accounting_columns,
      results: (reported.result_column_sha256 as RecordValue[]).map(entry => ({
        column: entry.column,
        sha256: entry.sha256,
        negative: signed.get(entry.column)!.negative,
        zero: signed.get(entry.column)!.zero,
        positive: signed.get(entry.column)!.positive
      })),
      zero_origin: (reported.zero_origin_class_counts as RecordValue[]).map(entry => ({
        income_year: entry.income_year,
        classes: INCOME_V3.zeroClasses.map(key => ({
          key,
          count: entry[key] as number
        })),
        total: INCOME_V3.zeroClasses.reduce((sum, key) => sum + (entry[key] as number), 0)
      })),
      typed_evidence_axis_count: reported.typed_evidence_axis_count,
      raw_public_assistance_evidence_count: reported.raw_public_assistance_evidence_count,
      alternative_association_sha256: reported.alternative_association_sha256,
      alternative_association_differs: reported.alternative_association_differs,
      basis: reported.basis,
      not_claimed: reported.not_claimed
    },
    path_output_identities: {
      artifacts: ["engine_evaluation", "reported_income"].map(key => ({
        key,
        direct_sha256: (identities[key] as RecordValue).direct_sha256,
        graph_sha256: (identities[key] as RecordValue).graph_sha256,
        differs: (identities[key] as RecordValue).differs,
        body_sha256: (identities[key] as RecordValue).body_sha256 ?? null
      })),
      note: identities.note
    },
    lineage_divergence: graph.lineage_divergence,
    paths,
    identities: profileProvenance(profile).map(key => ({
      key,
      sha256: graph[key]
    }))
  };
}
