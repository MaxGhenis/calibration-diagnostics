// The surface is rendered from the same payload the route returns for the real
// candidate, with the canvas injected so the markup can be read without a
// browser. What is asserted here is what the reader is told, not how it looks.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SiteFooter } from "../layout/site-footer";
import { SiteHeader } from "../layout/site-header";
import { ReceiptGraphSurface } from "./receipt-graph-view";
import {
  buildReceiptGraph,
  verifyProjectionBinding,
  type ReceiptProjection,
} from "@/lib/microcosm/graph/adapter";
import projectionJson from "@/lib/microcosm/graph/receipts/us-graph-f001-geography-20260905-v1.json";
import type { CandidateQualityManifest } from "@/lib/microcosm/quality/types";

const FIXTURES = fileURLToPath(
  new URL("../../lib/microcosm/graph/fixtures/us-graph-launch-quality/", import.meta.url),
);
const read = (relative: string) =>
  JSON.parse(readFileSync(`${FIXTURES}${relative}`, "utf8"));

const MANIFEST = read(
  "manifests/ff2f231bbe96267bbb230264cece5131314edab449d9cdd03b85aa452535b885.json",
) as CandidateQualityManifest;
const EVIDENCE = read(
  "artifacts/1d3b94d8720b07cb1be22fe65efd88eba31787742c090b411d28938e40abbf6b.json",
) as Record<string, unknown>;
const PROJECTION = projectionJson as unknown as ReceiptProjection;

const PAYLOAD = buildReceiptGraph(
  PROJECTION,
  MANIFEST,
  verifyProjectionBinding(
    PROJECTION,
    MANIFEST,
    "ff2f231bbe96267bbb230264cece5131314edab449d9cdd03b85aa452535b885",
    EVIDENCE,
  ),
);

function render(
  overrides: Partial<Parameters<typeof ReceiptGraphSurface>[0]> = {},
): string {
  return renderToStaticMarkup(
    <ReceiptGraphSurface
      payload={PAYLOAD}
      mode="cold"
      selectedId=""
      onModeChange={() => undefined}
      onSelect={() => undefined}
      onClearSelection={() => undefined}
      canvas={<div data-testid="canvas" />}
      {...overrides}
    />,
  );
}

describe("the step list", () => {
  const markup = render();

  test("offers every recorded receipt, output first, with its native id", () => {
    for (const id of [
      "assign_us_puma_ladder",
      "assemble_stacked_spine",
      "assemble_stacked_spine.prepare",
      "assign_us_puma_ladder.lookup",
      "assign_us_puma_ladder.boundary",
      "assign_us_puma_ladder.gate",
    ])
      expect(markup).toContain(id);
    expect(markup.indexOf(">Geography assignment<")).toBeLessThan(
      markup.indexOf(">Spine harmonization<"),
    );
  });

  test("is made of real buttons, so it is operable from the keyboard", () => {
    expect(markup.match(/<button type="button"/g)!.length).toBeGreaterThanOrEqual(
      PAYLOAD.nodes.length,
    );
  });

  test("separates the receipts nothing connects to instead of hiding them", () => {
    expect(markup).toContain("No recorded dependency");
  });

  test("says the graph is partial and how partial", () => {
    expect(markup).toContain("Partial graph · 4 of 6 connected");
    expect(markup).toContain(PAYLOAD.coverage.reason.slice(0, 40));
  });
});

describe("the execution toggle", () => {
  test("offers both recorded executions and marks the active one", () => {
    const markup = render();
    expect(markup).toContain("Cold run");
    expect(markup).toContain("Required replay");
    expect(markup).toContain('aria-pressed="true"');
  });

  test("reports each execution's own cache split", () => {
    expect(render({ mode: "cold" })).toContain(
      "4 of 6 receipts were computed here and 2 were served from cache",
    );
    expect(render({ mode: "replay" })).toContain(
      "0 of 6 receipts were computed here and 6 were served from cache",
    );
  });
});

