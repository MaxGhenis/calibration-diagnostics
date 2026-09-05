import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PageHeader } from "./page-header";

test("the sticky page header paints an opaque background over scrolling content", () => {
  const markup = renderToStaticMarkup(
    <PageHeader eyebrow="Microcosm · population quality" title="Quality evidence" />,
  );
  const sticky = /class="([^"]*\bsticky\b[^"]*)"/.exec(markup)?.[1] ?? "";
  expect(sticky).toContain("bg-background");
  // An alpha-modified background composites whatever scrolls underneath into
  // the bar, which put attachment table rows through the page title.
  expect(sticky).not.toMatch(/bg-[\w-]+\/\d/);
});
