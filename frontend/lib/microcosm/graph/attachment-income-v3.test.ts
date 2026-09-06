// What the reader accepts, and what it refuses, once an attachment declares a
// publisher evidence profile. Every payload here is invented; no genuine export
// exists yet, and none is read.
import { describe, expect, test } from "bun:test";
import { buildReceiptGraph, ReceiptGraphUnavailableError } from "./adapter";
import { normalizeGraphAttachment } from "./attachment";
import { inventedGraph } from "./fixtures/invented-graph";
import { inventedIncomeV3 } from "./fixtures/invented-income-v3";
import type { CandidateQualityManifest } from "../quality/types";

type Fixture = ReturnType<typeof inventedIncomeV3>;

function verified(input: Fixture = inventedIncomeV3()) {
  return normalizeGraphAttachment(
    input.graph,
    input.manifest,
    input.manifestSha,
    input.build,
  );
}

function payloadOf(input: Fixture = inventedIncomeV3()) {
  const { projection, checks } = verified(input);
  return buildReceiptGraph(projection, input.manifest, input.build, checks);
}

/** Every mutation below has to end in the same place: the candidate's graph is
 * unavailable. A refusal that only happened to come from some other check would
 * pass this too, so each entry mutates exactly one published claim. */
function refusal(change: (input: Fixture) => void) {
  const input = inventedIncomeV3();
  change(input);
  expect(() => verified(input)).toThrow(ReceiptGraphUnavailableError);
}

const graphOf = (input: Fixture) => input.graph as Record<string, any>;
const buildOf = (input: Fixture) => input.build as Record<string, any>;

describe("the four-node contract is untouched by profiles", () => {
  test("an attachment that declares no profile still reads, and carries no profile", () => {
    const legacy = inventedGraph();
    const { projection, checks } = normalizeGraphAttachment(
      legacy.graph,
      legacy.manifest,
      legacy.manifestSha,
      legacy.build,
    );
    expect(projection.evidence_profile).toBeUndefined();
    const payload = buildReceiptGraph(
      projection,
      legacy.manifest,
      legacy.build,
      checks,
    );
    // Absent, not null: the shared legacy payload keeps the exact key set it
    // had before profiles existed.
    expect(Object.hasOwn(payload, "evidence_profile")).toBe(false);
  });

  test("the four-node shape refuses an income-v3 annotation bolted onto it", () => {
    const legacy = inventedGraph();
    (legacy.graph as Record<string, unknown>).scope = inventedIncomeV3().graph.scope;
    expect(() =>
      normalizeGraphAttachment(
        legacy.graph,
        legacy.manifest,
        legacy.manifestSha,
        legacy.build,
      ),
    ).toThrow(ReceiptGraphUnavailableError);
  });

  test("the four-node shape refuses a profile declaration with none of its fields", () => {
    const legacy = inventedGraph();
    (legacy.graph as Record<string, unknown>).profile = "us_asec_income_v3_five_node_15hh";
    (legacy.build as Record<string, unknown>).profile = "us_asec_income_v3_five_node_15hh";
    expect(() =>
      normalizeGraphAttachment(
        legacy.graph,
        legacy.manifest,
        legacy.manifestSha,
        legacy.build,
      ),
    ).toThrow(ReceiptGraphUnavailableError);
  });
});

describe("cross-profile refusal", () => {
  test("a profile on the build summary alone is a contradiction, not a default", () => {
    expect(() => verified(inventedIncomeV3({ profileOnBuildOnly: true }))).toThrow(
      ReceiptGraphUnavailableError,
    );
  });

  test("a profile on the graph alone is refused", () => {
    refusal((input) => {
      delete buildOf(input).profile;
    });
  });

  test("two different declared profiles are refused", () => {
    refusal((input) => {
      buildOf(input).profile = "us_asec_income_v4_five_node_15hh";
    });
  });

  test("a profile this reader does not implement is refused", () => {
    expect(() =>
      verified(inventedIncomeV3({ profileId: "us_asec_income_v4_five_node_15hh" })),
    ).toThrow(ReceiptGraphUnavailableError);
  });

  test("the four-node profile's own pins cannot stand in for this one", () => {
    refusal((input) => {
      const legacy = inventedGraph();
      buildOf(input).checks.direct = (legacy.build as Record<string, any>).checks.direct;
    });
  });
});