describe("the inspector", () => {
  test("prompts rather than pretending a step is selected", () => {
    expect(render()).toContain("Choose a step to read its receipt");
  });

  test("keeps execution, cache and gate as separate readings", () => {
    const markup = render({ selectedId: "assign_us_puma_ladder", mode: "cold" });
    expect(markup).toContain("Receipt recorded");
    expect(markup).toContain("Computed");
    expect(markup).toContain("No gate record");
    expect(markup).toContain("That is not a pass.");
  });

  test("shows the gate's declared scope and refuses to extend it", () => {
    const markup = render({ selectedId: "assign_us_puma_ladder.gate", mode: "cold" });
    expect(markup).toContain("Gate passed");
    expect(markup).toContain("geography_assignment_integrity");
    expect(markup).toContain("It says nothing about any");
  });

  test("offers one hop in each direction, by recorded dependency only", () => {
    const markup = render({ selectedId: "assemble_stacked_spine" });
    expect(markup).toContain("Built from");
    expect(markup).toContain("Used by");
    const unplaced = render({ selectedId: "assign_us_puma_ladder.boundary" });
    expect(unplaced).not.toContain("Built from");
    expect(unplaced).toContain("nothing in the saved run");
  });

  test("keeps the identifiers available without leading with them", () => {
    const markup = render({ selectedId: "assign_us_puma_ladder.lookup" });
    expect(markup).toContain("Identifiers and pins");
    expect(markup).toContain("<details");
    // The pinned crosswalk and ladder digests the receipt actually recorded.
    expect(markup).toContain("Source files pinned");
    expect(markup).toMatch(/c7cb040[a-f0-9]+/);
  });

  test("names the population frame per execution, not once", () => {
    const markup = render({ selectedId: "assemble_stacked_spine" });
    expect(markup).toContain("Frame key · cold");
    expect(markup).toContain("Frame key · replay");
  });
});

describe("the comparison", () => {
  test("separates one computation from two executions", () => {
    const markup = render();
    expect(markup).toContain("Same computation, two executions");
    expect(markup).toContain(PAYLOAD.comparison.content_key);
    for (const execution of PAYLOAD.executions)
      expect(markup).toContain(execution.manifest_sha256);
    expect(markup).toContain("Identical across both executions");
  });

  test("names where the executions actually differ", () => {
    expect(render()).toContain("Where the executions differ");
  });
});

describe("what the run is not connected to", () => {
  const markup = render();

  test("states each missing link instead of drawing it", () => {
    for (const label of [
      "Calibration diagnostic",
      "Target and measurement binding",
      "Chronicle published fact",
      "Semantic concept alignment",
      "Documentary citation",
      "Semantic alignment",
    ])
      expect(markup).toContain(label);
  });

  test("shows completed execution and release exclusion side by side", () => {
    expect(markup).toContain("completed execution");
    expect(markup).toContain("excluded from");
  });
});

describe("provenance stays with the run it describes", () => {
  test("the verification is available but folded away", () => {
    expect(render()).toContain("What was checked before any of this was drawn");
  });

  test("no implementation provenance leaks into the shared chrome", () => {
    const chrome = renderToStaticMarkup(
      <>
        <SiteHeader />
        <SiteFooter />
      </>,
    );
    for (const phrase of [
      PAYLOAD.binding.kernel_impl_hash,
      PAYLOAD.binding.candidate_manifest_sha256,
      PAYLOAD.comparison.content_key,
      "Required replay",
    ])
      expect(chrome).not.toContain(phrase);
  });

  test("no host, path or payload byte reaches the markup", () => {
    const markup = render({ selectedId: "assemble_stacked_spine" });
    for (const forbidden of ["MacBook", "/Users/", "_buildo-runtime", "peak_rss"])
      expect(markup).not.toContain(forbidden);
  });
});
