// These tests run against the actual six-receipt projection this dashboard
// ships and the actual publisher bytes it has to agree with. Nothing here
// invents a production execution: the cold and replay runs are the two the
// producer recorded for one uncalibrated development assembly, and the
// adversarial cases are edits to those real inputs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import type { CandidateQualityManifest } from "../quality/types";
import {
  PAIR_SEPARATOR,
  ReceiptGraphUnavailableError,
  buildReceiptGraph,
  cacheState,
  executionState,
  gateState,
  outputAvailability,
  outputFirstOrder,
  pinDifferences,
  verifyProjectionBinding,
  type ProjectionNode,
  type ReceiptProjection,
} from "./adapter";
import projectionJson from "./receipts/us-graph-f001-geography-20260905-v1.json";

const FIXTURES = fileURLToPath(new URL("./fixtures/us-graph-launch-quality/", import.meta.url));
const CANDIDATE_MANIFEST_SHA =
  "ff2f231bbe96267bbb230264cece5131314edab449d9cdd03b85aa452535b885";
const BUILD_EVIDENCE_SHA =
  "1d3b94d8720b07cb1be22fe65efd88eba31787742c090b411d28938e40abbf6b";

function readFixture(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${FIXTURES}${relative}`, "utf8"));
}

const RAW_MANIFEST = readFixture(`manifests/${CANDIDATE_MANIFEST_SHA}.json`);
const RAW_EVIDENCE = readFixture(`artifacts/${BUILD_EVIDENCE_SHA}.json`);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function projection(): ReceiptProjection {
  return clone(projectionJson as unknown as ReceiptProjection);
}

/** The manifest exactly as the verified reader hands it over. */
function manifest(): CandidateQualityManifest {
  return clone(RAW_MANIFEST) as unknown as CandidateQualityManifest;
}

function evidence(): Record<string, unknown> {
  return clone(RAW_EVIDENCE);
}

function verify(
  mutate: (input: {
    projection: ReceiptProjection;
    manifest: CandidateQualityManifest;
    evidence: Record<string, unknown>;
  }) => string | void = () => undefined,
) {
  const input = {
    projection: projection(),
    manifest: manifest(),
    evidence: evidence(),
  };
  const requested = mutate(input) ?? CANDIDATE_MANIFEST_SHA;
  return verifyProjectionBinding(
    input.projection,
    input.manifest,
    requested,
    input.evidence,
  );
}

function graph() {
  const built = {
    projection: projection(),
    manifest: manifest(),
    evidence: evidence(),
  };
  const checks = verifyProjectionBinding(
    built.projection,
    built.manifest,
    CANDIDATE_MANIFEST_SHA,
    built.evidence,
  );
  return buildReceiptGraph(built.projection, built.manifest, checks);
}

/* ------------------------------------------------------------- evidence */

describe("the evidence the projection is built from", () => {
  test("is the six receipts of one candidate, recorded twice", () => {
    const source = projection();
    expect(source.candidate_release_id).toBe("us-graph-f001-geography-20260905-v1");
    expect(source.candidate_manifest_sha256).toBe(CANDIDATE_MANIFEST_SHA);
    expect(source.build_evidence_sha256).toBe(BUILD_EVIDENCE_SHA);
    expect(source.is_publisher_attachment).toBe(false);
    // The display mode is `replay`; `resume` is the publisher's own key for
    // the same execution, and the binding has to line the two up.
    expect(source.executions.map((execution) => execution.mode)).toEqual([
      "cold",
      "replay",
    ]);
    expect(source.executions.map((execution) => execution.evidence_key)).toEqual([
      "cold",
      "resume",
    ]);
    for (const execution of source.executions)
      expect(execution.nodes).toHaveLength(6);
  });

  test("records four computed and two cache hits cold, and six hits on replay", () => {
    const [cold, replay] = projection().executions;
    expect(cold.nodes.filter((node) => node.cache === "computed")).toHaveLength(4);
    expect(cold.nodes.filter((node) => node.cache === "hit")).toHaveLength(2);
    expect(replay.nodes.filter((node) => node.cache === "hit")).toHaveLength(6);
    expect(cold.kernel_calls).toBe(4);
    expect(replay.kernel_calls).toBe(0);
  });

  test("distinguishes the two executions by manifest bytes, not by content key", () => {
    const [cold, replay] = projection().executions;
    expect(cold.content_key).toBe(replay.content_key);
    expect(cold.manifest_sha256).not.toBe(replay.manifest_sha256);
    expect(cold.manifest_sha256).toBe(
      "3467a00d64cd786f4351f298fe6d41ef2d144fc6f3cd41a1e30e824df2330070",
    );
    expect(replay.manifest_sha256).toBe(
      "20c963e2cb6989ad1df396a03f8494fb566a47e3a6d8055fe20d85035b91161b",
    );
  });
});

/* -------------------------------------------------------------- binding */

describe("binding the projection to the selected candidate", () => {
  test("holds against the real manifest and the real build evidence", () => {
    const checks = verify();
    expect(checks.map((check) => check.label)).toEqual([
      "Candidate manifest",
      "Build evidence",
      "Population",
      "Implementation",
      "Cold run receipts",
      "Required replay receipts",
    ]);
  });

  const refusals: [string, Parameters<typeof verify>[0], RegExp][] = [
    [
      "a projection for another candidate",
      ({ projection }) => {
        projection.candidate_release_id = "us-graph-f001-assembly-20260905-v1";
      },
      /different candidate/,
    ],
    [
      "a projection for another country",
      ({ projection }) => {
        projection.country = "uk";
      },
      /different country/,
    ],
    [
      "a manifest digest the request did not ask for",
      () => `${"0".repeat(63)}1`,
      /candidate manifest digest does not match/i,
    ],
    [
      "a population the candidate does not publish",
      ({ projection }) => {
        projection.population_sha256 = "b".repeat(64);
      },
      /population digest does not match/i,
    ],
    [
      "an implementation the candidate does not publish",
      ({ projection }) => {
        projection.kernel_impl_hash = "c".repeat(64);
      },
      /implementation hash does not match/i,
    ],
    [
      "a receipt from another implementation",
      ({ projection }) => {
        projection.executions[0].nodes[0].kernel_impl_hash = "d".repeat(64);
      },
      /produced by an implementation the candidate does not publish/,
    ],
    [
      "build evidence bytes other than the attached ones",
      ({ projection }) => {
        projection.build_evidence_sha256 = "e".repeat(64);
      },
      /build evidence digest does not match/i,
    ],
    [
      "a build-evidence attachment that is not run-scoped",
      ({ manifest }) => {
        manifest.attachments.build_manifest.scope = "population";
      },
      /not run-scoped/,
    ],
    [
      "a candidate that publishes no build evidence at all",
      ({ manifest }) => {
        manifest.attachments.build_manifest = {
          status: "missing",
          reason: "No build manifest was published for this candidate.",
        };
      },
      /No build manifest was published/,
    ],
    [
      "build evidence naming another candidate",
      ({ evidence }) => {
        evidence.candidate_release_id = "us-graph-f001-assembly-20260905-v1";
      },
      /names a different candidate/,
    ],
    [
      "build evidence naming another run",
      ({ evidence }) => {
        evidence.run_id = "some-other-run";
      },
      /names a different build run/,
    ],
    [
      "a content key the publisher did not record for that mode",
      ({ evidence }) => {
        (evidence.checks as Record<string, Record<string, unknown>>).cold.manifest_sha256 =
          "f".repeat(64);
      },
      /computation content key does not match/i,
    ],
    [
      "a kernel-call count the receipts contradict",
      ({ evidence }) => {
        (evidence.checks as Record<string, Record<string, unknown>>).cold.kernel_calls = 6;
      },
      /reports 6 kernel calls for the cold execution, but 4 receipts record a computation/,
    ],
    [
      "a source digest the receipt and the publisher disagree about",
      ({ projection }) => {
        const node = projection.executions[0].nodes.find(
          (entry) => entry.source_pins.length,
        )!;
        node.source_pins[0].sha256 = "a".repeat(64);
      },
      /differs from the one the candidate published/,
    ],
    [
      "a gate outcome the publisher did not record",
      ({ projection }) => {
        const node = projection.executions[0].nodes.find((entry) => entry.gate)!;
        node.gate!.outcome = "fail";
      },
      /gate outcome differs from the one the candidate published/,
    ],
    [
      "a gate scope the publisher did not record",
      ({ projection }) => {
        const node = projection.executions[0].nodes.find((entry) => entry.gate)!;
        node.gate!.scope = "something_else";
      },
      /gate scope differs from the one the candidate published/,
    ],
    [
      "a projection claiming to be a publisher attachment",
      ({ projection }) => {
        projection.is_publisher_attachment = true;
      },
      /claims to be a publisher attachment/,
    ],
    [
      "a projection written to an unsupported schema",
      ({ projection }) => {
        projection.schema_version = "microcosm.dashboard.receipt_projection.v99";
      },
      /unsupported schema/,
    ],
    [
      "a mode the publisher recorded no execution for",
      ({ evidence }) => {
        delete (evidence.checks as Record<string, unknown>).resume;
      },
      /records no resume execution/,
    ],
  ];

  for (const [name, mutate, message] of refusals)
    test(`refuses ${name}`, () => {
      expect(() => verify(mutate)).toThrow(ReceiptGraphUnavailableError);
      expect(() => verify(mutate)).toThrow(message);
    });

  test("a refusal names the disagreement rather than the file it read", () => {
    try {
      verify(({ projection }) => {
        projection.population_sha256 = "b".repeat(64);
      });
      throw new Error("expected a refusal");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("/");
      expect(message).not.toContain("fixtures");
    }
  });
});

/* ---------------------------------------------------------------- edges */

describe("recorded dependencies", () => {
  test("draws exactly the three the receipts declare, in both executions", () => {
    const payload = graph();
    expect(
      payload.edges
        .map((edge) => `${edge.from} -> ${edge.to}`)
        .sort(),
    ).toEqual([
      "assemble_stacked_spine -> assign_us_puma_ladder",
      "assemble_stacked_spine.prepare -> assemble_stacked_spine",
      "assign_us_puma_ladder.lookup -> assign_us_puma_ladder",
    ]);
    for (const edge of payload.edges) {
      expect(edge.kind).toBe("execution");
      expect(edge.basis).toBe("typed_artifact");
      expect(edge.modes.sort()).toEqual(["cold", "replay"]);
    }
    expect(
      payload.edges.find(
        (edge) => edge.from === "assemble_stacked_spine.prepare",
      )!.artifacts.map((artifact) => artifact.name).sort(),
    ).toEqual(["frame_context", "preparation"]);
  });

  test("says the graph is partial and which receipts it cannot place", () => {
    const payload = graph();
    expect(payload.coverage.complete).toBe(false);
    expect(payload.coverage.basis).toBe("run_manifest_typed_artifacts");
    expect(payload.coverage.recorded_edges).toBe(3);
    expect(payload.coverage.connected_nodes).toBe(4);
    expect(payload.coverage.unconnected_nodes).toBe(2);
    expect(
      payload.nodes.filter((node) => node.unconnected).map((node) => node.id).sort(),
    ).toEqual(["assign_us_puma_ladder.boundary", "assign_us_puma_ladder.gate"]);
  });

  test("drops an input whose named producer has no receipt, and says so", () => {
    const source = projection();
    for (const execution of source.executions)
      execution.nodes.find((node) => node.id === "assemble_stacked_spine")!
        .typed_inputs[0].producer = "a_step_that_never_ran";
    const payload = buildReceiptGraph(
      source,
      manifest(),
      verify(),
    );
    expect(payload.edges).toHaveLength(3);
    expect(
      payload.edges.find(
        (edge) =>
          edge.from === "assemble_stacked_spine.prepare" &&
          edge.to === "assemble_stacked_spine",
      )!.artifacts.map((artifact) => artifact.name),
    ).toEqual(["preparation"]);
    expect(payload.limits.join(" ")).toContain(
      "names producer a_step_that_never_ran, which has no receipt",
    );
  });

  test("drops an input whose producer key does not match that producer's receipt", () => {
    const source = projection();
    for (const execution of source.executions)
      for (const input of execution.nodes.find(
        (node) => node.id === "assign_us_puma_ladder",
      )!.typed_inputs)
        input.producer_key = "9".repeat(64);
    const payload = buildReceiptGraph(source, manifest(), verify());
    expect(payload.edges.map((edge) => `${edge.from} -> ${edge.to}`)).toEqual([
      "assemble_stacked_spine.prepare -> assemble_stacked_spine",
    ]);
    expect(payload.limits.join(" ")).toContain(
      "recorded a different key for producer",
    );
  });

  test("keeps documentary citation and semantic alignment out of the graph", () => {
    const payload = graph();
    expect(payload.edge_families.map((family) => family.kind).sort()).toEqual([
      "provenance",
      "semantic_alignment",
    ]);
    for (const family of payload.edge_families) {
      expect(family.edges).toHaveLength(0);
      expect(family.state).toBe("unresolved");
      expect(family.reason).toMatch(/no|none/i);
    }
  });
});

describe("output-first ordering", () => {
  test("puts what nothing consumes first, then what it was built from", () => {
    const payload = graph();
    const ids = payload.nodes.map((node) => node.id);
    expect(ids[0]).toBe("assign_us_puma_ladder");
    expect(ids.indexOf("assemble_stacked_spine")).toBeLessThan(
      ids.indexOf("assemble_stacked_spine.prepare"),
    );
    expect(ids.slice(-2).sort()).toEqual([
      "assign_us_puma_ladder.boundary",
      "assign_us_puma_ladder.gate",
    ]);
  });

  test("is stable and total even when nothing is connected", () => {
    expect(outputFirstOrder(["b", "a", "c"], [])).toEqual(["a", "b", "c"]);
  });

  test("does not loop on a cycle", () => {
    const cyclic = [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ] as Parameters<typeof outputFirstOrder>[1];
    expect(outputFirstOrder(["a", "b"], cyclic).sort()).toEqual(["a", "b"]);
  });
});

/* ------------------------------------------------------------ precedence */

describe("execution, cache and gate are read separately", () => {
  const base: ProjectionNode = {
    ...(projection().executions[0].nodes[0] as ProjectionNode),
  };

  test("a failure outranks a recorded output", () => {
    const node = { ...base, failed: true };
    expect(executionState(node)).toBe("failed");
    expect(node.typed_outputs.length).toBeGreaterThan(0);
    expect(outputAvailability(node).usable).toBe(false);
    expect(outputAvailability(node).reason).toMatch(/recorded failures/);
  });

  test("a gate exception is a failure, not a missing gate", () => {
    const node = { ...base, gate_exception: true };
    expect(executionState(node)).toBe("failed");
    expect(outputAvailability(node).reason).toMatch(
      /gate raised, so the executor recorded its declared outputs as unavailable/,
    );
  });

  test("a blocked step is never reached, and names what blocked it", () => {
    const node: ProjectionNode = {
      ...base,
      blocked: true,
      execution_record: {
        state: "blocked",
        blocked_by: [{ node: "assemble_stacked_spine", key: "a".repeat(64) }],
        unavailable_artifacts: ["frame_context"],
      },
    };
    expect(executionState(node)).toBe("blocked");
    expect(outputAvailability(node).usable).toBe(false);
    expect(outputAvailability(node).reason).toContain("assemble_stacked_spine");
  });

  test("no receipt is not evidenced, and not a pass", () => {
    expect(executionState(undefined)).toBe("not_evidenced");
    expect(cacheState(undefined)).toBe("unknown");
    expect(gateState(undefined)).toBe("unreached");
    expect(outputAvailability(undefined).usable).toBe(false);
  });

  test("a cache hit is still a recorded execution", () => {
    const node = { ...base, cache: "hit" as const };
    expect(cacheState(node)).toBe("hit");
    expect(executionState(node)).toBe("recorded");
  });

  test("a receipt with no gate has no gate result", () => {
    const node = { ...base, gate: null };
    expect(gateState(node)).toBe("no_gate_record");
    expect(outputAvailability(node).usable).toBe(true);
  });

  test("a failed gate withholds that step's own outputs", () => {
    const node: ProjectionNode = {
      ...base,
      gate: { outcome: "fail", scope: "geography_assignment_integrity", passed: false, checks: [] },
    };
    expect(gateState(node)).toBe("fail");
    expect(outputAvailability(node).usable).toBe(false);
  });

  test("an unrecognised gate outcome is absent evidence, not a pass", () => {
    const node: ProjectionNode = {
      ...base,
      gate: { outcome: "skipped", scope: null, passed: null, checks: [] },
    };
    expect(gateState(node)).toBe("evidence_absent");
    expect(outputAvailability(node).usable).toBe(false);
  });

  test("the run's one passing gate does not make every step complete", () => {
    const payload = graph();
    const gated = payload.nodes.find(
      (node) => node.id === "assign_us_puma_ladder.gate",
    )!;
    const cold = gated.states.find((state) => state.mode === "cold")!;
    expect(cold.gate).toBe("pass");
    expect(payload.gates.records).toBe(1);
    expect(payload.gates.note).toContain("geography_assignment_integrity");
    expect(payload.gates.note).toMatch(/nothing else/);
    for (const node of payload.nodes)
      if (node.id !== "assign_us_puma_ladder.gate")
        for (const state of node.states) expect(state.gate).toBe("no_gate_record");
  });
});

/* ------------------------------------------------------------ comparison */

describe("same computation, two executions", () => {
  test("shares one content key while the manifests differ", () => {
    const payload = graph();
    expect(payload.comparison.same_computation_content_key).toBe(true);
    expect(payload.comparison.distinct_executions).toBe(true);
    expect(payload.comparison.content_key_note).toMatch(/not a run-instance|run-level/i);
  });

  test("finds identical outputs and a cache difference on four receipts", () => {
    const payload = graph();
    expect(payload.comparison.output_identity.identical).toBe(true);
    expect(payload.comparison.output_identity.differences).toHaveLength(0);
    expect(payload.comparison.output_identity.compared_nodes).toBe(6);
    expect(
      payload.comparison.cache_differences.map((entry) => entry.id).sort(),
    ).toEqual([
      "assign_us_puma_ladder",
      "assign_us_puma_ladder.boundary",
      "assign_us_puma_ladder.gate",
      "assign_us_puma_ladder.lookup",
    ]);
    for (const difference of payload.comparison.cache_differences)
      expect(difference.states.map((state) => `${state.mode}:${state.cache}`)).toEqual([
        "cold:computed",
        "replay:hit",
      ]);
    expect(payload.nodes.every((node) => !node.identity_differs)).toBe(true);
  });

  test("reports a diverging output key rather than showing the first one", () => {
    const source = projection();
    source.executions[1].nodes.find(
      (node) => node.id === "assemble_stacked_spine",
    )!.typed_outputs[0].artifact_key = "7".repeat(64);
    const payload = buildReceiptGraph(source, manifest(), verify());
    expect(payload.comparison.output_identity.identical).toBe(false);
    const difference = payload.comparison.output_identity.differences[0];
    expect(difference.id).toBe("assemble_stacked_spine");
    expect(difference.field).toBe("typed outputs");
    expect(difference.values.map((value) => value.mode)).toEqual(["cold", "replay"]);
    expect(
      payload.nodes.find((node) => node.id === "assemble_stacked_spine")!
        .identity_differs,
    ).toBe(true);
  });

  test("reports a diverging frame key, which is input identity, outside the output comparison", () => {
    const source = projection();
    source.executions[1].nodes.find(
      (node) => node.id === "assemble_stacked_spine",
    )!.frame_key = "8".repeat(64);
    expect(
      pinDifferences(source, ["assemble_stacked_spine", "assign_us_puma_ladder"]),
    ).toEqual(["assemble_stacked_spine"]);
    const payload = buildReceiptGraph(source, manifest(), verify());
    expect(payload.comparison.output_identity.identical).toBe(true);
    expect(
      payload.nodes.find((node) => node.id === "assemble_stacked_spine")!
        .identity_differs,
    ).toBe(true);
    expect(payload.limits.join(" ")).toContain(
      "disagree about the frame or weight key on assemble_stacked_spine",
    );
    const states = payload.nodes.find(
      (node) => node.id === "assemble_stacked_spine",
    )!.states;
    expect(new Set(states.map((state) => state.frame_key)).size).toBe(2);
  });
});

/* --------------------------------------------------------- what is absent */

describe("what this run is not connected to", () => {
  test("keeps calibration, targets, facts and alignment unavailable with the producer's reason", () => {
    const payload = graph();
    const byKey = Object.fromEntries(
      payload.mappings.map((mapping) => [mapping.key, mapping]),
    );
    expect(Object.keys(byKey).sort()).toEqual([
      "calibration",
      "chronicle_fact",
      "concept_alignment",
      "cross_dataset",
      "target_binding",
    ]);
    for (const mapping of payload.mappings) {
      expect(["missing", "unresolved"]).toContain(mapping.state);
      expect(mapping.reason.length).toBeGreaterThan(20);
    }
    expect(byKey.calibration.reason).toContain("uncalibrated intermediate population");
  });

  test("keeps completed execution and release exclusion as separate readings", () => {
    const payload = graph();
    expect(payload.candidate.execution_status).toBe("completed");
    expect(payload.candidate.release_eligibility.status).toBe("excluded");
    expect(payload.candidate.release_eligibility.reason).toContain(
      "excluded from release",
    );
  });
});

/* ------------------------------------------------------- non-public fields */

describe("nothing that must not reach a browser reaches it", () => {
  const serialised = JSON.stringify(graph());

  test("carries no host, path, payload byte or person record", () => {
    for (const forbidden of [
      "MacBook",
      ".local",
      "/Users/",
      "_buildo-runtime",
      "graph-manifest.json",
      "peak_rss",
      "hostname",
      "person_id",
      "household_id",
    ])
      expect(serialised).not.toContain(forbidden);
  });

  test("counts the per-column artifacts instead of listing their keys", () => {
    const payload = graph();
    const spine = payload.nodes.find(
      (node) => node.id === "assemble_stacked_spine",
    )!;
    expect(spine.column_artifact_total).toBeGreaterThan(200);
    expect(spine.column_artifact_counts.every((entry) => entry.count > 0)).toBe(true);
    expect(
      spine.column_artifact_counts.map((entry) => entry.entity).sort(),
    ).toEqual([
      "family",
      "household",
      "marital_unit",
      "person",
      "spm_unit",
      "tax_unit",
    ]);
    // A count, never the keys behind it.
    expect(JSON.stringify(spine.column_artifact_counts)).not.toMatch(
      /[a-f0-9]{64}/,
    );
  });

  test("says out loud that the projection is not a publisher attachment", () => {
    const payload = graph();
    expect(payload.projection.is_publisher_attachment).toBe(false);
    expect(payload.projection.note).toMatch(/not a publisher attachment/i);
    expect(payload.projection.label_basis).toMatch(/native node ids/i);
  });
});

/* --------------------------------- the executor's record beats the umbrella */

describe("what the executor recorded outranks what the manifest collected", () => {
  const base: ProjectionNode = {
    ...(projection().executions[0].nodes[0] as ProjectionNode),
  };

  test("a gate the run never reached reads as never reached, not as failed", () => {
    // Two independent sources can name the same node: the run-level
    // `known_failures` list, whose derivation belongs to the producer, and the
    // executor's own per-node `receipt.execution.state`. Where they disagree,
    // the direct per-node record is what the reader is shown. Neither shipped
    // manifest exercises this, so the case is built here rather than taken from
    // one of them.
    const node: ProjectionNode = {
      ...base,
      failed: true,
      blocked: true,
      gate: {
        outcome: "unreached",
        scope: "geography_assignment_integrity",
        passed: null,
        checks: [],
      },
      execution_record: {
        state: "unreached",
        blocked_by: [
          { node: "assign_us_puma_ladder.boundary", key: "a".repeat(64) },
        ],
        unavailable_artifacts: [],
      },
    };
    expect(executionState(node)).toBe("blocked");
    expect(gateState(node)).toBe("unreached");
    expect(outputAvailability(node).state).toBe("not_usable");
    expect(outputAvailability(node).reason).toContain(
      "assign_us_puma_ladder.boundary",
    );
  });

  test("a gate exception is still a failure, because that is what the executor recorded", () => {
    expect(executionState({ ...base, failed: true, gate_exception: true })).toBe(
      "failed",
    );
    expect(executionState({ ...base, gate_exception: true })).toBe("failed");
  });

  test("a rejection with no executor state of its own is still a failure", () => {
    expect(executionState({ ...base, failed: true })).toBe("failed");
  });
});

describe("a gate that did not apply is not a gate that passed", () => {
  const base: ProjectionNode = {
    ...(projection().executions[0].nodes[0] as ProjectionNode),
  };
  const notApplicable: ProjectionNode = {
    ...base,
    gate: {
      outcome: "not_applicable",
      scope: "geography_assignment_integrity",
      passed: null,
      checks: [],
    },
  };

  test("keeps its own state rather than borrowing the passing one", () => {
    expect(gateState(notApplicable)).toBe("not_applicable");
    expect(gateState(notApplicable)).not.toBe("pass");
  });

  test("withholds nothing this receipt recorded, because it declared no failure", () => {
    expect(outputAvailability(notApplicable).state).toBe("usable");
  });
});

/* ------------------------------- no typed output is not a withheld output */

describe("a receipt that recorded no typed artifact is not a warning", () => {
  test("the boundary receipt is neutral and says what it did record", () => {
    const payload = graph();
    const boundary = payload.nodes.find(
      (node) => node.id === "assign_us_puma_ladder.boundary",
    )!;
    expect(boundary.column_artifact_total).toBe(248);
    for (const state of boundary.states) {
      expect(state.execution).toBe("recorded");
      expect(state.outputs).toBe("no_typed_artifact");
      expect(state.outputs_usable).toBe(false);
      expect(state.outputs_reason).toMatch(/no typed or opaque artifact/i);
      expect(state.outputs_reason).toContain("248");
      expect(state.outputs_reason).not.toMatch(/no artifact output|not usable/i);
    }
  });

  test("the gate receipt is neutral too, without claiming it recorded nothing", () => {
    const payload = graph();
    const gate = payload.nodes.find(
      (node) => node.id === "assign_us_puma_ladder.gate",
    )!;
    for (const state of gate.states) {
      expect(state.execution).toBe("recorded");
      expect(state.gate).toBe("pass");
      expect(state.outputs).toBe("no_typed_artifact");
      expect(state.outputs_reason).toMatch(/no typed or opaque artifact/i);
    }
  });

  test("a receipt that did record one still reads as usable", () => {
    const payload = graph();
    for (const id of [
      "assemble_stacked_spine",
      "assemble_stacked_spine.prepare",
      "assign_us_puma_ladder",
      "assign_us_puma_ladder.lookup",
    ]) {
      const node = payload.nodes.find((entry) => entry.id === id)!;
      for (const state of node.states) expect(state.outputs).toBe("usable");
    }
  });

  test("a failure still outranks the absence of a typed output", () => {
    const source = projection();
    const boundary = source.executions[0].nodes.find(
      (node) => node.id === "assign_us_puma_ladder.boundary",
    )!;
    boundary.failed = true;
    const payload = buildReceiptGraph(source, manifest(), verify());
    const state = payload.nodes
      .find((node) => node.id === "assign_us_puma_ladder.boundary")!
      .states.find((entry) => entry.mode === "cold")!;
    expect(state.outputs).toBe("not_usable");
    expect(state.execution).toBe("failed");
  });
});

/* ------------------------------------ what the published evidence does not pin */

describe("the limits distinguish what is bound from what the projection asserts", () => {
  test("names the compiled structural declaration as unpinned rather than absent", () => {
    const limits = graph().limits.join(" ");
    expect(limits).toMatch(/compiled structural declaration/i);
    expect(limits).toMatch(/no publisher attachment pins/i);
    expect(limits).not.toMatch(/never serialised|never serialized|does not exist/i);
  });

  test("marks the two-execution reading as projection-asserted, not publisher-bound", () => {
    const payload = graph();
    expect(payload.comparison.execution_note).toMatch(
      /asserted by this projection/i,
    );
    expect(payload.limits.join(" ")).toMatch(
      /neither manifest byte digest is pinned by anything the publisher attached/i,
    );
  });

  test("still separates that from the digests the publisher's evidence does bind", () => {
    const payload = graph();
    const bound = payload.binding.checks.map((check) => check.detail).join(" ");
    expect(bound.length).toBeGreaterThan(0);
    // The content key is published in the build evidence and is checked; the
    // per-execution manifest byte digests are not, and the payload says so.
    expect(payload.binding.computation_content_key).toMatch(/^[a-f0-9]{64}$/);
    for (const execution of payload.executions)
      expect(bound).not.toContain(execution.manifest_sha256);
  });
});

/* ------------------------------------ the source has to stay readable text */

describe("the modules a reviewer has to read are plain text", () => {
  // `dependencyEdges` joins a producer id and a consumer id into one map key
  // with a separator no id can contain. It was written as a raw control byte in
  // the source, which is right at runtime and wrong on disk: one such byte
  // makes the whole file read as binary. `file(1)` reports "data" for it,
  // `grep -I` skips it in silence, and a review that greps this module for a
  // symbol gets no hits and no warning that the file was never searched. An
  // escape sequence builds the same string and leaves the file text.
  test("no module here carries a byte that makes it read as binary", () => {
    const dir = fileURLToPath(new URL("./", import.meta.url));
    for (const name of [
      "adapter.ts",
      "navigation.ts",
      "presentation.ts",
      "projections.ts",
      "types.ts",
    ]) {
      const offset = readFileSync(`${dir}${name}`).indexOf(0);
      expect(`${name}: first NUL byte at ${offset}`).toBe(
        `${name}: first NUL byte at -1`,
      );
    }
  });

  test("the joined pair key is still unambiguous", () => {
    // Whatever the separator's spelling in the source, it has to be one no id
    // contains, or two different producer/consumer pairs collide on one map
    // entry and their artifacts merge.
    const ids = graph().nodes.map((node) => node.id);
    for (const id of ids) expect(id).not.toContain(PAIR_SEPARATOR);
    const pairs = new Set(
      ids.flatMap((from) => ids.map((to) => `${from}${PAIR_SEPARATOR}${to}`)),
    );
    expect(pairs.size).toBe(ids.length * ids.length);
  });
});
