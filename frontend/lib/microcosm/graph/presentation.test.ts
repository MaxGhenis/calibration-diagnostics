import { describe, expect, test } from "bun:test";

import {
  NODE_HEIGHT,
  NODE_WIDTH,
  cacheReading,
  executionReading,
  formatMeasure,
  gateReading,
  gateRecorded,
  layoutReceiptGraph,
  neighbours,
  outputReading,
  releaseEligibilityReading,
  selectionNotice,
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
    for (const state of [
      "fail",
      "evidence_absent",
      "unreached",
      "not_applicable",
    ] as const)
      expect(gateReading(state).tone).not.toBe("success");
  });

  test("a gate that did not apply is not a gate that passed", () => {
    const reading = gateReading("not_applicable");
    expect(reading.label).not.toBe(gateReading("pass").label);
    expect(reading.label).not.toMatch(/passed/i);
    expect(reading.help).toMatch(/did not apply/i);
  });

  test("outputs carry the receipt's own reason in all three readings", () => {
    const usable = {
      outputs: "usable",
      outputs_usable: true,
      outputs_reason: "because the receipt says so",
    } as NodeExecutionState;
    expect(outputReading(usable).help).toBe("because the receipt says so");
    expect(outputReading(usable).tone).toBe("info");

    // A receipt that recorded no typed or opaque artifact is not a receipt
    // whose outputs were withheld. It gets its own neutral reading, so a step
    // that succeeded is never rendered in the warning tone.
    const none = {
      ...usable,
      outputs: "no_typed_artifact",
      outputs_usable: false,
    } as NodeExecutionState;
    expect(outputReading(none).tone).toBe("neutral");
    expect(outputReading(none).label).toMatch(/no typed artifact output/i);
    expect(outputReading(none).label).not.toMatch(/not usable|fail/i);

    const withheld = {
      ...usable,
      outputs: "not_usable",
      outputs_usable: false,
    } as NodeExecutionState;
    expect(outputReading(withheld).tone).toBe("warning");
    expect(outputReading(withheld).label).toMatch(/not usable/i);
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
    expect(empty.outputs).toBe("not_usable");
  });

  test("the fallback carries every field the contract promises", () => {
    // A partial fallback compiles only while the value it stands in for is
    // typed non-nullable. Anything reading `frame_key` off it would find
    // `undefined` where the payload promises a value or an explicit null.
    const empty = stateFor(node("a"), "cold");
    for (const field of [
      "mode",
      "execution",
      "cache",
      "gate",
      "gate_record",
      "outputs",
      "outputs_usable",
      "outputs_reason",
      "node_key",
      "output_keys",
      "frame_key",
      "weight_key",
      "wall_time_seconds",
    ] as (keyof NodeExecutionState)[])
      expect(Object.hasOwn(empty, field)).toBe(true);
    expect(empty.frame_key).toBeNull();
    expect(empty.weight_key).toBeNull();
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

describe("wording that has to survive a status this run does not use", () => {
  test("reads every declared eligibility status as a sentence", () => {
    // `EligibilityStatus` in the quality contract declares four. This evidence
    // carries only `excluded`; the other three are worded so that a candidate
    // published with one of them does not read as a fragment.
    expect(releaseEligibilityReading("excluded")).toBe("Excluded from release");
    expect(releaseEligibilityReading("eligible")).toBe("Eligible for release");
    expect(releaseEligibilityReading("ineligible")).toBe(
      "Not eligible for release",
    );
    expect(releaseEligibilityReading("not_evaluated")).toBe(
      "Release eligibility not evaluated",
    );
  });

  test("renders an unfamiliar status without inventing grammar around it", () => {
    expect(releaseEligibilityReading("pending_review")).toBe(
      "Release eligibility: pending review",
    );
    expect(releaseEligibilityReading("")).toBe("Release eligibility not stated");
  });
});

describe("what the reader is told before a request is even possible", () => {
  test("an incomplete selection is stated as incomplete, not as loading", () => {
    const notice = selectionNotice("incomplete_identity");
    expect(notice.title).toMatch(/incomplete/i);
    expect(notice.title).not.toMatch(/reading|loading|…/i);
    expect(notice.description).toMatch(/manifest digest/i);
  });

  test("no candidate is still its own message", () => {
    expect(selectionNotice("no_candidate").title).toMatch(/no candidate/i);
  });
});

describe("a gate that did not apply is still a gate on the canvas", () => {
  // The card shows a "· gate" marker so a reader can see at a glance which
  // receipts recorded one. It was decided from the gate reading's tone, and
  // giving `not_applicable` a neutral tone silently took the marker away: on
  // the canvas that receipt then looked exactly like one that recorded no gate
  // at all, which is the confusion this whole axis exists to prevent. The
  // marker is a question about the record, not about the tone.
  test("every state that is a gate record is marked as one", () => {
    for (const state of [
      "pass",
      "not_applicable",
      "fail",
      "evidence_absent",
      "unreached",
    ] as const)
      expect(`${state}: ${gateRecorded(state)}`).toBe(`${state}: true`);
  });

  test("the absence of a gate is the only state that is not", () => {
    expect(gateRecorded("no_gate_record")).toBe(false);
  });

  test("a neutral tone does not decide it", () => {
    expect(gateReading("not_applicable").tone).toBe("neutral");
    expect(gateReading("no_gate_record").tone).toBe("neutral");
    expect(gateRecorded("not_applicable")).not.toBe(
      gateRecorded("no_gate_record"),
    );
  });
});

describe("the producer's words for a gate that did not apply", () => {
  // `microcosm.graph.manifest._CERTIFYING_GATE_OUTCOMES` is
  // `{"pass", "not_applicable"}`: the producer counts a gate that did not apply
  // alongside a pass, and neither enters `known_failures`. Telling the reader
  // it "certified nothing" states the opposite of the producer's own grouping.
  test("does not claim the producer treats it as uncertifying", () => {
    const help = gateReading("not_applicable").help;
    expect(help).not.toMatch(/certified nothing/i);
    expect(help).toMatch(/certifying/i);
    expect(help).toMatch(/did not apply/i);
  });

  test("still keeps it out of the passing reading", () => {
    expect(gateReading("not_applicable").label).not.toMatch(/passed/i);
  });
});

describe("no state is read by a fallback that was written for another one", () => {
  // This is the shape of the mislabel the review found: `not_applicable` fell
  // through to the passing case and was reported as a pass. A `default:` branch
  // makes that silent for the next member added, so every declared member has
  // to earn a reading of its own.
  test("each gate state has a label no other gate state has", () => {
    const states = [
      "pass",
      "not_applicable",
      "fail",
      "no_gate_record",
      "evidence_absent",
      "unreached",
    ] as const;
    const labels = states.map((state) => gateReading(state).label);
    expect(new Set(labels).size).toBe(states.length);
  });

  test("each output state has a label no other output state has", () => {
    const labels = (["usable", "no_typed_artifact", "not_usable"] as const).map(
      (outputs) =>
        outputReading({
          outputs,
          outputs_usable: outputs === "usable",
          outputs_reason: "whatever the receipt said",
        } as NodeExecutionState).label,
    );
    expect(new Set(labels).size).toBe(3);
  });
});
