// The sized reader, read against bytes it did not write.
//
// The hand-written fixture and the reader are both authored on this side, so a
// test pairing them proves only that this side is self-consistent -- which is
// exactly how the income-v3 profile once came to pin a price series the
// exporter never converted with, with every test green.
//
// These tests read the bytes the sized exporter itself wrote, at two shapes,
// committed under `fixtures/income-sized-exporter-written/`. Invented data,
// real schema: nothing here describes a population, an ASEC record or a model
// output, and no genuine sized export exists to read.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { buildReceiptGraph, ReceiptGraphUnavailableError } from "./adapter";
import { normalizeGraphAttachment, INCOME_SIZED_PROFILE, INCOME_V3_PROFILE } from "./attachment";
import type { CandidateQualityManifest } from "../quality/types";

const ROOT = join(import.meta.dir, "fixtures/income-sized-exporter-written");
const SOURCE = join(import.meta.dir, "attachment.ts");

/** The digests these files were committed under. The exporter names every file
 * it writes after its own sha256, so a file whose content no longer hashes to
 * its own name has been edited since -- which would make every test below a
 * test of an edit rather than of the exporter. */
const SHAPES = {
  small: {
    manifest: "57b32b3df9fada892a99d4f5b48663c251195bcc003a827efee2830fc77a1f00",
    graph: "3694976f8b50a29ea87ae46d66ed26babe075e586c86ad60315d077d78e56a74",
    build: "a1e4dbed1a626045216618d375a4c8040ce376894c4ac05fc6ae5b583f90791e",
    population: "13973c961ea39995ac7085b2f92160485cf83abc5852685c968a34e96f1629f0",
    candidate: "us-income-sized-invented-small-v1",
    households: 9,
    persons: 31,
    taxUnits: 14,
    cohorts: [3, 3, 3],
    eligible: [300, 300, 300],
    producer: "income_v3_first_genuine",
    entities: 6,
    nesting: 0,
  },
  wide: {
    manifest: "b139714da64353e169f0c2d3affcbbf7f3efa788f6148eebf262f69151b07b0e",
    graph: "012a4fe6d7fbcf51069c600b82094284f0e5222c80fe80c0f9898767f3641caf",
    build: "3361f569e76fb6d6aca0e36c4567ebd2c3e6b55f23afa48fd77dba76741923d6",
    population: "41c38ba897e673ae6d8de157b609f7b44e6577620157ff2fca0c14c08cd9ca83",
    candidate: "us-income-sized-invented-wide-v1",
    households: 41,
    persons: 107,
    taxUnits: 55,
    cohorts: [14, 14, 13],
    eligible: [1400, 1400, 1300],
    producer: "income_v3_measured_505hh",
    entities: 6,
    nesting: 4,
  },
} as const;

type Label = keyof typeof SHAPES;
const LABELS = Object.keys(SHAPES) as Label[];

const bytesOf = (label: Label, path: string) => readFileSync(join(ROOT, label, path));
const read = (label: Label, path: string) => JSON.parse(bytesOf(label, path).toString("utf8"));
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

type Written = {
  manifest: CandidateQualityManifest;
  manifestSha: string;
  graph: Record<string, any>;
  build: Record<string, any>;
};

/** One freshly parsed copy per call, so a mutation in one case cannot leak into
 * another. The manifest gains an explicit `geography: null`, which is the app's
 * own manifest parser's normalisation of an absent geography, not a repair. */
function written(label: Label): Written {
  const index = read(label, "index.json");
  const entry = index.candidates[0];
  const manifest = { geography: null, ...read(label, entry.manifest.path) };
  return {
    manifest: manifest as CandidateQualityManifest,
    manifestSha: entry.manifest.sha256,
    graph: read(label, manifest.attachments.graph_receipts.path),
    build: read(label, manifest.attachments.build_manifest.path),
  };
}

const verify = (w: Written) =>
  normalizeGraphAttachment(w.graph, w.manifest, w.manifestSha, w.build);

