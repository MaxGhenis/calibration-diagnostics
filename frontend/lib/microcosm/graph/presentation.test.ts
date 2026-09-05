import { describe, expect, test } from "bun:test";

import {
  NODE_HEIGHT,
  NODE_WIDTH,
  cacheReading,
  executionReading,
  formatMeasure,
  gateReading,
  layoutReceiptGraph,
  neighbours,
  outputReading,
  shortDigest,
  stateFor,
} from "./presentation";
import type {
  ExecutionEdge,
  NodeExecutionState,
  ReceiptGraphNode,
} from "./types";

const EDGES: ExecutionEdge[] = [
  {
    kind: "execution",
    basis: "typed_artifact",
    from: "assemble_stacked_spine.prepare",
    to: "assemble_stacked_spine",
    modes: ["cold", "replay"],
    artifacts: [],
  },
  {
    kind: "execution",
    basis: "typed_artifact",
    from: "assemble_stacked_spine",
    to: "assign_us_puma_ladder",
    modes: ["cold", "replay"],
    artifacts: [],
  },
  {
    kind: "execution",
    basis: "typed_artifact",
    from: "assign_us_puma_ladder.lookup",
    to: "assign_us_puma_ladder",
    modes: ["cold", "replay"],
    artifacts: [],
  },
];

function node(id: string, unconnected = false): ReceiptGraphNode {
  return {
    id,
    label: id,
    group: id,
    group_label: "Assembly",
    role: "compute",
    kernel_ref: null,
    kernel_impl_hash: null,
    determinism: null,
    numeric: null,
    tolerance: null,
    runtime_dependencies: [],
    seed: null,
    phase: null,
    typed_inputs: [],
    typed_outputs: [],
    opaque_artifact_keys: [],
    column_artifact_counts: [],
    column_artifact_total: 0,
    measures: [],
    source_pins: [],
    states: [],
    identity_differs: false,
    unconnected,
  };
}

describe("each axis is worded as its own reading", () => {
  test("a recorded execution is never reported as a verdict", () => {
    expect(executionReading("recorded").label).toBe("Receipt recorded");
    expect(executionReading("recorded").label).not.toMatch(/pass|success|complete/i);
    expect(executionReading("recorded").tone).not.toBe("success");
  });

  test("a cache hit is neutral, not a failure and not an achievement", () => {
    expect(cacheReading("hit").tone).toBe("neutral");
    expect(cacheReading("computed").tone).toBe("info");
    expect(cacheReading("unknown").label).toMatch(/unknown/);
  });

  test("no gate record is stated as not being a pass", () => {
    const reading = gateReading("no_gate_record");
    expect(reading.tone).toBe("neutral");
    expect(reading.help).toMatch(/not a pass/);
  });

  test("only a gate that passed reads as success", () => {
    expect(gateReading("pass").tone).toBe("success");
    expect(gateReading("pass").help).toMatch(/declared scope/);
    for (const state of ["fail", "evidence_absent", "unreached"] as const)
      expect(gateReading(state).tone).not.toBe("success");
  });

  test("outputs carry the receipt's own reason either way", () => {
    const usable = {
      outputs_usable: true,
      outputs_reason: "because the receipt says so",
    } as NodeExecutionState;
    expect(outputReading(usable).help).toBe("because the receipt says so");
    expect(outputReading({ ...usable, outputs_usable: false }).tone).toBe("warning");
  });
});

describe("reading one execution off a node", () => {
  const withStates: ReceiptGraphNode = {
    ...node("a"),
    states: [
      { mode: "cold", cache: "computed" } as NodeExecutionState,
      { mode: "replay", cache: "hit" } as NodeExecutionState,
    ],
  };

  test("finds the requested mode", () => {
    expect(stateFor(withStates, "replay").cache).toBe("hit");
  });

  test("falls back to something explicitly unevidenced, never to a pass", () => {
    const empty = stateFor(node("a"), "cold");
    expect(empty.execution).toBe("not_evidenced");
    expect(empty.gate).toBe("unreached");
    expect(empty.outputs_usable).toBe(false);
  });
});

describe("one hop of recorded dependency", () => {
  test("reads both directions off the declared edges only", () => {
    expect(neighbours(EDGES, "assign_us_puma_ladder")).toEqual({
      builtFrom: ["assemble_stacked_spine", "assign_us_puma_ladder.lookup"],
      usedBy: [],
    });
    expect(neighbours(EDGES, "assemble_stacked_spine")).toEqual({
      builtFrom: ["assemble_stacked_spine.prepare"],
      usedBy: ["assign_us_puma_ladder"],
    });
  });

  test("a receipt nothing connects to has no neighbours", () => {
    expect(neighbours(EDGES, "assign_us_puma_ladder.gate")).toEqual({
      builtFrom: [],
      usedBy: [],
    });
  });
});

describe("layout", () => {
  const nodes = [
    node("assemble_stacked_spine.prepare"),
    node("assemble_stacked_spine"),
    node("assign_us_puma_ladder"),
    node("assign_us_puma_ladder.lookup"),
    node("assign_us_puma_ladder.boundary", true),
    node("assign_us_puma_ladder.gate", true),
  ];

  test("places every receipt exactly once", () => {
    const placed = layoutReceiptGraph(nodes, EDGES);
    expect(placed.map((entry) => entry.id).sort()).toEqual(
      nodes.map((entry) => entry.id).sort(),
    );
  });

  test("runs the recorded dependencies left to right", () => {
    const placed = new Map(
      layoutReceiptGraph(nodes, EDGES).map((entry) => [entry.id, entry]),
    );
    for (const edge of EDGES)
      expect(placed.get(edge.from)!.x).toBeLessThan(placed.get(edge.to)!.x);
  });

  test("sets the receipts nothing connects to below the flow, not inside it", () => {
    const placed = new Map(
      layoutReceiptGraph(nodes, EDGES).map((entry) => [entry.id, entry]),
    );
    const flowBottom = Math.max(
      ...EDGES.flatMap((edge) => [placed.get(edge.from)!.y, placed.get(edge.to)!.y]),
    );
    for (const id of ["assign_us_puma_ladder.boundary", "assign_us_puma_ladder.gate"])
      expect(placed.get(id)!.y).toBeGreaterThan(flowBottom + NODE_HEIGHT - 1);
  });

  test("does not overlap the two unplaced receipts", () => {
    const placed = new Map(
      layoutReceiptGraph(nodes, EDGES).map((entry) => [entry.id, entry]),
    );
    const boundary = placed.get("assign_us_puma_ladder.boundary")!;
    const gate = placed.get("assign_us_puma_ladder.gate")!;
    expect(Math.abs(boundary.x - gate.x)).toBeGreaterThanOrEqual(NODE_WIDTH);
  });

  test("handles a run where nothing is connected at all", () => {
    const placed = layoutReceiptGraph([node("a", true), node("b", true)], []);
    expect(placed).toHaveLength(2);
    expect(placed.every((entry) => Number.isFinite(entry.x))).toBe(true);
  });
});

describe("formatting", () => {
  test("keeps counts readable and fractions honest", () => {
    expect(formatMeasure(38604)).toBe("38,604");
    expect(formatMeasure(true)).toBe("yes");
    expect(formatMeasure(false)).toBe("no");
    expect(formatMeasure(0.02769910116255789)).toBe("0.0276991");
    expect(formatMeasure("119th_congress")).toBe("119th_congress");
  });

  test("shortens a digest without pretending one is present", () => {
    expect(shortDigest("ff2f231bbe96267bbb230264cece5131")).toBe("ff2f231bbe96…");
    expect(shortDigest(null)).toBe("—");
  });
});
