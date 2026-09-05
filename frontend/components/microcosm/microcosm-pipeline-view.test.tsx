// The July 2026 overview is kept, not deleted, and has to read as history
// rather than as a description of whichever candidate is selected.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PIPELINE_SOURCE } from "@/lib/microcosm/pipeline";
import { HistoricalOverview } from "./microcosm-pipeline-view";

const markup = renderToStaticMarkup(<HistoricalOverview />);

describe("the historical pipeline overview", () => {
  test("is still there, with every stage it always had", () => {
    for (const stage of ["acs_rent", "source_stages.json"])
      expect(markup).toContain(stage);
    expect(markup).toContain("Inputs external validation found missing");
  });

  test("is folded away rather than opening on top of the selected run", () => {
    expect(markup).toStartWith("<details");
    expect(markup).not.toContain("<details open");
  });

  test("is dated, and named as hand-written from a commit", () => {
    expect(markup).toContain("July 2026");
    expect(markup).toContain("1 July 2026");
    expect(markup).toContain(PIPELINE_SOURCE.commit);
    expect(markup).toContain("written by hand");
  });

  test("says it is not the selected run and reads no receipt", () => {
    expect(markup).toContain("Read this as history, not as the selected run.");
    expect(markup).toContain("No receipt was read to draw it");
    expect(markup).toContain("no step here is bound to any");
  });

  test("marks the ACS rent mapping as superseded and unresolved", () => {
    expect(markup).toContain("pre_subsidy_rent");
    expect(markup).toContain("under active scientific revision");
    expect(markup).toContain(
      "must not be relabelled as an observed pre-subsidy charge",
    );
    expect(markup).toContain("superseded and unresolved");
    // and again on the row itself, where the claim is actually made
    expect(markup).toContain(
      "Under revision: reported contract rent is not observed",
    );
  });

  test("claims nothing about the selected candidate's receipts", () => {
    for (const phrase of [
      "Receipt recorded",
      "Cold run",
      "Required replay",
      "content key",
    ])
      expect(markup).not.toContain(phrase);
  });
});