describe("the invented income-v3 profile reads end to end", () => {
  const payload = payloadOf();
  const profile = payload.evidence_profile!;

  test("the five recorded nodes and their typed edges are drawn", () => {
    expect(payload.nodes.map((node) => node.id).sort()).toEqual([
      "asec_prepared.cps_carried_current",
      "asec_prepared.create",
      "asec_prepared.engine_current_money",
      "asec_prepared.reported_income",
      "asec_prepared.select_households",
    ]);
    expect(payload.edges.length).toBeGreaterThan(0);
    for (const edge of payload.edges) expect(edge.basis).toBe("typed_artifact");
    // The accounting node's recorded inputs come from the preparation and the
    // selection. Nothing declares the engine's evaluation as an input to it.
    const intoAccounting = payload.edges
      .filter((edge) => edge.to === "asec_prepared.reported_income")
      .map((edge) => edge.from)
      .sort();
    expect(intoAccounting).toEqual([
      "asec_prepared.create",
      "asec_prepared.select_households",
    ]);
  });

  test("the profile is carried onto the payload with its own identity", () => {
    expect(profile.id).toBe("us_asec_income_v3_five_node_15hh");
    expect(profile.identities.map((entry) => entry.key)).toEqual([
      "root_output_review_sha256",
      "base_exporter_sha256",
      "loaded_module_manifest_sha256",
    ]);
  });

  test("scope is an engineering slice, and its cohorts add up", () => {
    expect(profile.scope.households).toBe(15);
    expect(profile.scope.persons).toBe(52);
    expect(profile.scope.tax_units).toBe(25);
    expect(
      profile.scope.households_by_source_cohort.reduce(
        (total, cohort) => total + cohort.households,
        0,
      ),
    ).toBe(15);
  });

  test("quality is incomplete with no score and a named missing list", () => {
    expect(profile.quality.status).toBe("incomplete");
    expect(profile.quality.score).toBeNull();
    expect(profile.quality.missing).toContain("calibration");
    expect(profile.quality.missing).toContain("national_totals");
    expect(profile.quality.missing).toContain("model_validation");
  });

  test("the accounting statement is split at the publisher's own separators", () => {
    expect(profile.reported_income.arithmetic_statements).toEqual([
      "W=WSAL_VAL",
      "E=SEMP_VAL+FRSE_VAL",
      "S=SSI_VAL",
      "P=PAW_VAL_2024_price",
      "T=PTOTVAL",
      "U=T-(((W+E)+S)+P)",
    ]);
  });

  test("every result column's signed classes cover every accounted row", () => {
    expect(profile.reported_income.results).toHaveLength(6);
    for (const result of profile.reported_income.results)
      expect(result.negative + result.zero + result.positive).toBe(
        profile.reported_income.rows,
      );
  });

  test("zero-origin coverage is kept per source year", () => {
    expect(profile.reported_income.zero_origin.map((entry) => entry.income_year))
      .toEqual(["2022", "2023", "2024"]);
    for (const entry of profile.reported_income.zero_origin) {
      expect(entry.classes).toHaveLength(5);
      expect(entry.total).toBe(
        entry.classes.reduce((sum, item) => sum + item.count, 0),
      );
    }
  });

  test("the two paths' output identities are kept apart, not forced equal", () => {
    const accounting = profile.path_output_identities.artifacts.find(
      (entry) => entry.key === "reported_income",
    )!;
    expect(accounting.differs).toBe(true);
    expect(accounting.direct_sha256).not.toBe(accounting.graph_sha256);
    expect(accounting.body_sha256).not.toBeNull();
  });

  test("the direct path is reported as a path, not as a third graph execution", () => {
    expect(profile.paths.map((path) => path.key)).toEqual(["direct", "cold", "warm"]);
    const [direct, cold, warm] = profile.paths;
    expect(direct.graph_execution).toBe(false);
    expect(direct.execution_manifest_sha256).toBeNull();
    expect(direct.kernel_calls).toBeNull();
    expect(direct.source_preparation_calls).toBe(1);
    expect(cold.graph_execution).toBe(true);
    expect(cold.kernel_calls).toBe(5);
    expect(cold.source_preparation_calls).toBe(1);
    expect(warm.kernel_calls).toBe(0);
    expect(warm.source_preparation_calls).toBe(0);
    expect(warm.cache_hit_count).toBe(5);
  });

  test("a lineage difference is published as a roster, with its own count", () => {
    expect(profile.lineage_divergence.count).toBe(
      profile.lineage_divergence.fields.length,
    );
    expect(profile.lineage_divergence.fields).toContain("selection_sha256");
  });

  test("the binding checks say the profile's own fields were checked", () => {
    expect(
      payload.binding.checks.some((check) => check.label === "Declared evidence profile"),
    ).toBe(true);
  });
});