describe("the committed bytes are the ones the sized exporter wrote", () => {
  for (const label of LABELS) {
    const shape = SHAPES[label];
    test(`${label}: every file is still self-addressed by its own name`, () => {
      expect(sha256(bytesOf(label, `manifests/${shape.manifest}.json`))).toBe(shape.manifest);
      expect(sha256(bytesOf(label, `artifacts/${shape.graph}.json`))).toBe(shape.graph);
      expect(sha256(bytesOf(label, `artifacts/${shape.build}.json`))).toBe(shape.build);
    });

    test(`${label}: the index this side writes only repeats the manifest's own fields`, () => {
      const index = read(label, "index.json");
      const manifest = read(label, `manifests/${shape.manifest}.json`);
      const entry = index.candidates[0];
      expect(index.candidates).toHaveLength(1);
      expect(entry.candidate_release_id).toBe(manifest.candidate_release_id);
      expect(entry.run_id).toBe(manifest.run_id);
      expect(entry.execution_status).toBe(manifest.execution_status);
      expect(entry.release_eligibility).toEqual(manifest.release_eligibility);
      expect(entry.updated_at).toBe(manifest.created_at);
    });
  }
});

describe("the reader reads what the sized exporter published", () => {
  for (const label of LABELS) {
    const shape = SHAPES[label];

    test(`${label}: the whole attachment verifies end to end`, () => {
      const w = written(label);
      const { projection } = verify(w);
      expect(projection.is_publisher_attachment).toBe(true);
      expect(projection.candidate_release_id).toBe(shape.candidate);
      expect(projection.executions.map(e => e.mode)).toEqual(["cold", "warm"]);
    });

    test(`${label}: the measured scope is read as the exporter wrote it`, () => {
      const { projection } = verify(written(label));
      const evidence = projection.evidence_profile!;
      expect(evidence.id).toBe(INCOME_SIZED_PROFILE);
      expect(evidence.scope.households).toBe(shape.households);
      expect(evidence.scope.persons).toBe(shape.persons);
      expect(evidence.scope.tax_units).toBe(shape.taxUnits);
      expect(evidence.scope.producer_schema).toBe(shape.producer);
      expect(evidence.scope.households_by_source_cohort.map(c => c.households)).toEqual([
        ...shape.cohorts,
      ]);
      expect(evidence.scope.entity_rows).toHaveLength(shape.entities);
      expect(evidence.scope.measurement!.nesting).toHaveLength(shape.nesting);
      expect(evidence.scope.measurement!.entity_structure_recorded).toBe(shape.nesting > 0);
      expect(evidence.reported_income.rows).toBe(shape.persons);
    });

    test(`${label}: the semantics are the same at either size`, () => {
      const { projection } = verify(written(label));
      const evidence = projection.evidence_profile!;
      expect(evidence.reported_income.accounting_column_count).toBe(28);
      expect(evidence.reported_income.accounting_row_bytes).toBe(91);
      expect(evidence.reported_income.columns).toHaveLength(28);
      // The real production roster, not the helper's renamed stand-ins.
      expect(evidence.reported_income.columns[0].name).toBe("person_id");
      expect(evidence.reported_income.columns.at(-1)!.name).toBe(
        "PAW_VAL.source_encoding_class",
      );
      expect(evidence.reported_income.basis.price_basis).toBe("census_ccpiu_annual_2024");
      expect(evidence.reported_income.basis.price_basis_resource_sha256).toBe(
        "88cec207a3c73e5de93d677acf16e8db9ddae9761c644c06da92cacf0feb3f63",
      );
      expect(evidence.quality.missing).toHaveLength(9);
      expect(evidence.quality.missing).not.toContain("prior_wages");
      expect(evidence.reported_income.not_claimed).toContain("prior_wages");
      expect(evidence.scope.money_field_axes).toBe(33);
      expect(evidence.scope.housing_universe_evidence_fields).toBe(7);
    });

    test(`${label}: the sample facts reconcile, at this size`, () => {
      const { projection } = verify(written(label));
      const evidence = projection.evidence_profile!;
      const cohortTotal = evidence.scope.households_by_source_cohort.reduce(
        (total, cohort) => total + cohort.households,
        0,
      );
      expect(cohortTotal).toBe(shape.households);
      expect(evidence.scope.persons).toBeGreaterThanOrEqual(shape.households);
      for (const result of evidence.reported_income.results)
        expect(result.negative + result.zero + result.positive).toBe(shape.persons);
      const zeroTotal = evidence.reported_income.zero_origin.reduce(
        (total, entry) => total + entry.total,
        0,
      );
      expect(zeroTotal).toBe(shape.persons);
      const rows = new Map(evidence.scope.entity_rows!.map(r => [r.entity, r.rows]));
      expect(rows.get("household")).toBe(shape.households);
      expect(rows.get("person")).toBe(shape.persons);
      expect(rows.get("tax_unit")).toBe(shape.taxUnits);
    });

    test(`${label}: every count names the places the run recorded it`, () => {
      const { projection } = verify(written(label));
      const scope = projection.evidence_profile!.scope;
      const located = new Map(
        scope.measurement!.recorded_count_locations.map(r => [r.fact, r]),
      );
      for (const fact of ["household", "person"])
        expect(located.get(fact)!.locations).toBeGreaterThanOrEqual(2);
      expect(located.get("household")!.count).toBe(shape.households);
      expect(located.get("person")!.count).toBe(shape.persons);
      for (const entry of located.values()) {
        expect(entry.sources).toHaveLength(entry.locations);
        expect(new Set(entry.sources).size).toBe(entry.sources.length);
        for (const source of entry.sources) expect(source.length).toBeGreaterThan(0);
        // No location name carries a phase: a warm restatement of a cold
        // location is the same place, and the publisher counts it apart.
        for (const source of entry.sources) {
          expect(source.startsWith("cold-manifest")).toBe(false);
          expect(source.startsWith("warm-manifest")).toBe(false);
        }
      }
      // The listing is closed: exactly the entity rows plus the three cohorts.
      expect(located.size).toBe(scope.entity_rows!.length + shape.cohorts.length);
      // The one fact restated by the warm execution is the node header counter.
      expect(located.get("person")!.phase_restatements).toBe(2);
      expect(located.get("household")!.phase_restatements).toBe(0);
    });

    test(`${label}: the rule is drawn with the operands it ranges over`, () => {
      const { projection } = verify(written(label));
      const scope = projection.evidence_profile!.scope;
      const measurement = scope.measurement!;
      expect(measurement.selection_rule).toBe("floor(fraction * eligible)");
      expect(measurement.selection_rule_scope).toBe("per_source_cohort");
      expect(measurement.sampling_fraction).toBe(0.01);
      expect(
        scope.households_by_source_cohort.map(c => c.eligible_households),
      ).toEqual([...shape.eligible]);
      expect(measurement.eligible_households).toBe(
        shape.eligible.reduce((total, value) => total + value, 0),
      );
    });

    test(`${label}: the nesting rows are the entity rows, asked differently`, () => {
      const { projection } = verify(written(label));
      const scope = projection.evidence_profile!.scope;
      const rows = new Map(scope.entity_rows!.map(r => [r.entity, r.rows]));
      expect(scope.measurement!.nesting).toHaveLength(shape.nesting);
      for (const entry of scope.measurement!.nesting) {
        expect(rows.get(entry.entity)).toBe(entry.rows);
        expect(["household", "person"]).not.toContain(entry.entity);
      }
    });

    test(`${label}: the lede is the counts beside it, in a sentence`, () => {
      const { projection } = verify(written(label));
      const scope = projection.evidence_profile!.scope;
      expect(scope.note).toBe(
        `${shape.households} sampled households from 3 source cohorts, ` +
          `holding ${shape.persons} people and ${shape.taxUnits} tax units. ` +
          "An engineering sample of this size establishes no population accuracy.",
      );
    });

    test(`${label}: three exporter digests, each naming one file`, () => {
      const w = written(label);
      const { projection } = verify(w);
      const identities = new Map(
        projection.evidence_profile!.identities.map(i => [i.key, i.sha256]),
      );
      expect([...identities.keys()]).toEqual([
        "root_output_review_sha256",
        "base_exporter_sha256",
        "loaded_module_manifest_sha256",
        "reviewed_exporter_sha256",
      ]);
      expect(identities.get("base_exporter_sha256")).not.toBe(
        identities.get("reviewed_exporter_sha256"),
      );
      // The same three values on all three artifacts, which is what makes them
      // provenance rather than decoration.
      for (const [key, value] of identities) {
        expect(w.build[key]).toBe(value);
        expect((w.manifest.provenance as Record<string, string>)[key]).toBe(value);
      }
    });

    test(`${label}: this shape has its own population identity`, () => {
      const { projection } = verify(written(label));
      expect(projection.population_sha256).toBe(shape.population);
    });

    test(`${label}: five graph nodes, one separate source preparation`, () => {
      const { projection } = verify(written(label));
      const cold = projection.executions.find(e => e.mode === "cold")!;
      const warm = projection.executions.find(e => e.mode === "warm")!;
      expect(cold.nodes).toHaveLength(5);
      expect(cold.kernel_calls).toBe(5);
      expect(cold.source_preparation_calls).toBe(1);
      expect(warm.kernel_calls).toBe(0);
      // The accounting node never consumes the engine.
      const accounting = cold.nodes.find(n => n.id === "asec_prepared.reported_income")!;
      expect(accounting.typed_inputs.map(a => a.producer)).not.toContain(
        "asec_prepared.engine_current_money",
      );
    });

    test(`${label}: the app draws the sized profile from it`, () => {
      const w = written(label);
      const { projection, checks } = verify(w);
      const payload = buildReceiptGraph(projection, w.manifest, w.build, checks);
      expect(payload.evidence_profile).toBeDefined();
      expect(payload.evidence_profile!.id).toBe(INCOME_SIZED_PROFILE);
      expect(payload.evidence_profile!.scope.households).toBe(shape.households);
      // Scope and quality are passed through as published, not re-derived.
      expect(payload.evidence_profile!.scope).toEqual(w.graph.scope);
      expect(payload.evidence_profile!.quality).toEqual(w.graph.quality);
    });
  }
});

