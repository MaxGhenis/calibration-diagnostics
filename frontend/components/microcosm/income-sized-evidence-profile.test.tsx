// What the surface draws when an attachment declares the sized profile.
//
// Rendered from the bytes the sized exporter itself wrote, at both shapes, so
// the numbers on the page are the publisher's rather than this side's. Invented
// data, real schema: no genuine sized export exists and none is read here.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ReceiptGraphSurface } from "./receipt-graph-view";
import { buildReceiptGraph } from "@/lib/microcosm/graph/adapter";
import { normalizeGraphAttachment } from "@/lib/microcosm/graph/attachment";
import { inventedIncomeV3 } from "@/lib/microcosm/graph/fixtures/invented-income-v3";

const ROOT = join(
  import.meta.dir,
  "../../lib/microcosm/graph/fixtures/income-sized-exporter-written",
);

function written(label: "small" | "wide") {
  const read = (path: string) =>
    JSON.parse(readFileSync(join(ROOT, label, path)).toString("utf8"));
  const entry = read("index.json").candidates[0];
  const manifest = { geography: null, ...read(entry.manifest.path) };
  return {
    manifest,
    manifestSha: entry.manifest.sha256,
    graph: read(manifest.attachments.graph_receipts.path),
    build: read(manifest.attachments.build_manifest.path),
  };
}

function surface(fixture: {
  graph: unknown;
  build: unknown;
  manifest: any;
  manifestSha: string;
}) {
  const { projection, checks } = normalizeGraphAttachment(
    fixture.graph,
    fixture.manifest,
    fixture.manifestSha,
    fixture.build,
  );
  const payload = buildReceiptGraph(projection, fixture.manifest, fixture.build as any, checks);
  return {
    payload,
    markup: renderToStaticMarkup(
      <ReceiptGraphSurface
        payload={payload}
        mode={payload.executions[0].mode}
        selectedId=""
        onModeChange={() => {}}
        onSelect={() => {}}
        onClearSelection={() => {}}
        canvas={<div data-testid="canvas" />}
      />,
    ),
  };
}

const SMALL = surface(written("small"));
const WIDE = surface(written("wide"));
const LEGACY = surface(inventedIncomeV3());

describe("the sized profile draws the size the publisher measured", () => {
  test("the small shape's counts are on the page", () => {
    expect(SMALL.markup).toContain("9 sampled households from 3 source cohorts");
    expect(SMALL.markup).toContain(">9<");
    expect(SMALL.markup).toContain(">31<");
    expect(SMALL.markup).toContain(">14<");
  });

  test("the wide shape's counts are on the page", () => {
    expect(WIDE.markup).toContain("41 sampled households from 3 source cohorts");
    expect(WIDE.markup).toContain(">41<");
    expect(WIDE.markup).toContain(">107<");
    expect(WIDE.markup).toContain(">55<");
  });

  test("four-figure counts are drawn with a thousands separator", () => {
    // `countReading` formats with en-US grouping. The only counts above 999 on
    // this page are the eligible household totals, so this is the assertion the
    // test that used to carry this name never actually made.
    const measurement = WIDE.payload.evidence_profile!.scope.measurement!;
    expect(measurement.eligible_households).toBe(4100);
    expect(WIDE.markup).toContain("4,100");
    expect(WIDE.markup).toContain("1,400");
    expect(WIDE.markup).not.toContain(">4100<");
  });

  test("the drawn region names the sized profile it belongs to", () => {
    expect(WIDE.markup).toContain(
      'data-evidence-profile="us_asec_income_v3_five_node_sized_v1"',
    );
    expect(SMALL.markup).toContain(
      'data-evidence-profile="us_asec_income_v3_five_node_sized_v1"',
    );
  });

  test("the binding check names the sized profile by id", () => {
    for (const { payload } of [SMALL, WIDE]) {
      const check = payload.binding.checks.find(
        c => c.label === "Declared evidence profile",
      );
      expect(check).toBeDefined();
      expect(check!.detail).toContain("us_asec_income_v3_five_node_sized_v1");
    }
  });

  test("the headline entities are drawn before the rest", () => {
    // The publisher emits entity rows alphabetically, which put `family` above
    // `household` directly beneath a stat row reading households, people, tax
    // units. Ordering only; every published row is still drawn.
    const drawn = /Entity rows<\/dt>[\s\S]*?>([^<]*)</.exec(WIDE.markup)![1];
    expect(drawn.indexOf("household:")).toBeLessThan(drawn.indexOf("family:"));
    expect(drawn.indexOf("person:")).toBeLessThan(drawn.indexOf("family:"));
    expect(drawn.indexOf("tax unit:")).toBeLessThan(drawn.indexOf("family:"));
    for (const row of WIDE.payload.evidence_profile!.scope.entity_rows!)
      expect(drawn).toContain(`${row.entity.replace("_", " ")}:`);
  });

  test("unequal cohorts are drawn as recorded, not averaged", () => {
    const cohorts = WIDE.payload.evidence_profile!.scope.households_by_source_cohort;
    expect(cohorts.map(c => c.households)).toEqual([14, 14, 13]);
    expect(WIDE.markup).toContain("2022");
    expect(WIDE.markup).toContain("2023");
    expect(WIDE.markup).toContain("2024");
  });

  test("no household count is baked into the drawn surface", () => {
    for (const { markup } of [SMALL, WIDE]) {
      expect(markup).not.toContain("Fifteen sampled households");
      expect(markup).not.toContain("us_asec_income_v3_five_node_15hh");
    }
  });
});

