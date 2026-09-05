import { expect, test } from "bun:test";
import { buildCalibration, classifyApiError } from "./latest-artifact";
import { createExplorerState, selectExplorerNode } from "./calibration-explorer";
import { buildCalibrationTree, type CalibrationTreeTarget } from "./calibration-tree";
import { AmbiguousGeographyError, geographyKey } from "./geography-identity";
import { calibrationTreeRequestState } from "./calibration-tree-request";
import { explorerBreadcrumbs } from "../../components/microcosm/calibration-explorer-view";

function twoRegions() {
  return buildCalibration({
    schema_version: 7,
    dimensions: {
      geography_region: {
        label: "Region", role: "geography", level: "region",
        values: { north: "Same label", south: "Same label" },
        order: ["south", "north"],
      },
    },
    targets: ["north", "south"].map((id) => ({
      name: `invented.population.${id}@2025`,
      source: { id: "invented", label: "Invented source" },
      variable: { id: "population", label: "Population", measure: "count" },
      dimensions: { geography_region: id },
      target: 100, initial_estimate: 90, final_estimate: 100,
    })),
  }, "invented-geography-collision", null, {}, {}, {}, "uk").rows;
}

test("different structured geography IDs with equal labels stay separate through drill-down", () => {
  const rows = twoRegions();
  const state = { ...createExplorerState(), breakdown: "geography" as const };
  const tree = buildCalibrationTree(rows, state);
  const nodes = tree.groups.flatMap((g) => g.nodes);
  expect(nodes).toHaveLength(2);
  expect(new Set(nodes.map((n) => n.id)).size).toBe(2);
  expect(nodes.map((n) => n.id)).toEqual([geographyKey(rows[1]), geographyKey(rows[0])]);
  expect(tree.filterOptions.geographies).toEqual(nodes.map((n) => n.id));
  for (const n of nodes) {
    expect(n.metrics.nTargets).toBe(1);
    const child = buildCalibrationTree(rows, selectExplorerNode(state, n.selection));
    expect(child.filteredMetrics.nTargets).toBe(1);
  }
});

test("same value ID in different dimensions never shares a navigation identity", () => {
  const rows = twoRegions().map((row, index) => ({
    ...row,
    geography_id: "same-value",
    geography_dimension_id: index ? "region_vintage_b" : "region_vintage_a",
  }));
  const tree = buildCalibrationTree(rows, { ...createExplorerState(), breakdown: "geography" });
  expect(tree.groups[0].nodes).toHaveLength(2);
  expect(new Set(tree.groups[0].nodes.map((n) => n.id)).size).toBe(2);
});

test("a label change preserves the key and exposes all same-surface label aliases", () => {
  const before = twoRegions()[0];
  const after = { ...before, name: "another-target", geography: "New label" };
  expect(geographyKey(before)).toBe(geographyKey(after));
  const tree = buildCalibrationTree([before, after], { ...createExplorerState(), breakdown: "geography" });
  expect(tree.groups[0].nodes).toHaveLength(1);
  for (const label of ["Same label", "New label"]) {
    const state = createExplorerState();
    state.breakdown = "geography";
    state.path.geography = label;
    const selected = buildCalibrationTree([before, after], state);
    expect(selected.path.geography).toBe(geographyKey(before));
    expect(selected.filteredMetrics.nTargets).toBe(2);
  }
});

test("ambiguous old label paths and filters fail before a program or level can hide the collision", () => {
  const rows = twoRegions().map((row, index) => ({ ...row, variable: index ? "second" : "first" }));
  for (const parameter of ["path_geography", "geography"]) {
    const params = new URLSearchParams({ source: "invented", program: "first", [parameter]: "Same label" });
    expect(() => buildCalibrationTree(rows, calibrationTreeRequestState(params))).toThrow(AmbiguousGeographyError);
  }
  expect(classifyApiError(new AmbiguousGeographyError())).toMatchObject({ status: 400 });
});

test("legacy ID and label identities stay distinct across levels and from declared dimensions", () => {
  const common = { geography: "Shared", geography_id: "same" };
  const rows = [
    { ...common, level: "state" },
    { ...common, level: "region" },
    { ...common, geography_dimension_id: "state", level: "state" },
  ];
  expect(new Set(rows.map(geographyKey)).size).toBe(3);
  const noIds = [{ geography: "Shared", level: "state" }, { geography: "Shared", level: "region" }];
  expect(new Set(noIds.map(geographyKey)).size).toBe(2);
});