describe("the two profiles refuse each other", () => {
  test("a sized payload relabelled as the fifteen-household profile is refused", () => {
    const w = written("wide");
    w.graph.profile = INCOME_V3_PROFILE;
    w.build.profile = INCOME_V3_PROFILE;
    expect(() => verify(w)).toThrow(ReceiptGraphUnavailableError);
  });

  test("the two shapes do not share a population digest", () => {
    expect(SHAPES.small.population).not.toBe(SHAPES.wide.population);
  });

  test("the sized profile name is not the reviewed one", () => {
    expect(INCOME_SIZED_PROFILE).not.toBe(INCOME_V3_PROFILE);
    expect(INCOME_SIZED_PROFILE).not.toContain("15hh");
    expect(INCOME_SIZED_PROFILE).not.toContain("505");
  });

  test("both artifacts must declare the same profile", () => {
    const w = written("small");
    w.build.profile = INCOME_V3_PROFILE;
    expect(() => verify(w)).toThrow(ReceiptGraphUnavailableError);
  });
});

/** Which check refused, not merely that one did.
 *
 * Ported from the income-v3 exporter contract test, for the same reason it
 * exists there: `refuse()` throws one message for every refusal, so "it threw"
 * says nothing about where -- and a `TypeError` from the reader or from a
 * mutation helper would satisfy a bare `toThrow()` while proving the opposite of
 * what the case claims. This walks the thrown stack for the frames inside
 * `attachment.ts`, innermost first, dropping only `refuse` and `assert`, which
 * every refusal passes through and which therefore carry no information. */
