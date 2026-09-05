import { expect, test } from "bun:test";
import {
  distributionDefinition,
  percentPoints,
  percentShare,
  supportDefinition,
  validateDistributions,
  validateSupport,
} from "./aggregates";

const identity = {
  candidate_release_id: "test-only",
  population_sha256: "a".repeat(64),
  period: "2024",
};
const support = {
  ...identity,
  schema_version: "microcosm.population_support.v1" as const,
  entity: "household",
  weight_entity: "household",
  weight_basis: "calibrated",
  rows: [
    {
      geography: { level: "national", id: "US", label: "United States" },
      record_count: 3,
      positive_weight_count: 2,
      weight_sum: 4,
      effective_sample_size: 2,
      max_weight_share: 0.5,
    },
  ],
};
const distributions = {
  ...identity,
  schema_version: "microcosm.population_distributions.v1" as const,
  series: [
    {
      variable: "age",
      label: "Age",
      entity: "person",
      unit: "year",
      weight_basis: "calibrated",
      bin_definition_id: "age-v1",
      geography: { level: "national", id: "US", label: "United States" },
      bins: [
        { label: "Under 18", lower: 0, upper: 18, weight: 2, share: 0.2 },
        { label: "18+", lower: 18, upper: null, weight: 7, share: 0.7 },
      ],
      missing_weight: 1,
      total_weight: 10,
    },
  ],
};

test("valid aggregate contracts retain real supplied values", () => {
  expect(validateSupport(support)).toEqual(support);
  expect(validateDistributions(distributions)).toEqual(distributions);
});

test("invalid weight support is rejected before display", () => {
  for (const patch of [
    {
      record_count: 1_000_000,
      positive_weight_count: 1_000_000,
      weight_sum: 1_000_000,
      effective_sample_size: 1_000_000,
      max_weight_share: 0.0001,
    },
    { weight_sum: -1 },
    { effective_sample_size: 4 },
    { max_weight_share: 2 },
    { positive_weight_count: 4 },
    { record_count: 2.5 },
  ]) {
    expect(() =>
      validateSupport({ ...support, rows: [{ ...support.rows[0], ...patch }] }),
    ).toThrow();
  }
});

test("missing mass, overlapping bins and incorrect shares cannot masquerade as distributions", () => {
  expect(() =>
    validateDistributions({
      ...distributions,
      series: [{ ...distributions.series[0], total_weight: 11 }],
    }),
  ).toThrow();
  expect(() =>
    validateDistributions({
      ...distributions,
      series: [
        {
          ...distributions.series[0],
          bins: [
            { ...distributions.series[0].bins[0], share: 0.9 },
            distributions.series[0].bins[1],
          ],
        },
      ],
    }),
  ).toThrow();
  expect(() =>
    validateDistributions({
      ...distributions,
      series: [
        {
          ...distributions.series[0],
          bins: [
            distributions.series[0].bins[0],
            { ...distributions.series[0].bins[1], lower: 17 },
          ],
        },
      ],
    }),
  ).toThrow();
});

test("comparison requires common definitions, exact bounds and geography vintage", () => {
  const parsed = validateDistributions(distributions);
  const series = parsed.series[0];
  const key = distributionDefinition(series, parsed.period);
  expect(
    distributionDefinition({ ...series, unit: "month" }, parsed.period),
  ).not.toBe(key);
  expect(
    distributionDefinition(
      { ...series, geography: { ...series.geography, vintage: "119" } },
      parsed.period,
    ),
  ).not.toBe(key);
  expect(
    distributionDefinition(
      { ...series, bins: [{ ...series.bins[0], upper: 19 }, series.bins[1]] },
      parsed.period,
    ),
  ).not.toBe(key);
  expect(
    supportDefinition({ ...validateSupport(support), weight_basis: "design" }),
  ).not.toBe(supportDefinition(validateSupport(support)));
});

test("effective sample size and largest share must describe compatible weights", () => {
  for (const patch of [
    {
      record_count: 100,
      positive_weight_count: 100,
      weight_sum: 100,
      effective_sample_size: 100,
      max_weight_share: 1,
    },
    {
      record_count: 3,
      positive_weight_count: 3,
      weight_sum: 10,
      effective_sample_size: 1.25,
      max_weight_share: 0.8,
    },
  ])
    expect(() =>
      validateSupport({ ...support, rows: [{ ...support.rows[0], ...patch }] }),
    ).toThrow("inconsistent");
});

test("overflowing mass cannot pass distribution reconciliation", () => {
  expect(() =>
    validateDistributions({
      ...distributions,
      series: [
        {
          ...distributions.series[0],
          total_weight: 1e308,
          missing_weight: 0,
          bins: distributions.series[0].bins.map((bin) => ({
            ...bin,
            weight: 1e308,
            share: 1,
          })),
        },
      ],
    }),
  ).toThrow("account for total weight");
});

test("a chart tooltip reports a small positive share exactly as its label does", () => {
  // The chart plots percentage points; the labels beside it take fractions.
  // Both must resolve a positive 0.04% bin to the same visible share.
  for (const share of [0.0004, 0.000437, 0.038, 0.5]) {
    expect(percentPoints(share * 100)).toBe(percentShare(share));
    expect(percentPoints(share * 100)).not.toBe("0%");
  }
  expect(percentShare(0.000437)).toBe("0.0437%");
  expect(percentShare(null)).toBe("\u2014");
  expect(percentPoints(null)).toBe("\u2014");
});
