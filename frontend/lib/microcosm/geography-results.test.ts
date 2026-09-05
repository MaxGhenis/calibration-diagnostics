import { expect, test } from "bun:test";
import {
  buildCalibration,
  classifyApiError,
  latestMicrocosmTargetDiagnosticsPage,
} from "./latest-artifact";
import { geographyKey, geographyOptions } from "./geography-identity";

function geographyResultsFixture(differentPrograms = false) {
  return {
    schema_version: 7,
    release_id: "fixture-only",
    dimensions: {
      region: {
        role: "geography",
        label: "Region",
        level: "region",
        values: { north: "Shared", south: "Shared" },
        order: ["south", "north"],
      },
    },
    targets: ["north", "south"].map((id, index) => ({
      name: `invented.${id}@2024`,
      source: { id: "invented" },
      variable: {
        id: differentPrograms && index ? "other_population" : "population",
        measure: "count",
      },
      dimensions: { region: id },
      target: 100,
      initial_estimate: 90,
      final_estimate: index ? 50 : 100,
    })),
  };
}

function page(
  cal: ReturnType<typeof buildCalibration>,
  params: Record<string, string | undefined> = {},
) {
  return latestMicrocosmTargetDiagnosticsPage(
    `http://example.test/api/microcosm/target-diagnostics?${new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined))}`,
    cal,
  );
}

test("diagnostics choices and facets retain equal-label identities and producer order", () => {
  const cal = buildCalibration(geographyResultsFixture(), "fixture-only");
  const options = geographyOptions(cal.rows);
  const result = page(cal, { variable: String(cal.rows[0].variable_key) });
  expect(result.geographies).toEqual(options.map((option) => option.key));
  expect(result.geography_labels).toEqual(
    Object.fromEntries(options.map((option) => [option.key, option.label])),
  );
  expect(result.dimensions[0]).toEqual({
    key: "geography",
    label: "Region",
    values: result.geographies,
    value_labels: result.geography_labels,
  });
  for (const row of cal.rows) {
    const key = geographyKey(row);
    for (const params of [{ geography: key }, { facet: `geography:${key}` }]) {
      const selected = page(cal, params);
      expect(selected.filtered_total).toBe(1);
      expect(selected.targets[0]).toMatchObject({
        name: row.name,
        geography_key: key,
        geography_id: row.geography_id,
        geography_dimension_id: "region",
        geography_rank: row.geography_rank,
      });
    }
  }
});

test("ambiguous old geography labels refuse before every diagnostics narrowing", () => {
  const cal = buildCalibration(geographyResultsFixture(true), "fixture-only");
  for (const selection of [
    { geography: "Shared" },
    { facet: "geography:Shared" },
  ]) {
    for (const narrowing of [
      {},
      { variable: String(cal.rows[0].variable_key) },
      { program: "invented / population" },
      { scope: "healthcare" },
      { source: "missing" },
      { level: "national" },
    ]) {
      try {
        page(cal, { ...selection, ...narrowing });
        throw new Error("ambiguous selection accepted");
      } catch (error) {
        expect(classifyApiError(error).status).toBe(400);
      }
    }
  }
});

test("unique old labels remain compatible and unknown selections remain empty", () => {
  const cal = buildCalibration(
    {
      schema_version: 6,
      targets: [
        {
          name: "census.population@2024",
          metadata: {
            ledger_geography_level: "state",
            ledger_geography_id: "0400000US06",
            ledger_geography_name: "CA",
          },
          target: 100,
          initial_estimate: 90,
          final_estimate: 100,
        },
      ],
    },
    "legacy-fixture",
  );
  for (const value of ["CA", geographyKey(cal.rows[0])]) {
    expect(page(cal, { geography: value }).filtered_total).toBe(1);
    expect(page(cal, { facet: `geography:${value}` }).filtered_total).toBe(1);
  }
  for (const value of [
    "Unknown",
    "geo:v1:%5B%22dimension%22%2C%22elsewhere%22%2C%22x%22%5D",
  ]) {
    expect(page(cal, { geography: value }).filtered_total).toBe(0);
    expect(page(cal, { facet: `geography:${value}` }).filtered_total).toBe(0);
  }
});

test("geography facet ordering cannot compare ranks from different dimensions", () => {
  const cal = buildCalibration(
    {
      schema_version: 7,
      dimensions: {
        geography_a: {
          label: "A system",
          role: "geography",
          values: { z: "Z region" },
          order: ["z"],
        },
        geography_b: {
          label: "B system",
          role: "geography",
          values: { unused: "Unused", a: "A region" },
          order: ["unused", "a"],
        },
      },
      targets: ["a", "b"].map((id) => ({
        name: `invented.rank.${id}@2024`,
        source: { id: "invented" },
        variable: { id: "population" },
        dimensions: id === "a" ? { geography_a: "z" } : { geography_b: "a" },
        target: 100,
        initial_estimate: 90,
        final_estimate: 100,
      })),
    },
    "rank-fixture",
  );
  const result = page(cal, { variable: String(cal.rows[0].variable_key) });
  expect(
    result.dimensions[0].values.map(
      (key) => result.dimensions[0].value_labels?.[key],
    ),
  ).toEqual(["A region", "Z region"]);
});

test("target diagnostics cannot join identical value IDs across declared dimensions", () => {
  const cal = buildCalibration(
    {
      schema_version: 7,
      dimensions: {
        region_old: {
          label: "Region",
          role: "geography",
          values: { north: "Shared" },
        },
        region_new: {
          label: "Region",
          role: "geography",
          values: { north: "Shared" },
        },
      },
      targets: ["region_old", "region_new"].map((dimension) => ({
        name: `invented.${dimension}@2024`,
        source: { id: "invented" },
        variable: { id: "population" },
        dimensions: { [dimension]: "north" },
        target: 100,
        initial_estimate: 90,
        final_estimate: 100,
      })),
    },
    "dimension-fixture",
  );
  const result = page(cal, { variable: String(cal.rows[0].variable_key) });
  expect(result.geographies).toHaveLength(2);
  expect(result.dimensions[0].values).toHaveLength(2);
  for (const row of cal.rows) {
    const selected = page(cal, { facet: `geography:${geographyKey(row)}` });
    expect(selected.filtered_total).toBe(1);
    expect(selected.targets[0].geography_dimension_id).toBe(
      row.geography_dimension_id,
    );
  }
  expect(() => page(cal, { geography: "Shared" })).toThrow(
    "more than one geographic identity",
  );
});