const GENERIC = new Set(["refuse", "assert"]);
const SOURCE_LINES = readFileSync(SOURCE, "utf8").split("\n");

function reachedBy(label: Label, mutate: (w: Written) => void) {
  const w = written(label);
  mutate(w);
  let error: unknown;
  try {
    verify(w);
  } catch (thrown) {
    error = thrown;
  }
  expect(error).toBeInstanceOf(ReceiptGraphUnavailableError);
  const chain = ((error as Error).stack ?? "")
    .split("\n")
    .map(raw => /^\s*at (\S+) .*attachment\.ts:(\d+):\d+/.exec(raw))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => ({ check: match[1], line: SOURCE_LINES[Number(match[2]) - 1].trim() }))
    .filter(frame => !GENERIC.has(frame.check));
  expect(chain.length).toBeGreaterThan(0);
  return chain;
}

/** Every sized mutation, the innermost checks it must travel through, the
 * line that has to raise, and the edit that provokes it. */
const CASES: [string, string[], RegExp, (w: Written) => void][] = [
  [
    "the cohorts no longer sum to the households",
    ["sizedScope", "shape", "normalizeGraphAttachment"],
    /equal\(sumOf\(s\.households_by_source_cohort as RecordValue\[\], "households"\), s\.households\);/,
    w => { w.graph.scope.households_by_source_cohort[0].households += 1; },
  ],
  [
    "the entity table disagrees with the headline household count",
    ["sizedScope", "shape", "normalizeGraphAttachment"],
    /equal\(rows\.get\("household"\), s\.households\);/,
    w => { w.graph.scope.entity_rows.find((r: any) => r.entity === "household").rows += 1; },
  ],
  [
    "more households than people",
    ["sizedScope", "shape", "normalizeGraphAttachment"],
    /assert\(s\.persons >= s\.households\);/,
    w => { w.graph.scope.persons = 1; },
  ],
  [
    "a zero household count",
    ["positiveScopeCount", "shape", "sizedScope"],
    /assert\(\(value as number\) >= 1\);/,
    w => { w.graph.scope.households = 0; },
  ],
  [
    "a fractional person count",
    ["count", "positiveScopeCount", "shape"],
    /assert\(Number\.isSafeInteger\(value\) && value >= 0\);/,
    w => { w.graph.scope.persons = 30.5; },
  ],
  [
    "a negative tax unit count",
    ["count", "positiveScopeCount", "shape"],
    /assert\(Number\.isSafeInteger\(value\) && value >= 0\);/,
    w => { w.graph.scope.tax_units = -1; },
  ],
  [
    "an unsafe household count",
    ["count", "positiveScopeCount", "shape"],
    /assert\(Number\.isSafeInteger\(value\) && value >= 0\);/,
    w => { w.graph.scope.households = Number.MAX_SAFE_INTEGER + 2; },
  ],
  [
    "the accounted rows disagree with the person count",
    ["reportedTotals", "sizedReported", "shape"],
    /equal\(sumKeys\(row, INCOME_V3\.signClasses\), r\.rows\);/,
    w => { w.graph.reported_income.rows += 1; },
  ],
  [
    "the build summary counts a different sample",
    ["incomeReading", "normalizeGraphAttachment"],
    /equal\(direct\.person_count, scope\.persons\);/,
    w => { w.build.checks.direct.person_count += 1; },
  ],
  [
    "the build summary counts different households",
    ["incomeReading", "normalizeGraphAttachment"],
    /equal\(direct\.household_count, scope\.households\);/,
    w => { w.build.checks.direct.household_count += 1; },
  ],
  [
    "the build summary counts different tax units",
    ["incomeReading", "normalizeGraphAttachment"],
    /equal\(direct\.tax_unit_count, scope\.tax_units\);/,
    w => { w.build.checks.direct.tax_unit_count += 1; },
  ],
  [
    "the signed classes no longer cover the rows",
    ["reportedTotals", "sizedReported", "shape"],
    /equal\(sumKeys\(row, INCOME_V3\.signClasses\), r\.rows\);/,
    w => { w.graph.reported_income.signed_value_counts[0].zero += 1; },
  ],
  [
    "the zero-origin classes no longer partition the rows",
    ["reportedTotals", "sizedReported", "shape"],
    /equal\(zeroOriginTotal\(r\), r\.rows\);/,
    w => { w.graph.reported_income.zero_origin_class_counts[0].observed_amount += 1; },
  ],
  [
    "a claimed location count that names fewer sources",
    ["recordedCountLocation", "boundedList", "shape"],
    /equal\(entry\.locations, \(entry\.sources as unknown\[\]\)\.length\);/,
    w => { w.graph.scope.measurement.recorded_count_locations[0].locations += 1; },
  ],
  [
    "one place named twice and counted twice",
    ["recordedCountLocation", "boundedList", "shape"],
    /unique\(entry\.sources as unknown\[\]\);/,
    w => { const e = w.graph.scope.measurement.recorded_count_locations.find((r: any) => r.fact === "person"); e.sources = [e.sources[0], ...e.sources.slice(0, e.sources.length - 1)]; },
  ],
  [
    "a recorded count that disagrees with the scope",
    ["sizedScope", "shape", "normalizeGraphAttachment"],
    /equal\(entry!\.count, count_\);/,
    w => { w.graph.scope.measurement.recorded_count_locations.find((r: any) => r.fact === "person").count += 1; },
  ],
  [
    "a load-bearing count recorded in a single place",
    ["sizedScope", "shape", "normalizeGraphAttachment"],
    /assert\(\(recorded\.get\(entity\)!\.locations as number\) >= 2\);/,
    w => { const e = w.graph.scope.measurement.recorded_count_locations.find((r: any) => r.fact === "person"); e.locations = 1; e.sources = [e.sources[0]]; },
  ],
  [
    "an unrecognised producer schema",
    ["producerSchema", "shape", "sizedScope"],
    /assert\(SIZED_PRODUCER_SCHEMAS\.includes\(name as string\)\);/,
    w => { w.graph.scope.producer_schema = "income_v3_some_future_producer"; },
  ],
  [
    "an entity nobody counts",
    ["entityRowSet", "shape", "sizedScope"],
    /assert\(Array\.isArray\(rows\) && rows\.length >= SIZED_REQUIRED_ENTITIES\.length && rows\.length <= SIZED_ENTITIES\.length\);/,
    w => { w.graph.scope.entity_rows.push({ entity: "invented_entity", rows: 3 }); },
  ],
  [
    "a nesting table dropped while still claimed",
    ["sizedMeasurement", "shape", "sizedScope"],
    /assert\(m\.entity_structure_recorded === \(\(m\.nesting as unknown\[\]\)\.length > 0\)\);/,
    w => { w.graph.scope.measurement.nesting = []; },
  ],
  [
    "a nested unit crossing a household boundary",
    ["oneOf", "shape", "nestedRow"],
    /assert\(values\.includes\(value\)\);/,
    w => { w.graph.scope.measurement.nesting[0].within_one_household = false; },
  ],
  [
    "a nested entity nobody counts",
    ["nestedEntity", "shape", "nestedRow"],
    /assert\(SIZED_NESTED_ENTITIES\.includes\(name as string\)\);/,
    w => { w.graph.scope.measurement.nesting[0].entity = "invented_entity"; },
  ],
  [
    "a nesting row disagreeing with the entity row",
    ["sizedScope", "shape", "normalizeGraphAttachment"],
    /equal\(rows\.get\(entry\.entity as string\), entry\.rows\);/,
    w => { w.graph.scope.measurement.nesting[0].rows += 53; },
  ],
  [
    "a nesting row for the household itself",
    ["nestedEntity", "shape", "nestedRow"],
    /assert\(SIZED_NESTED_ENTITIES\.includes\(name as string\)\);/,
    w => { w.graph.scope.measurement.nesting[0].entity = "household"; },
  ],
  [
    "a cohort with more realised than eligible households",
    ["sizedScope", "shape", "normalizeGraphAttachment"],
    /assert\(cohort\.eligible_households >= cohort\.households\);/,
    w => { w.graph.scope.households_by_source_cohort[0].eligible_households = 1; },
  ],
  [
    "the money field axes moved with the size",
    ["sizedScope", "shape", "normalizeGraphAttachment"],
    /equal\(s\.money_field_axes, INCOME_V3\.moneyFieldAxes\);/,
    w => { w.graph.scope.money_field_axes = 34; },
  ],
  [
    "the accounting row width moved with the size",
    ["reportedTotals", "sizedReported", "shape"],
    /equal\(r\.accounting_row_bytes, rosterRowBytes\(\)\);/,
    w => { w.graph.reported_income.accounting_row_bytes = 92; },
  ],
  [
    "a lede that contradicts the counts beside it",
    ["sizedScope", "shape", "normalizeGraphAttachment"],
    /equal\(s\.note, sizedNote\(s\)\);/,
    w => { w.graph.scope.note = "505 sampled households from 3 source cohorts, holding 1300 people and 55 tax units. An engineering sample of this size establishes no population accuracy."; },
  ],
  [
    "a lede naming a cohort count the roster does not have",
    ["sizedScope", "shape", "normalizeGraphAttachment"],
    /equal\(s\.note, sizedNote\(s\)\);/,
    w => { w.graph.scope.note = w.graph.scope.note.replace("3 source cohorts", "4 source cohorts"); },
  ],
  [
    "a fact nobody declares, added to the listing",
    ["sizedScope", "shape", "normalizeGraphAttachment"],
    /equal\(recorded\.size, rows\.size \+ INCOME_V3\.incomeYears\.length\);/,
    w => { w.graph.scope.measurement.recorded_count_locations.push({ fact: "district_households", count: 435, locations: 2, phase_restatements: 0, sources: ["a", "b"] }); },
  ],
  [
    "a selection rule the exporter never validated",
    ["selectionRule", "shape", "sizedMeasurement"],
    /equal\(rule, SIZED_SELECTION_RULE\);/,
    w => { w.graph.scope.measurement.selection_rule = "we kept the ones we liked"; },
  ],
  [
    "a selection scope the sampler does not range over",
    ["oneOf", "shape", "sizedMeasurement"],
    /assert\(values\.includes\(value\)\);/,
    w => { w.graph.scope.measurement.selection_rule_scope = "per_frame"; },
  ],
  [
    "a sampling fraction above one",
    ["samplingFraction", "shape", "sizedMeasurement"],
    /assert\(\(fraction as number\) > 0 && \(fraction as number\) <= 1\);/,
    w => { w.graph.scope.measurement.sampling_fraction = 1.5; },
  ],
  [
    "a sampling fraction of zero",
    ["samplingFraction", "shape", "sizedMeasurement"],
    /assert\(\(fraction as number\) > 0 && \(fraction as number\) <= 1\);/,
    w => { w.graph.scope.measurement.sampling_fraction = 0; },
  ],
  [
    "an eligible total that is not the cohorts added up",
    ["sizedScope", "shape", "normalizeGraphAttachment"],
    /equal\(sumOf\(s\.households_by_source_cohort as RecordValue\[\], "eligible_households"\), measurement\.eligible_households\);/,
    w => { w.graph.scope.measurement.eligible_households += 1; },
  ],
  [
    "a cohort's eligible count moved everywhere the payload records it",
    ["cohortSelectionRule", "sizedScope", "shape", "normalizeGraphAttachment"],
    /equal\(Math\.floor\(fraction \* \(cohort\.eligible_households as number\)\), cohort\.households\);/,
    w => { w.graph.scope.households_by_source_cohort[0].eligible_households += 100; w.graph.scope.measurement.eligible_households += 100; },
  ],
  [
    "a sampling fraction the counts never came out of",
    ["cohortSelectionRule", "sizedScope", "shape", "normalizeGraphAttachment"],
    /equal\(Math\.floor\(fraction \* \(cohort\.eligible_households as number\)\), cohort\.households\);/,
    w => { w.graph.scope.measurement.sampling_fraction = 0.02; },
  ],
  [
    "the reviewed exporter digest missing",
    ["shape", "normalizeGraphAttachment"],
    /assert\(Object\.keys\(o\)\.length === Object\.keys\(fields\)\.length && Object\.keys\(o\)\.every\(k => Object\.hasOwn\(fields, k\)\)\);/,
    w => { delete w.graph.reviewed_exporter_sha256; delete w.build.reviewed_exporter_sha256; },
  ],
  [
    "the reviewed exporter digest disagreeing across artifacts",
    ["normalizeGraphAttachment"],
    /equal\(build\[key\], graph\[key\]\);/,
    w => { w.build.reviewed_exporter_sha256 = "b".repeat(64); },
  ],
  [
    "the reviewed exporter digest not the one the manifest binds",
    ["normalizeGraphAttachment"],
    /equal\(graph\[key\], manifest\.provenance\[key as keyof typeof manifest\.provenance\]\);/,
    w => { w.graph.reviewed_exporter_sha256 = "c".repeat(64); w.build.reviewed_exporter_sha256 = "c".repeat(64); },
  ],
  [
    "the base and reviewed exporter digests collapsed into one",
    ["normalizeGraphAttachment"],
    /assert\(graph\.base_exporter_sha256 !== graph\.reviewed_exporter_sha256\);/,
    w => { w.graph.base_exporter_sha256 = w.graph.reviewed_exporter_sha256; w.build.base_exporter_sha256 = w.graph.reviewed_exporter_sha256; w.manifest.provenance.base_exporter_sha256 = w.graph.reviewed_exporter_sha256; },
  ],
];

