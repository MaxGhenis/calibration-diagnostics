// Invented aggregate evidence only. These bytes describe no real population and
// no real run. Every digest here is invented and every count is chosen to
// satisfy the profile's own arithmetic.
//
// The schema is not invented, and deliberately so: the accounting column names
// are the production producer's real twenty-eight, the price basis is the real
// contract the accounting node records, and the quality roster is the real nine.
// A fixture that renamed those would pass against itself and fail against every
// genuine export -- which is the one failure a fixture exists to prevent.
//
// Nothing in this file may be cited as evidence about the United States, the
// ASEC, or any Microcosm build.
import { createHash } from "node:crypto";
import type { CandidateQualityManifest } from "../../quality/types";
import type { ProjectionNode } from "../adapter";

export const INVENTED_INCOME_V3_PROFILE = "us_asec_income_v3_five_node_15hh";

const h = (n: string) => n.repeat(64);
const key = (label: string) =>
  createHash("sha256").update(`invented-income-v3:${label}`).digest("hex");
export const digestOf = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const NODES = [
  "asec_prepared.create",
  "asec_prepared.select_households",
  "asec_prepared.cps_carried_current",
  "asec_prepared.engine_current_money",
  "asec_prepared.reported_income",
] as const;

const LABELS = [
  "Prepare current money sources",
  "Select whole households",
  "Carry current money leaves",
  "Evaluate four engine roots",
  "Account reported source income",
] as const;

/** Which artifact each node declares on its output side. Two nodes publish a
 * `frame_context`, exactly as the profile's roster allows, so a consumer has to
 * name which producer it took one from. */
const OUTPUTS: readonly (readonly string[])[] = [
  [
    "current_money",
    "frame_context",
    "housing_universe",
    "income_observations",
    "prepared_receipt",
  ],
  ["frame_context", "selected_current_money", "selection"],
  ["frame_context"],
  ["engine_evaluation"],
  ["frame_context", "reported_income"],
];

/** Invented typed dependencies. The accounting node consumes the preparation and
 * the selection and never the engine, so a reader can see that the engine's
 * evaluation is not an input to the reported-source-income accounting. */
const INPUTS: readonly (readonly { name: string; from: number; artifact: string }[])[] = [
  [],
  [{ name: "prepared_frame", from: 0, artifact: "frame_context" }],
  [
    { name: "selected_money", from: 1, artifact: "selected_current_money" },
    { name: "selection", from: 1, artifact: "selection" },
  ],
  [{ name: "carried_frame", from: 2, artifact: "frame_context" }],
  [
    { name: "income_observations", from: 0, artifact: "income_observations" },
    { name: "selection", from: 1, artifact: "selection" },
  ],
];

const RESULT_COLUMNS = [
  "asec_reported_wage_income_2024_price",
  "asec_reported_net_self_employment_income_2024_price",
  "asec_reported_ssi_2024_price",
  "asec_reported_cash_public_assistance_2024_price",
  "asec_reported_total_income_2024_price",
  "asec_reported_income_unallocated_2024_price",
] as const;

const ZERO_CLASSES = [
  "observed_amount",
  "niu_below_receipt_age",
  "reported_receipt_zero_amount",
  "reported_no_receipt",
  "niu_in_age_universe",
] as const;

const INCOME_YEARS = ["2022", "2023", "2024"] as const;
const PERSONS = 52;

/** The real twenty-eight column schema, in the real order.
 *
 * The names are the production producer's own
 * `COORDINATES + RESULT_COLUMNS + EVIDENCE_COLUMNS`, so this fixture carries the
 * names a genuine export carries -- including `person_id`, `A_AGE` and the
 * dotted evidence axes. Renaming them to invented stand-ins would have hidden
 * exactly the incompatibility this fixture exists to catch: a reader that
 * refuses `person_id` as publisher prose passes against invented names and
 * fails against every real export.
 *
 * Only the digests are invented. Names and widths are schema, not values, and
 * the widths reach the ninety-one byte row: three plus six eight-byte columns
 * and nineteen one-byte flags. */
const COORDINATE_COLUMNS = ["person_id", "income_year", "A_AGE"] as const;
const EVIDENCE_COLUMNS = [
  ...["WSAL_VAL", "SEMP_VAL", "FRSE_VAL", "SSI_VAL", "PTOTVAL"].flatMap(
    (field) => ["status", "validity", "zero_origin"].map((axis) => `${field}.${axis}`),
  ),
  "PAW_VAL.status",
  "PAW_VAL.validity",
  "PAW_VAL.zero_origin",
  "PAW_VAL.source_encoding_class",
] as const;

