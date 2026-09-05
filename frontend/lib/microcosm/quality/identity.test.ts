import { expect, test } from "bun:test";

import {
  SAME_POPULATION_REASON,
  UNVERIFIED_POPULATION_REASON,
  candidatePopulationIdentity,
  comparisonIdentity,
  populationIdentity,
  publishedPopulationIdentity,
  resolveComparison,
} from "./identity";

const POPULATION_A = "a".repeat(64);
const POPULATION_B = "b".repeat(64);
const population = (sha256: string, period = "2024", entity = "household") => ({
  population: { sha256, period, entity },
});

test("a candidate names its population by digest, not by the id it was built under", () => {
  // The same candidate id is reused across rebuilds, and an evidence update
  // changes the manifest digest without changing a single population byte.
  const first = candidatePopulationIdentity("us", population(POPULATION_A));
  const second = candidatePopulationIdentity("us", population(POPULATION_A));
  expect(first).toEqual(second);
  expect(comparisonIdentity(first, second)).toEqual({
    status: "same_population",
    reason: SAME_POPULATION_REASON,
  });
  // Different bytes are a real comparison however the ids were spelled.
  expect(
    comparisonIdentity(
      first,
      candidatePopulationIdentity("us", population(POPULATION_B)),
    ).status,
  ).toBe("distinct_population");
});

test("period, entity and country are bound into a population's identity", () => {
  const base = candidatePopulationIdentity("us", population(POPULATION_A));
  // One digest under two periods, entities or countries is a contradiction in
  // the evidence rather than a second population, so it neither resolves to one
  // population nor buys a comparison.
  for (const other of [
    candidatePopulationIdentity("us", population(POPULATION_A, "2023")),
    candidatePopulationIdentity(
      "us",
      population(POPULATION_A, "2024", "person"),
    ),
    candidatePopulationIdentity("be", population(POPULATION_A)),
  ]) {
    expect(other.key).not.toBe(base.key);
    expect(comparisonIdentity(base, other).status).toBe("unverified");
  }
});

test("country is bound into a published release's identity", () => {
  expect(
    comparisonIdentity(
      publishedPopulationIdentity("us", "build-a"),
      publishedPopulationIdentity("us", "build-a"),
    ).status,
  ).toBe("same_population");
  expect(
    comparisonIdentity(
      publishedPopulationIdentity("us", "build-a"),
      publishedPopulationIdentity("us", "build-b"),
    ).status,
  ).toBe("distinct_population");
});

test("the pointer is not a population until it has been resolved", () => {
  for (const unresolved of ["", "latest", `candidate:build-a:${POPULATION_A}`])
    expect(publishedPopulationIdentity("us", unresolved).basis).toBe(
      "unresolved",
    );
  expect(publishedPopulationIdentity("us", "build-a").basis).toBe(
    "published_release",
  );
});

test("an identity that cannot be established leaves the comparison standing", () => {
  const candidate = candidatePopulationIdentity("us", population(POPULATION_A));
  const published = publishedPopulationIdentity("us", "build-a");
  // A published release publishes no population digest to hold a candidate's
  // against, and a pre-population build has none to offer.
  for (const [left, right] of [
    [candidate, published],
    [published, candidate],
    [candidate, candidatePopulationIdentity("us", { population: null })],
    [candidate, candidatePopulationIdentity("us", undefined)],
  ])
    expect(comparisonIdentity(left, right)).toEqual({
      status: "unverified",
      reason: UNVERIFIED_POPULATION_REASON,
    });
});

test("a loaded calibration is identified by the channel it came from", () => {
  expect(
    populationIdentity({
      country: "us",
      source: "candidate_quality",
      release_id: "reused-id",
      quality_manifest: population(POPULATION_A),
    }),
  ).toEqual(candidatePopulationIdentity("us", population(POPULATION_A)));
  expect(
    populationIdentity({
      country: "us",
      source: "huggingface_live",
      release_id: "build-a",
    }),
  ).toEqual(publishedPopulationIdentity("us", "build-a"));
});

test("the client resolution empties the incumbent it refuses and says why", () => {
  const selected = candidatePopulationIdentity("us", population(POPULATION_A));
  const other = candidatePopulationIdentity("us", population(POPULATION_B));
  const resolve = (input: Partial<Parameters<typeof resolveComparison>[0]>) =>
    resolveComparison({
      requested: "incumbent-token",
      incumbent: "incumbent-token",
      selected,
      against: other,
      resolving: false,
      ...input,
    });

  expect(resolve({})).toEqual({
    incumbent: "incumbent-token",
    status: "distinct_population",
    reason: "",
    resolving: false,
  });
  // Equal as written: already dropped when the URL was parsed, and still owed
  // an explanation, because the control otherwise looks as though it lost the
  // selection.
  expect(resolve({ incumbent: "" })).toEqual({
    incumbent: "",
    status: "same_population",
    reason: SAME_POPULATION_REASON,
    resolving: false,
  });
  expect(resolve({ against: selected })).toEqual({
    incumbent: "",
    status: "same_population",
    reason: SAME_POPULATION_REASON,
    resolving: false,
  });
  // Nothing was requested, so there is nothing to explain.
  expect(resolve({ requested: "", incumbent: "" }).reason).toBe("");
  // Until identity resolves, no surface gets an incumbent to overlay and none
  // is told a comparison was refused.
  expect(resolve({ resolving: true })).toEqual({
    incumbent: "",
    status: "distinct_population",
    reason: "",
    resolving: true,
  });
  expect(resolve({ against: selected, resolving: true }).reason).toBe("");
});
