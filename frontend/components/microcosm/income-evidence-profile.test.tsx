// What the reader is told when an attachment declares the income-v3 profile,
// and what the same surface keeps saying when it declares none. Rendered from
// the invented fixture only; no genuine export exists and none is read here.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ReceiptGraphSurface } from "./receipt-graph-view";
import { buildReceiptGraph } from "@/lib/microcosm/graph/adapter";
import { normalizeGraphAttachment } from "@/lib/microcosm/graph/attachment";
import { inventedGraph } from "@/lib/microcosm/graph/fixtures/invented-graph";
import { inventedIncomeV3 } from "@/lib/microcosm/graph/fixtures/invented-income-v3";

function surface(fixture: { graph: unknown; build: unknown; manifest: any; manifestSha: string }) {
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

const INCOME = surface(inventedIncomeV3());
const LEGACY = surface(inventedGraph());

describe("an attachment with no declared profile is drawn exactly as before", () => {
  test("no profile section appears", () => {
    expect(LEGACY.payload.evidence_profile).toBeUndefined();
    expect(LEGACY.markup).not.toContain("Engineering completion");
    expect(LEGACY.markup).not.toContain("Reported source income");
    expect(LEGACY.markup).not.toContain("Three recorded paths");
  });

  test("the surface it always drew is still there", () => {
    expect(LEGACY.markup).toContain("Steps, output first");
    expect(LEGACY.markup).toContain("What this run is not connected to");
    expect(LEGACY.markup).toContain("What was checked before any of this was drawn");
  });
});

describe("the income-v3 profile is drawn without displacing the existing surface", () => {
  test("the established graph surface is still there", () => {
    expect(INCOME.markup).toContain("Steps, output first");
    expect(INCOME.markup).toContain("What this run is not connected to");
    expect(INCOME.markup).toContain("What was checked before any of this was drawn");
    expect(INCOME.markup).toContain('data-testid="canvas"');
  });

  test("all five steps are listed with their native ids", () => {
    for (const id of [
      "asec_prepared.create",
      "asec_prepared.select_households",
      "asec_prepared.cps_carried_current",
      "asec_prepared.engine_current_money",
      "asec_prepared.reported_income",
    ])
      expect(INCOME.markup).toContain(id);
  });

  test("the typed edges the receipts declare are recorded on the payload", () => {
    expect(INCOME.payload.coverage.recorded_edges).toBe(INCOME.payload.edges.length);
    expect(INCOME.payload.edges.length).toBeGreaterThanOrEqual(4);
    expect(INCOME.payload.coverage.unconnected_nodes).toBe(0);
  });
});

describe("quality is drawn as incomplete, never as a passing population check", () => {
  test("the absence of a score is drawn rather than omitted", () => {
    expect(INCOME.markup).toContain("Quality incomplete");
    expect(INCOME.markup).toContain("No score");
    expect(INCOME.markup).toContain(
      "nothing here measures agreement with any external total",
    );
  });

  test("every unmeasured item is named", () => {
    for (const missing of [
      "calibration",
      "fit",
      "holdouts",
      "national totals",
      "congressional district pass",
      "model validation",
    ])
      expect(INCOME.markup).toContain(missing);
  });

  test("no fit, national or district claim is made", () => {
    expect(INCOME.markup).toContain(
      "Nothing below is a statement about a population, a national total or a congressional district.",
    );
    expect(INCOME.markup).not.toContain("population quality");
    expect(INCOME.markup).not.toMatch(/calibrat(ed|ion) (score|passed)/i);
  });

  test("the slice says it is not a sample of a population", () => {
    expect(INCOME.markup).toContain("Engineering slice");
    expect(INCOME.markup).toContain("not a sample of any population");
  });
});

describe("the accounting is readable without reading the hashes", () => {
  test("the counts a reader judges the slice by are in the open", () => {
    expect(INCOME.markup).toContain("Households");
    expect(INCOME.markup).toContain("People");
    expect(INCOME.markup).toContain("Tax units");
  });

  test("source years and the price basis are stated", () => {
    expect(INCOME.markup).toContain("Households by source income year");
    for (const year of ["2022", "2023", "2024"]) expect(INCOME.markup).toContain(year);
    expect(INCOME.markup).toContain("2024 price target");
    expect(INCOME.markup).toContain("cpi u rs 2024 price target year");
    expect(INCOME.markup).toContain(
      "interview household one year after income year",
    );
  });

  test("the residual is named as a residual, not as an income category", () => {
    expect(INCOME.markup).toContain(
      "signed source accounting residual not acs other income",
    );
  });

  test("zero and status coverage is drawn per source year", () => {
    expect(INCOME.markup).toContain("Where a zero came from, by source income year");
    for (const klass of [
      "observed amount",
      "niu below receipt age",
      "reported receipt zero amount",
      "reported no receipt",
      "niu in age universe",
    ])
      expect(INCOME.markup).toContain(klass);
  });

  test("each signed composition is described for a reader who cannot see it", () => {
    expect(INCOME.markup).toContain(
      "Signed values in asec_reported_income_unallocated_2024_price",
    );
    expect(INCOME.markup).toContain("positive: 40");
    expect(INCOME.markup).toContain("negative: 4");
  });

  test("the arithmetic is shown as its own statements", () => {
    for (const statement of ["W=WSAL_VAL", "U=T-(((W+E)+S)+P)"])
      expect(INCOME.markup).toContain(statement);
  });

  test("withheld claims are shown as withheld", () => {
    expect(INCOME.markup).toContain("Withheld, and stated as withheld");
    expect(INCOME.markup).toContain("simulated ssi");
    expect(INCOME.markup).toContain("simulated tanf");
  });
});

describe("what the source reported is kept apart from what the model produced", () => {
  test("both sides are named, and the absence of a comparison is stated", () => {
    expect(INCOME.markup).toContain("Reported by the source");
    expect(INCOME.markup).toContain("Produced by the model");
    expect(INCOME.markup).toContain("Nothing here compares the two");
  });

  test("the missing link is read off the recorded edges, not asserted", () => {
    // The invented run records no artifact from the engine into the accounting,
    // so the surface says that, and says what follows from it.
    expect(INCOME.markup).toContain(
      "No recorded typed artifact runs from the engine step to the accounting step",
    );
  });
});

describe("the three paths and their differences", () => {
  test("the direct path is drawn as not a graph execution", () => {
    expect(INCOME.markup).toContain("Three recorded paths");
    expect(INCOME.markup).toContain("Not a graph execution");
    expect(INCOME.markup).toContain("no graph kernel ran on this path");
    expect(INCOME.markup).toContain(
      "None: this path recorded no execution manifest.",
    );
  });

  test("cold and warm are both drawn as graph executions", () => {
    expect(INCOME.markup).toContain("Cold graph execution");
    expect(INCOME.markup).toContain("Fresh warm reuse");
    expect(INCOME.markup).toContain("Graph execution");
  });

  test("separately encoded bytes are shown as separate, and the body as shared", () => {
    expect(INCOME.markup).toContain("Separately encoded bytes");
    expect(INCOME.markup).toContain("Body, on every path");
  });

  test("a lineage difference is distinguished from a value difference", () => {
    expect(INCOME.markup).toContain("Lineage identities that differ");
    expect(INCOME.markup).toContain("selection_sha256");
    expect(INCOME.markup).toContain("a lineage difference is not a value difference");
  });
});

describe("identifiers stay reachable in the section they belong to", () => {
  test("the accounting's own digests sit with the accounting", () => {
    expect(INCOME.markup).toContain("Column identifiers and evidence digests");
  });

  test("each path carries its own identifiers", () => {
    for (const label of [
      "Direct path identifiers",
      "Cold graph execution identifiers",
      "Fresh warm reuse identifiers",
    ])
      expect(INCOME.markup).toContain(label);
  });

  test("the profile's own identities are named", () => {
    expect(INCOME.markup).toContain("root output review sha256");
    expect(INCOME.markup).toContain("base exporter sha256");
    expect(INCOME.markup).toContain("loaded module manifest sha256");
  });
});
