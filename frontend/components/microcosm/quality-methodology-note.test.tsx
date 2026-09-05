import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteHeader } from "../layout/site-header";
import { SiteFooter } from "../layout/site-footer";
import { QualityMethodologyNote } from "./quality-methodology-note";

test("candidate methodology belongs to results and stays out of shared chrome", () => {
  const chrome = renderToStaticMarkup(
    <>
      <SiteHeader />
      <SiteFooter />
    </>,
  );
  const results = renderToStaticMarkup(<QualityMethodologyNote />);
  for (const phrase of [
    "population-bound aggregate artifacts",
    "release eligibility",
    "Effective sample size",
  ]) {
    expect(chrome).not.toContain(phrase);
    expect(results).toContain(phrase);
  }
});