describe("the measurement evidence is drawn, because a measured size needs it", () => {
  test("the block appears with the publisher's own basis and note", () => {
    for (const { markup } of [SMALL, WIDE]) {
      expect(markup).toContain("How this size was measured");
      expect(markup).toContain("measured from recorded outputs and reconciled");
      expect(markup).toContain("Every count above was read from the run");
    }
  });

  test("each fact is drawn with how many places recorded it, and which", () => {
    const located = WIDE.payload.evidence_profile!.scope.measurement!
      .recorded_count_locations;
    for (const entry of located) {
      if (entry.locations > 1) expect(WIDE.markup).toContain(`${entry.locations} places`);
      for (const source of entry.sources) expect(WIDE.markup).toContain(source);
    }
    expect(WIDE.markup).toContain("recorded in");
    expect(WIDE.markup).toContain("Where each count was recorded");
  });

  test("a warm restatement is drawn apart from the places that counted", () => {
    const person = WIDE.payload.evidence_profile!.scope.measurement!
      .recorded_count_locations.find(entry => entry.fact === "person")!;
    expect(person.phase_restatements).toBe(2);
    expect(WIDE.markup).toContain("restated 2");
    expect(WIDE.markup).toContain("by the warm execution");
    // No location name carries an execution phase, because a warm copy of a
    // cold location is the same place.
    expect(WIDE.markup).not.toContain("warm-manifest");
    expect(WIDE.markup).not.toContain("cold-manifest");
  });

  test("the selection rule is drawn with the operands it ranges over", () => {
    expect(WIDE.markup).toContain("1% of eligible households");
    expect(WIDE.markup).toContain("per source cohort");
    expect(WIDE.markup).toContain("41 selected from 4,100 eligible");
    expect(SMALL.markup).toContain("9 selected from 900 eligible");
    // The publisher's own rule token is still shown, beneath the reading.
    for (const { markup } of [SMALL, WIDE])
      expect(markup).toContain("floor(fraction * eligible)");
  });

  test("eligible households are drawn beside the realised cohorts", () => {
    expect(WIDE.markup).toContain("Eligible before selection");
    expect(WIDE.markup).toContain("2022: 1,400");
    expect(WIDE.markup).toContain("2024: 1,300");
    expect(SMALL.markup).toContain("2022: 300");
  });

  test("the nesting table is drawn only when the producer recorded one", () => {
    expect(WIDE.markup).toContain("Units within one household");
    expect(SMALL.markup).not.toContain("Units within one household");
  });

  test("the producer adapter is named as an adapter, not as a size", () => {
    expect(SMALL.markup).toContain("income v3 first genuine");
    expect(WIDE.markup).toContain("income v3 measured 505hh");
    for (const { markup } of [SMALL, WIDE]) {
      expect(markup).toContain("Producer adapter");
      expect(markup).toContain(
        "Names the recorded producer this export reads, not this sample.",
      );
      expect(markup).not.toContain("Producer schema");
    }
  });
});

describe("the fifteen-household profile is drawn exactly as before", () => {
  test("it carries no measurement block, because its size is not measured", () => {
    expect(LEGACY.payload.evidence_profile!.scope.measurement).toBeUndefined();
    expect(LEGACY.markup).not.toContain("How this size was measured");
    expect(LEGACY.markup).not.toContain("Producer adapter");
    expect(LEGACY.markup).not.toContain("Entity rows");
    expect(LEGACY.markup).not.toContain("Eligible before selection");
  });

  test("it still draws everything it drew", () => {
    expect(LEGACY.markup).toContain("The recorded slice");
    expect(LEGACY.markup).toContain("Reported source income");
    expect(LEGACY.markup).toContain("Households by source income year");
  });
});

describe("both sizes draw the same semantics", () => {
  test("the accounting contract does not move with the size", () => {
    for (const { markup } of [SMALL, WIDE, LEGACY]) {
      expect(markup).toContain("census_ccpiu_annual_2024");
      expect(markup).toContain("W=WSAL_VAL");
      expect(markup).toContain("person_id");
    }
  });

  test("the price basis digest is drawn on every size", () => {
    for (const { markup } of [SMALL, WIDE])
      expect(markup).toContain(
        "88cec207a3c73e5de93d677acf16e8db9ddae9761c644c06da92cacf0feb3f63",
      );
  });
});