test("existing unique US, CD and UK geography label URLs resolve without changing candidate identity", () => {
  for (const [country, id, label, level] of [
    ["us", "0100000US", "United States", "country"],
    ["us", "5001700US0101", "AL-01", "congressional_district"],
    ["uk", "K02000001", "United Kingdom", "country"],
  ] as const) {
    const cal = buildCalibration({ schema_version: 6, targets: [{
      name: "invented.population@2024",
      metadata: { ledger_geography_id: id, ledger_geography_name: label, ledger_geography_level: level },
      target: 100, initial_estimate: 90, final_estimate: 100,
    }] }, "invented", null, {}, {}, {}, country);
    const url = new URL("https://example.test/target-tree?country=" + country + "&release=candidate%3Afixture%3A" + "a".repeat(64));
    const identity = url.searchParams.get("release");
    url.searchParams.set("breakdown", "geography");
    url.searchParams.set("path_geography", label);
    const tree = buildCalibrationTree(cal.rows, calibrationTreeRequestState(url.searchParams));
    expect(tree.filteredMetrics.nTargets).toBe(1);
    expect(tree.path.geography).toBe(geographyKey(cal.rows[0]));
    expect(tree.pathLabels.geography).toBe(label);
    expect(url.searchParams.get("release")).toBe(identity);
    expect(url.searchParams.get("country")).toBe(country);
  }
});

test("structured UK labels resolve only when unique and explicit keys survive URL encoding", () => {
  const row = { ...twoRegions()[0], geography: "England", geography_id: 'E / % & " Ω', geography_dimension_id: 'country / "v1"' };
  for (const selection of ["England", geographyKey(row)]) {
    const params = new URLSearchParams({ breakdown: "geography", path_geography: selection });
    const parsed = new URLSearchParams(params.toString());
    const tree = buildCalibrationTree([row], calibrationTreeRequestState(parsed));
    expect(tree.filteredMetrics.nTargets).toBe(1);
    expect(tree.path.geography).toBe(geographyKey(row));
    expect(tree.pathLabels.geography).toBe("England");
  }
});

test("geography filters remain in force from overview through program and target selection", () => {
  const rows = twoRegions();
  let state = { ...createExplorerState(), breakdown: "geography" as const };
  const key = geographyKey(rows[0]);
  state.filters.geographies = [key];
  let tree = buildCalibrationTree(rows, state);
  expect(tree.filteredMetrics.nTargets).toBe(1);
  state = selectExplorerNode(state, tree.groups[0].nodes[0].selection) as typeof state;
  tree = buildCalibrationTree(rows, state);
  state = selectExplorerNode(state, tree.groups[0].nodes[0].selection) as typeof state;
  tree = buildCalibrationTree(rows, state);
  const target = tree.groups.flatMap((group) => group.nodes).find((node) => node.kind === "target")!;
  state = selectExplorerNode(state, target.selection) as typeof state;
  tree = buildCalibrationTree(rows, state);
  expect(state.filters.geographies).toEqual([key]);
  expect(tree.filteredMetrics.nTargets).toBe(1);
  expect(tree.groups.flatMap((group) => group.nodes).map((node) => node.id)).toEqual([rows[0].name as string]);
  const crumbs = explorerBreadcrumbs(state, tree.pathLabels);
  expect(crumbs.map((crumb) => crumb.label)).toContain("Invented source");
  expect(crumbs.map((crumb) => crumb.label)).toContain("Population");
  expect(crumbs.some((crumb) => crumb.label.includes("geo:v1:"))).toBe(false);
  expect(crumbs.find((crumb) => crumb.path.geography)?.path.geography).toBe(key);
});

test("unknown selections remain empty and an incomplete declared identity is rejected", () => {
  const state = createExplorerState();
  state.breakdown = "geography";
  state.path.geography = "Unknown geography";
  expect(buildCalibrationTree(twoRegions(), state).filteredMetrics.nTargets).toBe(0);
  expect(() => geographyKey({ geography_dimension_id: "region", geography: "No value ID" })).toThrow("requires a geography value ID");
});

test("partial ordering falls back deterministically without assigning ranks across dimensions", () => {
  const rows: CalibrationTreeTarget[] = twoRegions().map((row, index) => ({
    ...row, geography: index ? "A label" : "Z label", geography_rank: index ? null : 0,
  }));
  const state = { ...createExplorerState(), breakdown: "geography" as const };
  expect(buildCalibrationTree(rows, state).groups[0].nodes.map((node) => node.label)).toEqual(["A label", "Z label"]);
  const reversed = buildCalibrationTree([...rows].reverse(), state);
  expect(reversed.filterOptions.geographies).toEqual(buildCalibrationTree(rows, state).filterOptions.geographies);
});