function accountingColumns() {
  return [
    ...COORDINATE_COLUMNS.map((name) => ({ name, dtype: "<i8" })),
    ...RESULT_COLUMNS.map((name) => ({ name, dtype: "<f8" })),
    ...EVIDENCE_COLUMNS.map((name) => ({ name, dtype: "u1" })),
  ].map((column) => ({ ...column, sha256: key(`column:${column.name}`) }));
}

/** Three signed classes covering all fifty-two invented rows. Unlike the run the
 * profile describes, this fixture deliberately carries negative values, so the
 * signed accounting residual is exercised in both directions. */
function signedValueCounts() {
  return RESULT_COLUMNS.map((column, index) => ({
    column,
    negative: index === 5 ? 4 : 0,
    positive: index === 5 ? 40 : 30 + index,
    zero: index === 5 ? 8 : PERSONS - (30 + index),
  }));
}

function zeroOriginClassCounts() {
  return INCOME_YEARS.map((income_year, year) => ({
    income_year,
    observed_amount: 3 + year,
    niu_below_receipt_age: 2,
    reported_receipt_zero_amount: 1,
    reported_no_receipt: 6,
    niu_in_age_universe: 4 + year,
  }));
}

export interface InventedIncomeV3Options {
  /** Drop the profile declaration from the graph artifact only, so the two
   * artifacts disagree about which contract they are written to. */
  profileOnBuildOnly?: boolean;
  /** Declare a profile neither artifact's fields belong to. */
  profileId?: string;
}