describe("corrupted income-v3 annotations are refused", () => {
  const cases: [string, (input: Fixture) => void][] = [
    ["a sixteenth household", (i) => { graphOf(i).scope.households = 16; }],
    ["a person count the profile does not describe", (i) => { graphOf(i).scope.persons = 51; }],
    ["a tax unit count the profile does not describe", (i) => { graphOf(i).scope.tax_units = 24; }],
    ["cohorts that do not add up to the households", (i) => { graphOf(i).scope.households_by_source_cohort[0].households = 4; }],
    ["a fourth source cohort", (i) => { graphOf(i).scope.households_by_source_cohort.push({ income_year: "2025", households: 0 }); }],
    ["a different money axis count", (i) => { graphOf(i).scope.money_field_axes = 32; }],
    ["fewer housing universe evidence fields", (i) => { graphOf(i).scope.housing_universe_evidence_fields = 6; }],
    ["fewer carried cells than evidence fields", (i) => { graphOf(i).scope.housing_universe_carried_cells = 3; }],
    ["no loaded modules at all", (i) => { graphOf(i).scope.loaded_module_count = 0; }],
    ["a scope field this profile does not publish", (i) => { graphOf(i).scope.extra = 1; }],
    ["a missing scope block", (i) => { delete graphOf(i).scope; }],
    ["quality declared complete", (i) => { graphOf(i).quality.status = "complete"; }],
    ["a quality score where the contract publishes none", (i) => { graphOf(i).quality.score = 0.94; }],
    ["a shortened missing list", (i) => { graphOf(i).quality.missing.pop(); }],
    ["a reordered missing list", (i) => { graphOf(i).quality.missing.reverse(); }],
    ["a different quality basis", (i) => { graphOf(i).quality.basis = "calibrated"; }],
    ["accounted rows that disagree with the person count", (i) => { graphOf(i).reported_income.rows = 51; }],
    ["a twenty-seventh accounting column", (i) => { graphOf(i).reported_income.accounting_columns.pop(); }],
    ["a column count that disagrees with the roster", (i) => { graphOf(i).reported_income.accounting_column_count = 27; }],
    ["declared widths that no longer reach the row", (i) => { graphOf(i).reported_income.accounting_columns[0].dtype = "u1"; }],
    ["a row width the columns do not reach", (i) => { graphOf(i).reported_income.accounting_row_bytes = 90; }],
    ["a duplicated accounting column name", (i) => { graphOf(i).reported_income.accounting_columns[27].name = graphOf(i).reported_income.accounting_columns[26].name; }],
    ["a result column absent from the accounting roster", (i) => { graphOf(i).reported_income.accounting_columns[0].name = "invented_replacement"; }],
    ["a rewritten arithmetic order", (i) => { graphOf(i).reported_income.arithmetic_order = "U=T-W"; }],
    ["reordered result columns", (i) => { graphOf(i).reported_income.result_column_sha256.reverse(); }],
    ["signed classes that do not cover the rows", (i) => { graphOf(i).reported_income.signed_value_counts[0].zero += 1; }],
    ["a zero-origin class count beyond the person rows", (i) => { graphOf(i).reported_income.zero_origin_class_counts[0].observed_amount = 53; }],
    ["a zero-origin class this profile does not publish", (i) => { graphOf(i).reported_income.zero_origin_class_counts[0].invented_class = 0; }],
    ["a source year this profile does not describe", (i) => { graphOf(i).reported_income.zero_origin_class_counts[2].income_year = "2025"; }],
    ["a different price target", (i) => { graphOf(i).reported_income.basis.price_target = "nominal"; }],
    ["a residual redescribed as an income category", (i) => { graphOf(i).reported_income.basis.residual_meaning = "acs_other_income"; }],
    ["a shortened withheld-claim list", (i) => { graphOf(i).reported_income.not_claimed.pop(); }],
    ["a claim quietly withdrawn from the withheld list", (i) => { graphOf(i).reported_income.not_claimed[0] = "simulated_something"; }],
    ["two paths called identical while their digests differ", (i) => { graphOf(i).path_output_identities.reported_income.differs = false; }],
    ["two paths called different while their digests agree", (i) => { graphOf(i).path_output_identities.engine_evaluation.graph_sha256 = graphOf(i).path_output_identities.engine_evaluation.direct_sha256; }],
    ["an accounting body the direct path does not share", (i) => { buildOf(i).checks.direct.reported_income_body_sha256 = "0".repeat(64); }],
    ["an accounting body one graph path does not share", (i) => { buildOf(i).checks.warm.reported_income_body_sha256 = "0".repeat(64); }],
    ["a graph payload digest the identities block does not name", (i) => { buildOf(i).checks.cold.reported_income_payload_sha256 = "0".repeat(64); }],
    ["direct rows that disagree with the accounted rows", (i) => { buildOf(i).checks.direct.reported_income_rows = 51; }],
    ["a direct check missing this profile's own fields", (i) => { delete buildOf(i).checks.direct.tax_unit_count; }],
    ["an execution check missing this profile's own fields", (i) => { delete buildOf(i).checks.cold.reported_income_payload_sha256; }],
    ["a lineage count that disagrees with its roster", (i) => { graphOf(i).lineage_divergence.count = 3; }],
    ["a duplicated lineage field", (i) => { graphOf(i).lineage_divergence.fields[1] = graphOf(i).lineage_divergence.fields[0]; }],
    ["an empty lineage roster", (i) => { graphOf(i).lineage_divergence.fields = []; graphOf(i).lineage_divergence.count = 0; }],
    ["a build summary missing a profile identity", (i) => { delete buildOf(i).base_exporter_sha256; }],
    ["a profile identity the two artifacts disagree about", (i) => { buildOf(i).root_output_review_sha256 = "0".repeat(64); }],
    ["a profile identity the candidate manifest does not carry", (i) => { (i.manifest as CandidateQualityManifest).provenance.loaded_module_manifest_sha256 = "0".repeat(64); }],
    ["a graph field this profile does not publish", (i) => { graphOf(i).invented_extra = 1; }],
    ["a sixth node", (i) => { graphOf(i).implementation_set.by_node["asec_prepared.sixth"] = { kernel_ref: "us.asec_prepared.sixth@3", kernel_impl_hash: "b".repeat(64) }; }],
    ["a kernel reference from another compiled graph", (i) => { const node = graphOf(i).executions[0].nodes[0]; node.kernel_ref = "us.asec_prepared.create@2"; graphOf(i).implementation_set.by_node["asec_prepared.create"].kernel_ref = "us.asec_prepared.create@2"; }],
    ["a node recorded under another phase", (i) => { graphOf(i).executions[1].nodes[0].phase = "prepare_something_else"; }],
    ["a warm reuse that called a kernel", (i) => { const warm = graphOf(i).executions[1]; warm.nodes[0].cache = "computed"; warm.kernel_calls = 1; warm.computed_count = 1; warm.cache_hit_count = 4; buildOf(i).checks.warm.kernel_calls = 1; }],
    ["a cold execution that prepared no source", (i) => { graphOf(i).executions[0].source_preparation_calls = 0; buildOf(i).checks.cold.source_preparation_calls = 0; }],
    ["an execution mode this profile does not describe", (i) => { graphOf(i).executions[0].mode = "tepid"; buildOf(i).checks.tepid = buildOf(i).checks.cold; delete buildOf(i).checks.cold; }],
  ];
  for (const [name, change] of cases) test(name, () => refusal(change));
});
