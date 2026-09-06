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
import { buildReceiptGraph } from "./adapter";
import { normalizeGraphAttachment, INCOME_SIZED_PROFILE, INCOME_V3_PROFILE } from "./attachment";
import type { CandidateQualityManifest } from "../quality/types";

const ROOT = join(import.meta.dir, "fixtures/income-sized-exporter-written");

/** The digests these files were committed under. The exporter names every file
 * it writes after its own sha256, so a file whose content no longer hashes to
 * its own name has been edited since -- which would make every test below a
 * test of an edit rather than of the exporter. */
const SHAPES = {
  small: {
    manifest: "f91d2c286d3c1300e85eac3f4922b8790103189475df4cf4d22a940f18dbc3b4",
    graph: "8936f6348daae1bb2106f54d704d808d86eb992ed8c11bb672f0a2e22e63a4f2",
    build: "80b2a8b8e20f587f14e07116caaa409abe5f5c65229c755350a15b1b8e7e5931",
    candidate: "us-asec-income-sized-invented-small-equal-cohorts-v1",
    households: 9,
    persons: 31,
    taxUnits: 14,
    cohorts: [3, 3, 3],
    producer: "income_v3_first_genuine",
    entities: 6,
    nesting: 0,
  },
  wide: {
    manifest: "fdeef19a9c1f01cbe3ff4abdfab077a7dbe2c390334ca6153c23294839bab207",
    graph: "a0b136a9dff0cd21e175074cb45d2bbfcd2f45eff7e8e46707ae0294b6767cfc",
    build: "003f48e62271afe55805b49826c745db2887e679748ce9a3373c4bfb2f9506e5",
    candidate: "us-asec-income-sized-invented-wide-unequal-cohorts-v1",
    households: 41,
    persons: 107,
    taxUnits: 55,
    cohorts: [14, 14, 13],
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
      const recordings = new Map(
        projection.evidence_profile!.scope.measurement!.independent_recordings.map(r => [
          r.fact,
          r,
        ]),
      );
      for (const fact of ["household", "person"])
        expect(recordings.get(fact)!.recordings).toBeGreaterThanOrEqual(2);
      expect(recordings.get("household")!.count).toBe(shape.households);
      expect(recordings.get("person")!.count).toBe(shape.persons);
      for (const entry of recordings.values()) {
        expect(entry.sources).toHaveLength(entry.recordings);
        for (const source of entry.sources) expect(source.length).toBeGreaterThan(0);
      }
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
    expect(() => verify(w)).toThrow();
  });

  test("the sized profile name is not the reviewed one", () => {
    expect(INCOME_SIZED_PROFILE).not.toBe(INCOME_V3_PROFILE);
    expect(INCOME_SIZED_PROFILE).not.toContain("15hh");
    expect(INCOME_SIZED_PROFILE).not.toContain("505");
  });

  test("both artifacts must declare the same profile", () => {
    const w = written("small");
    w.build.profile = INCOME_V3_PROFILE;
    expect(() => verify(w)).toThrow();
  });
});

describe("the sized reader refuses a payload that disagrees with itself", () => {
  const cases: [string, (w: Written) => void][] = [
    ["the cohorts no longer sum to the households", w => {
      w.graph.scope.households_by_source_cohort[0].households += 1;
    }],
    ["the entity table disagrees with the headline household count", w => {
      const row = w.graph.scope.entity_rows.find((r: any) => r.entity === "household");
      row.rows += 1;
    }],
    ["more households than people", w => {
      w.graph.scope.persons = 1;
    }],
    ["a zero household count", w => {
      w.graph.scope.households = 0;
    }],
    ["a fractional person count", w => {
      w.graph.scope.persons = 30.5;
    }],
    ["a negative tax unit count", w => {
      w.graph.scope.tax_units = -1;
    }],
    ["an unsafe household count", w => {
      w.graph.scope.households = Number.MAX_SAFE_INTEGER + 2;
    }],
    ["the accounted rows disagree with the person count", w => {
      w.graph.reported_income.rows += 1;
    }],
    ["the build summary counts a different sample", w => {
      w.build.checks.direct.person_count += 1;
    }],
    ["the build summary counts different households", w => {
      w.build.checks.direct.household_count += 1;
    }],
    ["the build summary counts different tax units", w => {
      w.build.checks.direct.tax_unit_count += 1;
    }],
    ["the signed classes no longer cover the rows", w => {
      w.graph.reported_income.signed_value_counts[0].zero += 1;
    }],
    ["the zero-origin classes no longer partition the rows", w => {
      const entry = w.graph.reported_income.zero_origin_class_counts[0];
      entry.observed_amount += 1;
    }],
    ["a claimed recording count that names fewer sources", w => {
      w.graph.scope.measurement.independent_recordings[0].recordings += 1;
    }],
    ["a recorded count that disagrees with the scope", w => {
      const entry = w.graph.scope.measurement.independent_recordings.find(
        (r: any) => r.fact === "person",
      );
      entry.count += 1;
    }],
    ["a load-bearing count with a single recording", w => {
      const entry = w.graph.scope.measurement.independent_recordings.find(
        (r: any) => r.fact === "person",
      );
      entry.recordings = 1;
      entry.sources = [entry.sources[0]];
    }],
    ["an unrecognised producer schema", w => {
      w.graph.scope.producer_schema = "income_v3_some_future_producer";
    }],
    ["an entity nobody counts", w => {
      w.graph.scope.entity_rows.push({ entity: "invented_entity", rows: 3 });
    }],
    ["a nesting table dropped while still claimed", w => {
      w.graph.scope.measurement.nesting = [];
    }],
    ["a nested unit crossing a household boundary", w => {
      w.graph.scope.measurement.nesting[0].within_one_household = false;
    }],
    ["a nested entity nobody counts", w => {
      w.graph.scope.measurement.nesting[0].entity = "invented_entity";
    }],
    ["a cohort with more realised than eligible households", w => {
      w.graph.scope.households_by_source_cohort[0].eligible_households = 1;
    }],
    ["the money field axes moved with the size", w => {
      w.graph.scope.money_field_axes = 34;
    }],
    ["the accounting row width moved with the size", w => {
      w.graph.reported_income.accounting_row_bytes = 92;
    }],
  ];

  for (const [name, mutate] of cases)
    test(name, () => {
      const w = written("wide");
      mutate(w);
      expect(() => verify(w)).toThrow();
    });
});
