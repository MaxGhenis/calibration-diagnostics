import { expect, test } from "bun:test";

import {
  candidateReleaseToken,
  qualityHref,
  selectionFromSearch,
  selectionUrl,
} from "./selection";

const sha = "a".repeat(64);
const selection = {
  country: "us" as const,
  candidate: "candidate-26",
  manifest_sha256: sha,
  release: "",
  incumbent: "build-p",
};

test("candidate and incumbent survive navigation without carrying page filters", () => {
  const href = qualityHref("/microcosm/datasets?view=facts", selection);
  const url = new URL(href, "https://example.test");
  expect(url.searchParams.get("candidate")).toBe("candidate-26");
  expect(url.searchParams.get("manifest_sha256")).toBe(sha);
  expect(url.searchParams.get("incumbent")).toBe("build-p");
  expect(url.searchParams.get("view")).toBe("facts");
  expect(selectionFromSearch(url.searchParams, "us")).toEqual(selection);
});

test("explicit published selection clears candidate identity and keeps incumbent", () => {
  const url = new URL(
    selectionUrl(
      "https://example.test/microcosm?candidate=candidate-26&manifest_sha256=" +
        sha +
        "&incumbent=build-p",
      "us",
      { release: "build-q" },
    ),
  );
  expect(url.searchParams.has("candidate")).toBe(false);
  expect(url.searchParams.has("manifest_sha256")).toBe(false);
  expect(url.searchParams.get("release")).toBe("build-q");
  expect(url.searchParams.get("incumbent")).toBe("build-p");
});

test("switching population clears a stale fact selection", () => {
  const url = new URL(
    selectionUrl(
      "https://example.test/microcosm/datasets?view=fact&fact_key=old&source=old&country=us",
      "us",
      selection,
    ),
  );
  expect(url.searchParams.has("fact_key")).toBe(false);
  expect(url.searchParams.has("source")).toBe(false);
  expect(url.searchParams.has("view")).toBe(false);
  expect(url.searchParams.get("candidate")).toBe("candidate-26");
});

test("country-specific selection never crosses repositories", () => {
  expect(
    selectionFromSearch(
      new URLSearchParams(
        "country=uk&candidate=uk-only&incumbent=uk-build&release=uk-release",
      ),
      "us",
    ),
  ).toEqual({
    country: "us",
    candidate: "",
    manifest_sha256: "",
    release: "",
    incumbent: "",
  });
});

test("external navigation does not export population selection", () => {
  expect(qualityHref("https://www.policyengine.org/scorecard", selection)).toBe(
    "https://www.policyengine.org/scorecard",
  );
});

test("candidate transport tokens retain the immutable digest", () => {
  expect(candidateReleaseToken(selection)).toBe(
    `candidate:candidate-26:${sha}`,
  );
  expect(candidateReleaseToken({ ...selection, candidate: "" })).toBe("");
});

test("a copied candidate release token selects the same global evidence context", () => {
  const params = new URLSearchParams({
    release: `candidate:candidate-26:${sha}`,
    incumbent: "build-p",
  });
  expect(selectionFromSearch(params, "us")).toEqual(selection);
  params.set("candidate", "explicit-other");
  params.set("manifest_sha256", "b".repeat(64));
  expect(selectionFromSearch(params, "us").manifest_sha256).toBe(
    "b".repeat(64),
  );
});
