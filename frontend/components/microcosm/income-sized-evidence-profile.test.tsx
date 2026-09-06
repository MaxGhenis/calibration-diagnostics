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

  test("the wide shape's counts are on the page, thousands separated", () => {
    // `countReading` formats with en-US grouping, so a four-figure count is
    // drawn as "1,058" and a naive assertion on the bare digits would miss it.
    expect(WIDE.markup).toContain("41 sampled households from 3 source cohorts");
    expect(WIDE.markup).toContain(">41<");
    expect(WIDE.markup).toContain(">107<");
    expect(WIDE.markup).toContain(">55<");
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
    const recordings = WIDE.payload.evidence_profile!.scope.measurement!
      .independent_recordings;
    for (const entry of recordings) {
      expect(WIDE.markup).toContain(`${entry.recordings} places`);
      for (const source of entry.sources)
        expect(WIDE.markup).toContain(source.replace(/\./g, "."));
    }
    expect(WIDE.markup).toContain("recorded in");
  });

  test("the nesting table is drawn only when the producer recorded one", () => {
    expect(WIDE.markup).toContain("Units within one household");
    expect(SMALL.markup).not.toContain("Units within one household");
  });

  test("the producer schema is named on the page", () => {
    expect(SMALL.markup).toContain("income v3 first genuine");
    expect(WIDE.markup).toContain("income v3 measured 505hh");
  });
});

describe("the fifteen-household profile is drawn exactly as before", () => {
  test("it carries no measurement block, because its size is not measured", () => {
    expect(LEGACY.payload.evidence_profile!.scope.measurement).toBeUndefined();
    expect(LEGACY.markup).not.toContain("How this size was measured");
    expect(LEGACY.markup).not.toContain("Producer schema");
    expect(LEGACY.markup).not.toContain("Entity rows");
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