export function inventedIncomeV3(options: InventedIncomeV3Options = {}) {
  const by_node = Object.fromEntries(
    NODES.map((id) => [
      id,
      {
        kernel_ref: `us.${id}@3`,
        // The engine kernel is built apart from the other four, so two distinct
        // implementation hashes cover five nodes.
        kernel_impl_hash: id.endsWith("engine_current_money") ? h("a") : h("b"),
      },
    ]),
  );
  const implementation_set = {
    sha256: createHash("sha256")
      .update(
        [...NODES]
          .sort()
          .map((id) => `${id}\t${by_node[id].kernel_impl_hash}\n`)
          .join(""),
        "ascii",
      )
      .digest("hex"),
    by_node,
  };

  const identity = {
    run_head: "1".repeat(40),
    run_receipt_sha256: key("run-receipt"),
    runner_sha256: key("runner"),
    roster_sha256: key("roster"),
    approval_sha256: key("approval"),
    exporter_sha256: key("exporter"),
    operator_declaration_sha256: key("operator-declaration"),
    runtime_identity_sha256: key("runtime-identity"),
  };
  const profileIdentity = {
    root_output_review_sha256: key("root-output-review"),
    base_exporter_sha256: key("base-exporter"),
    loaded_module_manifest_sha256: key("loaded-module-manifest"),
  };

  const artifactKey = (node: number, artifact: string) =>
    key(`artifact:${NODES[node]}:${artifact}`);
  const nodeKey = (node: number) => key(`node:${NODES[node]}`);

  const typedOutput = (node: number, artifact: string) => ({
    name: artifact,
    artifact,
    type: `microcosm.invented.${artifact}`,
    type_version: 1,
    artifact_key: artifactKey(node, artifact),
    numeric: "platform_bitwise",
    tolerance: null,
  });

  const node = (index: number, warm: boolean): ProjectionNode => ({
    id: NODES[index],
    label: LABELS[index],
    group: "engineering",
    group_label: "Engineering graph",
    role: "compute",
    receipt_present: true,
    failed: false,
    blocked: false,
    gate_exception: false,
    execution_record: null,
    receipt_outcome: null,
    cache: warm ? "hit" : "computed",
    node_key: nodeKey(index),
    ...by_node[NODES[index]],
    determinism: index === 1 ? "seeded" : "deterministic",
    numeric: "platform_bitwise",
    tolerance: null,
    runtime_dependencies: ["invented_runtime"],
    seed: index === 1 ? "7" : "0",
    wall_time_seconds: warm ? 0.01 : 1 + index,
    frame_key: null,
    weight_key: null,
    phase: "prepare_asec_current_money_slice",
    typed_inputs: INPUTS[index].map((input) => ({
      ...typedOutput(input.from, input.artifact),
      name: input.name,
      producer: NODES[input.from],
      producer_key: nodeKey(input.from),
    })),
    typed_outputs: OUTPUTS[index].map((artifact) => typedOutput(index, artifact)),
    opaque_artifact_keys: OUTPUTS[index].map((artifact) => ({
      name: artifact,
      key: artifactKey(index, artifact),
    })),
    column_artifact_counts: [
      { entity: "household", count: 2 },
      { entity: "person", count: 3 },
    ],
    column_artifact_total: 5,
    gate: null,
    source_pins: [],
    measures: [],
  });

  const executions = ["cold", "warm"].map((mode) => {
    const warm = mode === "warm";
    return {
      mode,
      label: warm ? "Fresh warm reuse" : "Cold graph execution",
      description: warm
        ? "Recorded complete cache reuse in a distinct process."
        : "Recorded execution of five graph kernels and one separate source preparation.",
      execution_manifest_sha256: key(`manifest:${mode}`),
      computation_content_key: key("content"),
      kernel_calls: warm ? 0 : NODES.length,
      source_preparation_calls: warm ? 0 : 1,
      computed_count: warm ? 0 : NODES.length,
      cache_hit_count: warm ? NODES.length : 0,
      failed_node_ids: [],
      blocked_node_ids: [],
      gate_exception_node_ids: [],
      nodes: NODES.map((_, index) => node(index, warm)),
    };
  });

  const graphPayload = key("payload:graph-accounting");
  const bodyDigest = key("payload:accounting-body");
  const common = {
    country: "us",
    profile: options.profileId ?? INVENTED_INCOME_V3_PROFILE,
    candidate_release_id: "invented-asec-income-v3-15hh-v1",
    run_id: "invented-income-v3-run",
    ...identity,
    ...profileIdentity,
    implementation_set,
    source_sha256: { invented_income_source: key("source") },
  };

  const graph: Record<string, unknown> = {
    schema_version: "microcosm.graph_receipts.v1",
    ...common,
    population_sha256: key("checkpoint"),
    period: "2024",
    entity: "household",
    period_basis: "operator_declared",
    period_reason: "Invented target period declaration.",
    computation_content_key: key("content"),
    provenance_note: "Invented authenticated aggregate attachment.",
    label_basis: "Invented presentation metadata.",
    coverage: {
      basis: "recorded_execution_roster",
      complete: true,
      reason: "All five invented graph nodes are included.",
    },
    content_key_note:
      "Shared computation content key is distinct from each execution byte digest.",
    scope: {
      households: 15,
      persons: PERSONS,
      tax_units: 25,
      households_by_source_cohort: INCOME_YEARS.map((income_year) => ({
        income_year,
        households: 5,
      })),
      money_field_axes: 33,
      housing_universe_evidence_fields: 7,
      housing_universe_carried_cells: 12,
      loaded_module_count: 214,
      note: "Fifteen invented households from three source cohorts. This small engineering sample does not establish population accuracy.",
    },
    quality: {
      status: "incomplete",
      basis: "engineering_completion_only",
      score: null,
      score_reason:
        "No score is published: nothing here measures agreement with any external total.",
      missing: [
        "calibration",
        "fit",
        "holdouts",
        "national_totals",
        "congressional_district_pass",
        "completed_eight_component_acs_bridge",
        "distributions",
        "support",
        "model_validation",
      ],
      note: "Cache equality and recorded parity are engineering evidence. They authorize no release, national claim or district analysis.",
    },
    reported_income: {
      rows: PERSONS,
      accounting_column_count: 28,
      accounting_row_bytes: 91,
      arithmetic_order:
        "W=WSAL_VAL;E=SEMP_VAL+FRSE_VAL;S=SSI_VAL;P=PAW_VAL_2024_price;T=PTOTVAL;U=T-(((W+E)+S)+P)",
      accounting_columns: accountingColumns(),
      result_column_sha256: RESULT_COLUMNS.map((column) => ({
        column,
        sha256: key(`result:${column}`),
      })),
      typed_evidence_axis_count: 4,
      raw_public_assistance_evidence_count: 3,
      alternative_association_sha256: key("alternative-association"),
      alternative_association_differs: true,
      signed_value_counts: signedValueCounts(),
      zero_origin_class_counts: zeroOriginClassCounts(),
      basis: {
        measure: "observed_reported_source_income",
        nominal_source: "asec_reported_nominal_amounts",
        price_basis: "census_ccpiu_annual_2024",
        price_target_year: "2024",
        price_basis_resource_sha256:
          "88cec207a3c73e5de93d677acf16e8db9ddae9761c644c06da92cacf0feb3f63",
        reference_period: "interview_household_one_year_after_income_year",
        residual_meaning:
          "signed_source_accounting_residual_not_acs_other_income",
        note: "Invented amounts as recorded by the source, restated to 2024 annual average C-CPI-U dollars on the census_ccpiu_annual_2024 basis that the accounting node records. The unallocated column is a signed accounting residual, not an estimate of any income category.",
      },
      not_claimed: [
        "simulated_ssi",
        "simulated_tanf",
        "acs_other_income",
        "completed_eight_component_acs_bridge",
        "prior_wages",
      ],
    },
    path_output_identities: {
      engine_evaluation: {
        direct_sha256: key("direct-engine-evaluation"),
        graph_sha256: key("graph-engine-evaluation"),
        differs: true,
      },
      reported_income: {
        direct_sha256: key("direct-accounting"),
        graph_sha256: graphPayload,
        differs: true,
        body_sha256: bodyDigest,
      },
      note: "The direct and graph paths encode these two artifacts separately, so their byte digests are kept apart.",
    },
    lineage_divergence: {
      fields: [
        "selected_money_sha256",
        "selection_producer_key",
        "selection_sha256",
        "source_producer_key",
      ],
      count: 4,
      note: "The direct and graph accounting headers differ only in these lineage identities. Recorded body digest and column roster are equal, so a lineage difference is not a value difference.",
    },
    executions,
  };

  const build: Record<string, unknown> = {
    schema_version: "microcosm.graph_build_summary.v1",
    ...common,
    graph_receipts_sha256: digestOf(graph),
    checks: {
      direct: {
        population_sha256: key("checkpoint"),
        receipt_sha256: key("receipt:direct"),
        household_count: 15,
        person_count: PERSONS,
        tax_unit_count: 25,
        source_preparation_calls: 1,
        reported_income_rows: PERSONS,
        reported_income_body_sha256: bodyDigest,
      },
      ...Object.fromEntries(
        executions.map((execution) => [
          execution.mode,
          {
            population_sha256: key("checkpoint"),
            receipt_sha256: key(`receipt:${execution.mode}`),
            execution_manifest_sha256: execution.execution_manifest_sha256,
            computation_content_key: execution.computation_content_key,
            kernel_calls: execution.kernel_calls,
            source_preparation_calls: execution.source_preparation_calls,
            direct_checkpoint_table_weight_parity: true,
            direct_real_engine_array_parity: true,
            money_33_fields_all_axes_parity: true,
            reported_income_payload_sha256: graphPayload,
            reported_income_body_sha256: bodyDigest,
          },
        ]),
      ),
    },
  };

  const manifest: CandidateQualityManifest = {
    schema_version: "microcosm.candidate_quality.v1",
    country: "us",
    candidate_release_id: common.candidate_release_id,
    run_id: common.run_id,
    created_at: "2026-09-06T00:00:00Z",
    execution_status: "completed",
    release_eligibility: {
      status: "excluded",
      reason:
        "Invented uncalibrated fifteen household engineering slice, excluded from release.",
    },
    population: {
      sha256: key("checkpoint"),
      period: "2024",
      entity: "household",
    },
    geography: null,
    provenance: {
      ...identity,
      ...profileIdentity,
      implementation_set_sha256: implementation_set.sha256,
    },
    attachments: {
      graph_receipts: {
        status: "available",
        scope: "population",
        sha256: digestOf(graph),
        path: `artifacts/${digestOf(graph)}.json`,
        identity: {
          country: "us",
          candidate_release_id: common.candidate_release_id,
          run_id: common.run_id,
          population_sha256: key("checkpoint"),
        },
      },
      build_manifest: {
        status: "available",
        scope: "run",
        sha256: digestOf(build),
        path: `artifacts/${digestOf(build)}.json`,
        identity: {
          country: "us",
          candidate_release_id: common.candidate_release_id,
          run_id: common.run_id,
        },
      },
      calibration_diagnostics: {
        status: "missing",
        reason:
          "Not evaluated for this invented uncalibrated fifteen household engineering slice.",
      },
    },
  };

  // Dropped last, so both artifacts still content-address the same bytes and
  // the refusal under test is the profile disagreement itself.
  if (options.profileOnBuildOnly) delete graph.profile;

  return { graph, build, manifest, manifestSha: digestOf(manifest) };
}