/** The rule the page draws as the method, replayed against the operands the page
 * draws beside it. Both refusals live in `CASES` above; these two are the other
 * half -- that a correct run is accepted, and that the replay is a floor. */
describe("the published rule is replayed against the published operands", () => {
  test("the exporter's own counts satisfy the rule at both shapes", () => {
    for (const label of LABELS) {
      const w = written(label);
      expect(() => verify(w)).not.toThrow();
      const fraction = w.graph.scope.measurement.sampling_fraction;
      const cohorts = w.graph.scope.households_by_source_cohort;
      expect(cohorts.map((c: any) => c.eligible_households)).toEqual([...SHAPES[label].eligible]);
      for (const cohort of cohorts)
        expect(Math.floor(fraction * cohort.eligible_households)).toBe(cohort.households);
    }
  });

  test("a share whose fractional part is above a half still floors down", () => {
    // 1,400 -> 1,490. The exporter writes eligible counts that are exact
    // multiples of the fraction, so every other case here would pass against a
    // reader that rounded; 0.01 x 1,490 is 14.9, which floors to the recorded
    // 14 and rounds to 15.
    const w = written("wide");
    w.graph.scope.households_by_source_cohort[0].eligible_households += 90;
    w.graph.scope.measurement.eligible_households += 90;
    const share =
      w.graph.scope.measurement.sampling_fraction *
      w.graph.scope.households_by_source_cohort[0].eligible_households;
    expect(Math.floor(share)).toBe(w.graph.scope.households_by_source_cohort[0].households);
    expect(Math.round(share)).not.toBe(w.graph.scope.households_by_source_cohort[0].households);
    expect(() => verify(w)).not.toThrow();
  });
});

describe("the sized reader refuses a payload that disagrees with itself", () => {
  // The control. Without it a harness that refused everything -- or that had
  // stopped reading the sized profile at all -- would pass every case below.
  test("the unmutated exports are accepted", () => {
    for (const label of LABELS) expect(() => verify(written(label))).not.toThrow();
  });

  // Each case names the innermost checks the value travels through, in order,
  // and the text of the line that actually raised. Both halves matter: a chain
  // alone would accept a refusal from the right block for the wrong reason, and
  // a line alone would not say which block it belonged to.
  const cases = CASES;

  for (const [name, chain, line, mutate] of cases)
    test(name, () => {
      const reached = reachedBy("wide", mutate);
      expect(reached.slice(0, chain.length).map(frame => frame.check)).toEqual(chain);
      expect(reached[0].line).toMatch(line);
    });
});
