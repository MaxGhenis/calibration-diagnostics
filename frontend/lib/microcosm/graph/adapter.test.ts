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
  COUNT_WORDS,
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
import { RECEIPT_PROJECTION_SCHEMA } from "./types";

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
  return buildReceiptGraph(
    built.projection,
    built.manifest,
    built.evidence,
    checks,
  );
}

/** The same payload, built from a mutated copy of the shipped inputs. The
 * authored sentences have to follow what the mutation changed; that is the
 * whole point of the prose tests below. */
function graphWith(
  mutate: (input: {
    projection: ReceiptProjection;
    manifest: CandidateQualityManifest;
    evidence: Record<string, unknown>;
  }) => void,
) {
  const built = {
    projection: projection(),
    manifest: manifest(),
    evidence: evidence(),
  };
  mutate(built);
  const checks = verifyProjectionBinding(
    built.projection,
    built.manifest,
    CANDIDATE_MANIFEST_SHA,
    built.evidence,
  );
  return buildReceiptGraph(
    built.projection,
    built.manifest,
    built.evidence,
    checks,
  );
}

// Mutations below are local projections / aggregate evidence copies, never
// changes to the publisher fixtures or claims about another real execution.
function evidenceChecks(value: Record<string, unknown>) {
  return value.checks as Record<string, Record<string, any>>;
}

/** The publisher's own column-ownership block for one execution, read straight
 * out of the attached build evidence. */
function toleranceWriters(
  value: Record<string, unknown>,
  mode: string,
): Record<string, string[]> {
  return evidenceChecks(value)[mode].gate.capabilities.tolerance_writers;
}

describe("receipt consistency regressions from the independent probes", () => {
  const refusals: [string, NonNullable<Parameters<typeof verify>[0]>][] = [
    ["contradictory computed count", ({ projection: p }) => { p.executions[0].computed_count = 999; }],
    ["contradictory cache-hit count", ({ projection: p }) => { p.executions[0].cache_hit_count = 888; }],
    ["contradictory kernel calls", ({ projection: p }) => { p.executions[0].kernel_calls = 777; }],
    ["missing published kernel count", ({ evidence: e }) => { delete evidenceChecks(e).cold.kernel_calls; }],
    ["invalid published kernel count", ({ evidence: e }) => { evidenceChecks(e).cold.kernel_calls = "4"; }],
    ["no executions", ({ projection: p }) => { p.executions = []; }],
    ["omitted published graph execution", ({ projection: p }) => { p.executions.pop(); }],
    ["duplicate execution", ({ projection: p }) => { p.executions.push(clone(p.executions[0])); }],
    ["duplicate display mode", ({ projection: p }) => { p.executions[1].mode = p.executions[0].mode; }],
    ["duplicate evidence key", ({ projection: p }) => { p.executions[1].evidence_key = p.executions[0].evidence_key; }],
    ["duplicate execution byte digest", ({ projection: p }) => { p.executions[1].manifest_sha256 = p.executions[0].manifest_sha256; }],
    ["contradictory projection content key", ({ projection: p }) => { p.computation_content_key = "e".repeat(64); }],
    ["no node receipts", ({ projection: p }) => { p.executions[1].nodes = []; p.executions[1].cache_hit_count = 0; }],
    ["duplicate node id", ({ projection: p }) => { p.executions[1].nodes.push(clone(p.executions[1].nodes[0])); p.executions[1].cache_hit_count++; }],
    ["missing receipt implementation", ({ projection: p }) => { p.executions[0].nodes[0].kernel_impl_hash = null; }],
    ["missing published source pin", ({ evidence: e }) => { delete evidenceChecks(e).cold.source_sha256.puma_ladder; }],
    ["missing gate records", ({ projection: p }) => { for (const e of p.executions) for (const n of e.nodes) n.gate = null; }],
    ["duplicate gate records", ({ projection: p }) => { p.executions[0].nodes[0].gate = clone(p.executions[0].nodes.find(n => n.gate)!.gate); }],
    ["missing publisher gate", ({ evidence: e }) => { delete evidenceChecks(e).cold.gate; }],
    ["contradictory gate passed", ({ projection: p }) => { p.executions[0].nodes.find(n => n.gate)!.gate!.passed = false; }],
    ["contradictory check passed", ({ projection: p }) => { p.executions[0].nodes.find(n => n.gate)!.gate!.checks[0].passed = false; }],
    ["missing gate check", ({ projection: p }) => { p.executions[0].nodes.find(n => n.gate)!.gate!.checks = []; }],
    ["duplicate gate check", ({ projection: p }) => { const g = p.executions[0].nodes.find(n => n.gate)!.gate!; g.checks.push(clone(g.checks[0])); }],
    ["contradictory gate failure", ({ projection: p }) => { p.executions[0].nodes.find(n => n.gate)!.gate!.checks[0].failures.push("invented failure"); }],
    ["contradictory gate detail", ({ projection: p }) => { p.executions[0].nodes.find(n => n.gate)!.gate!.checks[0].details[0].value = 999; }],
    ["duplicate gate detail", ({ projection: p }) => { const c = p.executions[0].nodes.find(n => n.gate)!.gate!.checks[0]; c.details.push(clone(c.details[0])); }],
    ["missing gate detail", ({ projection: p }) => { p.executions[0].nodes.find(n => n.gate)!.gate!.checks[0].details.pop(); }],
    ["projection-only source-like gate detail", ({ projection: p }) => {
      p.executions[0].nodes.find(n => n.gate)!.gate!.checks[0].details.push({ key: "diagnostic", value: "/tmp/receipt-graph-probe-private.csv" });
    }],
    ["contradictory publisher passed evidence", ({ evidence: e }) => { evidenceChecks(e).cold.gate.evidence.passed = false; }],
  ];
  for (const [name, mutate] of refusals)
    test(`refuses ${name}`, () => {
      expect(() => verify(mutate)).toThrow(ReceiptGraphUnavailableError);
    });

  test("byte digests remain projection assertions, with the existing visible limit", () => {
    const p = projection();
    p.executions[0].manifest_sha256 = "e".repeat(64);
    const checks = verifyProjectionBinding(p, manifest(), CANDIDATE_MANIFEST_SHA, evidence());
    const result = buildReceiptGraph(p, manifest(), evidence(), checks);
    expect(result.executions[0].manifest_sha256).toBe("e".repeat(64));
    expect(result.comparison.execution_note).toMatch(/paired by this projection/);
    expect(result.limits.join(" ")).toMatch(/does not pin either recorded run manifest/i);
    expect(checks.find(c => c.label === "Implementation")!.detail).toMatch(/agree/);
    expect(checks.map(c => c.detail).join(" ")).not.toMatch(/Every receipt was produced/);
  });

  test("matches gate objects by names rather than publisher object order", () => {
    expect(() => verify(({ projection: p }) => {
      p.executions[0].nodes.find(n => n.gate)!.gate!.checks[0].details.reverse();
    })).not.toThrow();
  });

  test.each(["fail", "not_applicable", "unreached", "evidence_absent"])(
    "keeps a consistently recorded %s gate distinct from passing", outcome => {
      const p = projection();
      const e = evidence();
      for (const execution of p.executions) {
        const node = execution.nodes.find(n => n.gate)!;
        const passed = outcome === "fail" ? false : null;
        node.gate = { outcome, scope: node.gate!.scope, passed, checks: [] };
        evidenceChecks(e)[execution.evidence_key].gate = {
          outcome, scope: node.gate.scope, evidence: { passed, gates: {} },
        };
        // known_failures is an independent recorded umbrella. Its presence
        // does not turn an unreached executor record into a failure.
        node.failed = outcome === "unreached" || outcome === "fail";
        execution.failed_node_ids = node.failed ? [node.id] : [];
        if (outcome === "unreached") {
          node.blocked = true;
          node.execution_record = { state: "unreached", blocked_by: [], unavailable_artifacts: [] };
          execution.blocked_node_ids = [node.id];
        }
      }
      const checks = verifyProjectionBinding(p, manifest(), CANDIDATE_MANIFEST_SHA, e);
      const result = buildReceiptGraph(p, manifest(), e, checks);
      const states = result.nodes.find(n => n.role === "gate")!.states;
      expect(states.every(s => s.gate === outcome)).toBe(true);
      expect(states.every(s => s.execution === (outcome === "unreached" ? "blocked" : outcome === "fail" ? "failed" : "recorded"))).toBe(true);
      // Generator cache categories are recorded independently of outcomes;
      // retain the real 4/2 and 0/6 totals while showing blocked execution.
      expect(result.executions.map(e => [e.computed_count, e.cache_hit_count])).toEqual([[4, 2], [0, 6]]);
    },
  );

  test("a matching but self-contradictory passing gate is refused", () => {
    expect(() => verify(({ projection: p, evidence: e }) => {
      p.executions[0].nodes.find(n => n.gate)!.gate!.passed = false;
      evidenceChecks(e).cold.gate.evidence.passed = false;
    })).toThrow(ReceiptGraphUnavailableError);
  });

  // The graph producer validates the closed outcome set, but permits diagnostic
  // evidence on an unevaluated/inapplicable gate. These are invented variants;
  // no publisher fixture or registered candidate is changed.
  for (const outcome of ["not_applicable", "unreached", "evidence_absent"]) {
    for (const passed of [null, false, true]) {
      test(`${outcome} retains diagnostic checks with passed=${passed}`, () => {
        const p = projection();
        const e = evidence();
        for (const execution of p.executions) {
          const node = execution.nodes.find(n => n.gate)!;
          node.gate = {
            outcome, scope: node.gate!.scope, passed,
            checks: [{ name: "source_coverage", passed: false,
              failures: ["required observation unavailable"],
              details: [{ key: "observed_rows", value: 0 }] }],
          };
          evidenceChecks(e)[execution.evidence_key].gate = {
            outcome, scope: node.gate.scope,
            evidence: { passed, gates: { source_coverage: {
              passed: false, failures: ["required observation unavailable"],
              details: { observed_rows: 0 },
            } } },
          };
        }
        const verifyCandidate = () => verifyProjectionBinding(
          p, manifest(), CANDIDATE_MANIFEST_SHA, e,
        );
        if (passed === true) {
          expect(verifyCandidate).toThrow(ReceiptGraphUnavailableError);
        } else {
          const result = buildReceiptGraph(p, manifest(), e, verifyCandidate());
          expect(result.nodes.find(n => n.role === "gate")!.states
            .every(state => state.gate === outcome)).toBe(true);
        }
      });
    }
  }
});

describe("recorded failure and executor summaries agree with their receipts", () => {
  const lists = ["failed_node_ids", "blocked_node_ids", "gate_exception_node_ids"] as const;
  const exceptionalStates = [
    { list: "blocked_node_ids", flag: "blocked", state: "unreached", display: "blocked" },
    { list: "gate_exception_node_ids", flag: "gate_exception", state: "gate_exception", display: "failed" },
  ] as const;

  test("refuses a known failure whose receipt does not record failure", () => {
    expect(() => verify(({ projection: p }) => {
      const execution = p.executions[0];
      execution.failed_node_ids = [execution.nodes[0].id];
    })).toThrow(ReceiptGraphUnavailableError);
  });

  for (const list of lists) {
    test(`refuses an unknown id in ${list}`, () => {
      expect(() => verify(({ projection: p }) => {
        p.executions[0][list] = ["unrecorded_node"];
      })).toThrow(ReceiptGraphUnavailableError);
    });
    test(`refuses a duplicate id in ${list}`, () => {
      expect(() => verify(({ projection: p }) => {
        const execution = p.executions[0];
        const node = execution.nodes[0];
        if (list === "failed_node_ids") node.failed = true;
        else {
          const exceptional = exceptionalStates.find(entry => entry.list === list)!;
          node[exceptional.flag] = true;
          node.execution_record = { state: exceptional.state, blocked_by: [], unavailable_artifacts: [] };
        }
        execution[list] = [node.id, node.id];
      })).toThrow(ReceiptGraphUnavailableError);
    });
  }

  for (const exceptional of exceptionalStates) {
    test(`refuses ${exceptional.list} without the corresponding flag`, () => {
      expect(() => verify(({ projection: p }) => {
        const execution = p.executions[0];
        const node = execution.nodes[0];
        node.execution_record = { state: exceptional.state, blocked_by: [], unavailable_artifacts: [] };
        execution[exceptional.list] = [node.id];
      })).toThrow(ReceiptGraphUnavailableError);
    });
    test(`refuses an omitted ${exceptional.list} entry`, () => {
      expect(() => verify(({ projection: p }) => {
        const node = p.executions[0].nodes[0];
        node[exceptional.flag] = true;
        node.execution_record = { state: exceptional.state, blocked_by: [], unavailable_artifacts: [] };
      })).toThrow(ReceiptGraphUnavailableError);
    });
    test(`refuses ${exceptional.flag} without an executor record`, () => {
      expect(() => verify(({ projection: p }) => {
        const execution = p.executions[0];
        const node = execution.nodes[0];
        node[exceptional.flag] = true;
        execution[exceptional.list] = [node.id];
      })).toThrow(ReceiptGraphUnavailableError);
    });
    test(`refuses ${exceptional.flag} with a different executor state`, () => {
      expect(() => verify(({ projection: p }) => {
        const execution = p.executions[0];
        const node = execution.nodes[0];
        node[exceptional.flag] = true;
        node.execution_record = { state: "blocked", blocked_by: [], unavailable_artifacts: [] };
        execution[exceptional.list] = [node.id];
      })).toThrow(ReceiptGraphUnavailableError);
    });
    test(`refuses an executor ${exceptional.state} record hidden by both summaries`, () => {
      expect(() => verify(({ projection: p }) => {
        p.executions[0].nodes[0].execution_record = {
          state: exceptional.state, blocked_by: [], unavailable_artifacts: [],
        };
      })).toThrow(ReceiptGraphUnavailableError);
    });
    test(`preserves a coherent ${exceptional.state} record alongside known failure`, () => {
      const p = projection();
      const execution = p.executions[0];
      const node = execution.nodes[0];
      node.failed = true;
      node[exceptional.flag] = true;
      node.execution_record = { state: exceptional.state, blocked_by: [], unavailable_artifacts: [] };
      execution.failed_node_ids = [node.id];
      execution[exceptional.list] = [node.id];
      const checks = verifyProjectionBinding(p, manifest(), CANDIDATE_MANIFEST_SHA, evidence());
      const result = buildReceiptGraph(p, manifest(), evidence(), checks);
      const state = result.nodes.find(entry => entry.id === node.id)!.states.find(entry => entry.mode === "cold")!;
      expect(state.execution).toBe(exceptional.display);
      expect(state.outputs_usable).toBe(false);
      expect(result.executions.map(entry => [entry.computed_count, entry.cache_hit_count])).toEqual([[4, 2], [0, 6]]);
    });
  }

  test("preserves an explicit receipt rejection outside the known-failure list", () => {
    const p = projection();
    const node = p.executions[0].nodes[0];
    // The generator also sets failed from receipt.rejected, independently of
    // the run's known_failures list; the implication is only list -> flag.
    node.failed = true;
    const checks = verifyProjectionBinding(p, manifest(), CANDIDATE_MANIFEST_SHA, evidence());
    const result = buildReceiptGraph(p, manifest(), evidence(), checks);
    const state = result.nodes.find(entry => entry.id === node.id)!.states.find(entry => entry.mode === "cold")!;
    expect(state.execution).toBe("failed");
    expect(state.outputs_usable).toBe(false);
  });
});

describe("a typed input must resolve its producer's declared output", () => {
  type Mutate = (input: ProjectionNode["typed_inputs"][number], producer: ProjectionNode) => void;
  const cases: [string, Mutate][] = [
    ["missing producer key", input => { delete input.producer_key; }],
    ["missing input artifact key", input => { input.artifact_key = null; }],
    ["different artifact key", input => { input.artifact_key = "f".repeat(64); }],
    ["different artifact name", input => { input.artifact = "undeclared"; }],
    ["different artifact type", input => { input.type = "wrong.type"; }],
    ["different artifact version", input => { input.type_version = 99; }],
    ["missing artifact type", input => { input.type = null; }],
    ["missing artifact version", input => { input.type_version = null; }],
    ["omitted version on both declarations", (input, producer) => {
      Reflect.deleteProperty(input, "type_version");
      Reflect.deleteProperty(producer.typed_outputs[0], "type_version");
    }],
    ["missing producer output", (_, producer) => { producer.typed_outputs.shift(); }],
    ["ambiguous producer output", (_, producer) => { producer.typed_outputs.push(clone(producer.typed_outputs[0])); }],
    ["absent producer receipt", (_, producer) => { producer.receipt_present = false; }],
  ];
  for (const [label, mutate] of cases)
    test(`drops ${label} with an explicit coverage limit`, () => {
      const p = projection();
      for (const execution of p.executions) {
        const consumer = execution.nodes.find(n => n.id === "assemble_stacked_spine")!;
        const producer = execution.nodes.find(n => n.id === "assemble_stacked_spine.prepare")!;
        mutate(consumer.typed_inputs[0], producer);
      }
      const result = buildReceiptGraph(p, manifest(), evidence(), verify());
      const edge = result.edges.find(e => e.to === "assemble_stacked_spine");
      expect(edge?.artifacts.some(a => a.name === "frame_context") ?? false).toBe(false);
      expect(result.coverage.complete).toBe(false);
      expect(result.limits.some(l => l.startsWith("cold: assemble_stacked_spine"))).toBe(true);
    });

  test("a consumer-local alias still resolves the declared artifact name", () => {
    const p = projection();
    for (const execution of p.executions)
      execution.nodes.find(n => n.id === "assemble_stacked_spine")!.typed_inputs[0].name = "local_frame";
    const result = buildReceiptGraph(p, manifest(), evidence(), verify());
    expect(result.edges.find(e => e.to === "assemble_stacked_spine")!.artifacts.some(a => a.name === "local_frame")).toBe(true);
  });

  test("drops ambiguous consumer slots rather than drawing both claims", () => {
    const p = projection();
    for (const execution of p.executions) {
      const inputs = execution.nodes.find(n => n.id === "assemble_stacked_spine")!.typed_inputs;
      inputs[1].name = inputs[0].name;
    }
    const result = buildReceiptGraph(p, manifest(), evidence(), verify());
    expect(result.edges.some(e => e.to === "assemble_stacked_spine")).toBe(false);
    expect(result.limits.join(" ")).toMatch(/ambiguous input/);
  });

  test("a dropped typed input overrides a projection claim of complete coverage", () => {
    const p = projection();
    p.coverage.complete = true;
    delete p.executions[0].nodes.find(node => node.id === "assemble_stacked_spine")!
      .typed_inputs[0].producer_key;
    const checks = verifyProjectionBinding(p, manifest(), CANDIDATE_MANIFEST_SHA, evidence());
    const result = buildReceiptGraph(p, manifest(), evidence(), checks);
    expect(result.coverage.complete).toBe(false);
    expect(result.limits.join(" ")).toMatch(/recorded no key/);
  });
});

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
      evidence(),
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
    const payload = buildReceiptGraph(source, manifest(), evidence(), verify());
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
    const payload = buildReceiptGraph(source, manifest(), evidence(), verify());
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
    const payload = buildReceiptGraph(source, manifest(), evidence(), verify());
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
  for (const [name, key] of [
    ["calibration_diagnostics", "calibration"],
    ["cross_dataset", "cross_dataset"],
  ] as const) {
    test(`published ${name} is available evidence, not a verified graph mapping`, async () => {
      const { createHash } = await import("node:crypto");
      const { CandidateQualityReader } = await import("../quality/artifact");
      const candidate = manifest();
      // An invented available descriptor: its bytes are deliberately not read,
      // interpreted as diagnostics, or asserted scientifically valid here.
      candidate.attachments[name] = { ...candidate.attachments.support };
      const bytes = Buffer.from(JSON.stringify(candidate));
      const digest = createHash("sha256").update(bytes).digest("hex");
      const reads: string[] = [];
      const reader = new CandidateQualityReader({ country: "us", readBytes: async path => {
        reads.push(path);
        expect(path).toBe(`manifests/${digest}.json`);
        return bytes;
      } });
      const checked = await reader.manifest(candidate.candidate_release_id, digest);
      const p = projection();
      p.candidate_manifest_sha256 = digest;
      const e = evidence();
      const payload = buildReceiptGraph(p, checked, e, verifyProjectionBinding(p, checked, digest, e));
      const mapping = payload.mappings.find(m => m.key === key)!;
      expect(mapping.state).toBe("unresolved");
      expect(mapping.reason).toContain("declares an available");
      expect(mapping.reason).toContain("has not loaded");
      expect(mapping.reason).not.toContain("publishes no evidence");
      expect(payload.edges).toEqual(graph().edges);
      expect(payload.candidate.release_eligibility).toEqual(candidate.release_eligibility);
      expect(payload.mappings.find(m => m.key === "target_binding")!.reason).not.toContain("No target surface is bound to this run");
      expect(reads).toEqual([`manifests/${digest}.json`]);
    });

    for (const status of ["pending", "failed"] as const) {
      test(`${name} keeps its ${status} descriptor distinct from missing evidence`, () => {
        const candidate = manifest();
        candidate.attachments[name] = { status, reason: "Publisher's diagnostic reason." };
        const payload = buildReceiptGraph(projection(), candidate, evidence(), verify());
        const mapping = payload.mappings.find(m => m.key === key)!;
        expect(mapping.state).toBe("unresolved");
        expect(mapping.reason).toContain(status);
        expect(mapping.reason).toContain("Publisher's diagnostic reason.");
      });
    }

    test(`missing ${name} preserves the published reason`, () => {
      const mapping = graph().mappings.find(m => m.key === key)!;
      expect(mapping.state).toBe("missing");
      expect(mapping.reason).toBe(manifest().attachments[name].reason!);
    });
  }

  test("a third verified execution never borrows a two-execution caption", () => {
    const p = projection();
    const e = evidence();
    const third = clone(p.executions[0]);
    third.mode = "third";
    third.label = "Invented third execution";
    third.evidence_key = "third";
    third.manifest_sha256 = "e".repeat(64);
    p.executions.push(third);
    evidenceChecks(e).third = clone(evidenceChecks(e).cold);
    const payload = buildReceiptGraph(p, manifest(), e, verifyProjectionBinding(p, manifest(), CANDIDATE_MANIFEST_SHA, e));
    expect(payload.executions).toHaveLength(3);
    expect(payload.limits.join(" ")).toContain("three executions");
    expect(payload.limits.join(" ")).not.toContain("the two share");
  });

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
    const payload = buildReceiptGraph(source, manifest(), evidence(), verify());
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

  test("marks the pairing as this projection's and the executions as published", () => {
    const payload = graph();
    expect(payload.comparison.execution_note).toMatch(
      /paired by this projection/i,
    );
    expect(payload.limits.join(" ")).toMatch(/paired by this projection/i);
    expect(payload.limits.join(" ")).toMatch(
      /does not pin either recorded run manifest's byte digest/i,
    );
  });

  test("does not understate the evidence the publisher does bind", () => {
    // Read from the attached build evidence itself: `checks.cold` and
    // `checks.resume` are two blocks with different kernel-call counts, 4 and
    // 0, and different start times. That there were two executions is
    // therefore the publisher's own record, not this projection's claim. What
    // the projection asserts is narrower: which recorded manifest bytes belong
    // to which mode. The evidence's own `manifest_sha256` is the shared content
    // key for both modes, so it pins neither byte digest.
    const evidence = RAW_EVIDENCE.checks as Record<string, { kernel_calls: number; manifest_sha256: string }>;
    expect(evidence.cold.kernel_calls).toBe(4);
    expect(evidence.resume.kernel_calls).toBe(0);
    expect(evidence.cold.manifest_sha256).toBe(evidence.resume.manifest_sha256);

    const payload = graph();
    const note = `${payload.comparison.execution_note} ${payload.limits.join(" ")}`;
    expect(note).toMatch(/kernel/i);
    expect(note).not.toMatch(
      /that separation is asserted by this projection|the two executions are asserted by this projection/i,
    );
    expect(note).toMatch(/which .{0,40}bytes belong to which|pairing/i);
  });

  test("names the one slice of column ownership the publisher does pin", () => {
    // `checks.<mode>.gate.capabilities.tolerance_writers` lists, for the
    // columns inside the gate's declared tolerance scope, which steps wrote
    // them. That is publisher-bound column ownership, and the limits say the
    // column-level flow lives only in the unpinned declaration. It is still not
    // drawn — it covers one gate's scope, not the graph — but the limits must
    // not claim it does not exist.
    //
    // The count and the entity are read out of the evidence here rather than
    // written down, because the sentence itself is now read out of the evidence.
    const writers = toleranceWriters(RAW_EVIDENCE, "cold");
    const columns = Object.keys(writers);
    const entities = new Set(columns.map((column) => column.split(".")[0]));
    expect(columns.length).toBeGreaterThan(0);
    expect(entities.size).toBe(1);

    const limits = graph().limits.join(" ");
    expect(limits).toMatch(/tolerance scope|the gate's declared/i);
    expect(limits).toContain(
      `${COUNT_WORDS[columns.length]} ${[...entities][0]} columns`,
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

/* ------------------------------------ the prose has to describe the evidence */

describe("the authored prose follows the evidence rather than this candidate", () => {
  // Four sentences under "What was checked" used to be literals: "four
  // household columns", "this candidate completed and is excluded from
  // release", "two executions, one computing four kernel calls and one
  // computing none", and "One gate record". Each was true of the single
  // projection registered today and would have become a false statement the
  // moment a second one was registered. These tests change the evidence and
  // read the sentence back.

  test("the execution count and the kernel-call counts come from the evidence", () => {
    // One execution instead of two. The published check for the dropped
    // execution goes with it, or the binding refuses an omitted execution.
    const payload = graphWith(({ projection: p, evidence: e }) => {
      p.executions.pop();
      delete evidenceChecks(e).resume;
    });
    expect(payload.executions).toHaveLength(1);
    const prose = `${payload.comparison.execution_note} ${payload.limits.join(" ")}`;
    expect(prose).toContain("records one execution of this run");
    expect(prose).toContain("computing four kernel calls");
    expect(prose).not.toMatch(/two executions|one computing none/);
  });

  test("a different published kernel-call count is what the sentence says", () => {
    const payload = graphWith(({ projection: p, evidence: e }) => {
      // Three of the cold run's four computed receipts become cache hits, so
      // the publisher's kernel-call count for that execution is one.
      for (const node of p.executions[0].nodes.slice(2, 5)) node.cache = "hit";
      p.executions[0].computed_count = 1;
      p.executions[0].cache_hit_count = 5;
      p.executions[0].kernel_calls = 1;
      evidenceChecks(e).cold.kernel_calls = 1;
    });
    const prose = `${payload.comparison.execution_note} ${payload.limits.join(" ")}`;
    expect(prose).toContain("one computing one kernel call and one computing none");
    expect(prose).not.toContain("four kernel calls");
  });

  test("the release sentence reads the manifest's own two statuses", () => {
    const payload = graphWith(({ manifest: m }) => {
      m.execution_status = "failed";
      m.release_eligibility = {
        status: "not_evaluated",
        reason: "Not evaluated for release.",
      };
    });
    const limits = payload.limits.join(" ");
    expect(limits).toContain("execution as failed");
    expect(limits).toContain("release eligibility as not evaluated");
    expect(limits).not.toMatch(/this candidate completed|excluded from release/);
  });

  test("the shipped candidate's own two statuses still read correctly", () => {
    const limits = graph().limits.join(" ");
    expect(limits).toContain(
      `execution as ${RAW_MANIFEST.execution_status as string}`,
    );
    expect(limits).toContain("release eligibility as excluded");
  });

  test("the gate note counts the gate records rather than saying one", () => {
    const payload = graphWith(({ projection: p, evidence: e }) => {
      // The second execution records its gate on a different receipt, so the
      // run holds two gate-bearing node ids rather than one. Each execution
      // still publishes exactly the one gate its own check declares.
      const replay = p.executions[1];
      const gate = replay.nodes.find((node) => node.id.endsWith(".gate"))!;
      const moved = replay.nodes.find((node) => node.id === "assign_us_puma_ladder.lookup")!;
      moved.role = "gate";
      moved.gate = gate.gate;
      gate.role = "compute";
      gate.gate = null;
      evidenceChecks(e).resume.gate = clone(evidenceChecks(e).cold.gate);
    });
    expect(payload.gates.records).toBe(2);
    expect(payload.gates.note).toContain("Two gate records in this run");
    expect(payload.gates.note).toContain("They attest to their own scopes");
    expect(payload.gates.note).not.toContain("One gate record");
  });

  test("a gate that recorded no scope is still counted as a gate record", () => {
    // The old note keyed its whole sentence off the declared scopes, so a gate
    // with none produced `records: 1` beside "No gate record in this run" —
    // the payload contradicting itself.
    const payload = graphWith(({ projection: p, evidence: e }) => {
      for (const execution of p.executions)
        execution.nodes.find((node) => node.gate)!.gate!.scope = null;
      for (const mode of ["cold", "resume"])
        delete evidenceChecks(e)[mode].gate.scope;
    });
    expect(payload.gates.records).toBe(1);
    expect(payload.gates.note).toContain("One gate record in this run");
    expect(payload.gates.note).toContain("no declared scope");
    expect(payload.gates.note).not.toContain("No gate record in this run");
  });

  test("the column-ownership count and entity come from the published writers", () => {
    const payload = graphWith(({ evidence: e }) => {
      for (const mode of ["cold", "resume"])
        evidenceChecks(e)[mode].gate.capabilities.tolerance_writers = {
          "person.age": ["assign_us_puma_ladder"],
          "person.state_fips": ["assemble_stacked_spine.prepare"],
          "person.puma": ["assign_us_puma_ladder"],
        };
    });
    const limits = payload.limits.join(" ");
    expect(limits).toContain("three person columns");
    expect(limits).not.toContain("four household columns");
  });

  test("columns from more than one entity are counted without naming an entity", () => {
    const payload = graphWith(({ evidence: e }) => {
      for (const mode of ["cold", "resume"])
        evidenceChecks(e)[mode].gate.capabilities.tolerance_writers = {
          "person.age": ["assign_us_puma_ladder"],
          "household.puma": ["assign_us_puma_ladder"],
        };
    });
    const limits = payload.limits.join(" ");
    expect(limits).toContain("two columns inside");
    expect(limits).not.toMatch(/two (person|household) columns/);
  });
});

/* ------------------------------------ prose must not claim absent evidence */

describe("no sentence claims evidence the candidate did not publish", () => {
  const withoutWriters = () =>
    graphWith(({ evidence: e }) => {
      for (const mode of ["cold", "resume"])
        delete evidenceChecks(e)[mode].gate.capabilities;
    });

  test("no published column ownership means no claim that any is published", () => {
    const limits = withoutWriters().limits.join(" ");
    expect(limits).not.toMatch(/slice of column ownership is published/i);
    expect(limits).toMatch(/records no writer for any column/i);
  });

  test("the unpinned structural declaration is still named either way", () => {
    // Dropping the published slice must not drop the reason the column-level
    // flow is missing from the canvas.
    const limits = withoutWriters().limits.join(" ");
    expect(limits).toMatch(/compiled structural declaration/i);
    expect(limits).toMatch(/no publisher attachment pins/i);
  });

  test("writers with no named step are not counted as published ownership", () => {
    // A column whose writer list is empty names no step, so there is nothing
    // to report as ownership. The count must not include it.
    const payload = graphWith(({ evidence: e }) => {
      for (const mode of ["cold", "resume"])
        evidenceChecks(e)[mode].gate.capabilities.tolerance_writers = {
          "household.puma": [],
          "household.county_fips": ["assign_us_puma_ladder"],
        };
    });
    const limits = payload.limits.join(" ");
    expect(limits).toContain("one household column inside");
    expect(limits).not.toMatch(/two household columns/);
  });

  test("an unreadable writer record is left out rather than guessed at", () => {
    const payload = graphWith(({ evidence: e }) => {
      for (const mode of ["cold", "resume"])
        evidenceChecks(e)[mode].gate.capabilities.tolerance_writers = "not an object";
    });
    const limits = payload.limits.join(" ");
    expect(limits).not.toMatch(/slice of column ownership is published/i);
    expect(limits).toMatch(/records no writer for any column/i);
  });

  test("an execution with no published gate produces no gate or ownership claim", () => {
    const payload = graphWith(({ projection: p, evidence: e }) => {
      for (const execution of p.executions)
        for (const node of execution.nodes) {
          node.gate = null;
          if (node.role === "gate") node.role = "compute";
        }
      for (const mode of ["cold", "resume"]) delete evidenceChecks(e)[mode].gate;
    });
    expect(payload.gates.records).toBe(0);
    expect(payload.gates.note).toBe("No gate record in this run. That is not a pass.");
    expect(payload.limits.join(" ")).not.toMatch(/slice of column ownership is published/i);
  });
});

/* ------------------------------------ a second, internally consistent candidate */

// A hand-built alternate candidate, deliberately unlike the shipped one: one
// execution rather than two, one kernel call rather than four and none, one
// cache hit rather than two, a gate that declared itself not applicable rather
// than one that passed, two person columns in its tolerance scope rather than
// four household ones, and a build still running and not yet evaluated for
// release. It is never registered in `projections.ts`, so no request can reach
// it. It exists so the authored sentences can be read against evidence that is
// not this dashboard's one candidate — the case the old literals got wrong.
const ALT = {
  candidate: "us-graph-alternate-fixture-v1",
  run: "us-graph-alternate-fixture-run",
  manifest: "1".repeat(64),
  evidence: "2".repeat(64),
  population: "3".repeat(64),
  implementation: "4".repeat(64),
  contentKey: "5".repeat(64),
  runManifest: "6".repeat(64),
  producerKey: "7".repeat(64),
  gateKey: "8".repeat(64),
  artifactKey: "9".repeat(64),
  sourcePin: "a".repeat(64),
};

function altNode(overrides: Partial<ProjectionNode> & { id: string }): ProjectionNode {
  return {
    label: overrides.id,
    group: "alternate",
    group_label: "Alternate assembly",
    role: "compute",
    receipt_present: true,
    failed: false,
    blocked: false,
    gate_exception: false,
    execution_record: null,
    receipt_outcome: "recorded",
    cache: "computed",
    node_key: ALT.producerKey,
    kernel_ref: "alternate.kernel",
    kernel_impl_hash: ALT.implementation,
    determinism: "deterministic",
    numeric: "bitwise",
    tolerance: null,
    runtime_dependencies: [],
    seed: null,
    wall_time_seconds: 0.25,
    frame_key: null,
    weight_key: null,
    phase: null,
    typed_inputs: [],
    typed_outputs: [],
    opaque_artifact_keys: [],
    column_artifact_counts: [],
    column_artifact_total: 0,
    gate: null,
    source_pins: [],
    measures: [],
    ...overrides,
  };
}

function altProjection(): ReceiptProjection {
  const typedArtifact = {
    name: "frame",
    artifact: "alternate.frame",
    type: "frame",
    type_version: 1,
    artifact_key: ALT.artifactKey,
    numeric: "bitwise",
    tolerance: null,
  };
  return {
    schema_version: RECEIPT_PROJECTION_SCHEMA,
    projection_version: 1,
    is_publisher_attachment: false,
    provenance_note: "A hand-built alternate reduction, used only by these tests.",
    label_basis: "Stage names are the node ids.",
    coverage: {
      basis: "run_manifest_typed_artifacts",
      complete: true,
      reason: "Both recorded receipts declare the typed artifact that connects them.",
    },
    country: "us",
    candidate_release_id: ALT.candidate,
    candidate_manifest_sha256: ALT.manifest,
    run_id: ALT.run,
    population_sha256: ALT.population,
    build_evidence_sha256: ALT.evidence,
    kernel_impl_hash: ALT.implementation,
    computation_content_key: ALT.contentKey,
    content_key_note: "One content key identifies the computation and its outputs.",
    executions: [
      {
        mode: "only",
        evidence_key: "only",
        label: "Only recorded run",
        description: "The single recorded execution of this alternate candidate.",
        manifest_sha256: ALT.runManifest,
        manifest_schema_version: 1,
        content_key: ALT.contentKey,
        kernel_calls: 1,
        computed_count: 1,
        cache_hit_count: 1,
        failed_node_ids: [],
        blocked_node_ids: [],
        gate_exception_node_ids: [],
        release_tier: null,
        decision_count: 0,
        nodes: [
          altNode({
            id: "alternate_build",
            label: "Alternate build",
            node_key: ALT.producerKey,
            source_pins: [
              { key: "alternate_source", label: "Alternate source", sha256: ALT.sourcePin },
            ],
            typed_outputs: [typedArtifact],
          }),
          altNode({
            id: "alternate_build.gate",
            label: "Alternate gate",
            role: "gate",
            cache: "hit",
            node_key: ALT.gateKey,
            typed_inputs: [
              { ...typedArtifact, producer: "alternate_build", producer_key: ALT.producerKey },
            ],
            gate: {
              outcome: "not_applicable",
              scope: "alternate_scope",
              passed: null,
              checks: [],
            },
          }),
        ],
      },
    ],
  };
}

function altManifest(): CandidateQualityManifest {
  return {
    schema_version: "microcosm.candidate_quality.v1",
    country: "us",
    candidate_release_id: ALT.candidate,
    run_id: ALT.run,
    created_at: "2026-09-05T00:00:00+00:00",
    execution_status: "running",
    release_eligibility: {
      status: "not_evaluated",
      reason: "This alternate fixture is not evaluated for release.",
    },
    population: {
      sha256: ALT.population,
      period: "alternate fixture (development)",
      entity: "person",
    },
    provenance: { source_implementation_sha256: ALT.implementation },
    geography: null,
    attachments: {
      build_manifest: {
        status: "available",
        scope: "run",
        sha256: ALT.evidence,
        path: `artifacts/${ALT.evidence}.json`,
        identity: { candidate_release_id: ALT.candidate, run_id: ALT.run },
      },
    },
  } as CandidateQualityManifest;
}

function altEvidence(): Record<string, unknown> {
  return {
    candidate_release_id: ALT.candidate,
    run_id: ALT.run,
    checks: {
      only: {
        manifest_sha256: ALT.contentKey,
        implementation_sha256: ALT.implementation,
        population_sha256: ALT.population,
        kernel_calls: 1,
        source_sha256: { alternate_source: ALT.sourcePin },
        gate: {
          outcome: "not_applicable",
          scope: "alternate_scope",
          evidence: { passed: null, gates: {} },
          capabilities: {
            tolerance_writers: {
              "person.age": ["alternate_build"],
              "person.state_fips": ["alternate_build"],
            },
          },
        },
      },
    },
  };
}

function altGraph() {
  const source = altProjection();
  const manifest = altManifest();
  const evidence = altEvidence();
  const checks = verifyProjectionBinding(source, manifest, ALT.manifest, evidence);
  return { checks, payload: buildReceiptGraph(source, manifest, evidence, checks) };
}

describe("a second candidate reads as itself, not as the one that ships", () => {
  test("the alternate fixture is internally consistent and binds", () => {
    const { checks, payload } = altGraph();
    expect(checks.map((check) => check.label)).toEqual([
      "Candidate manifest",
      "Build evidence",
      "Population",
      "Implementation",
      "Only recorded run receipts",
    ]);
    expect(checks.at(-1)!.detail).toContain("1 computed and 1 served from cache");
    expect(checks.at(-1)!.detail).toContain("1 projected source pins");
    expect(payload.candidate.id).toBe(ALT.candidate);
    expect(payload.executions).toHaveLength(1);
    expect(payload.edges.map((edge) => `${edge.from} -> ${edge.to}`)).toEqual([
      "alternate_build -> alternate_build.gate",
    ]);
    expect(payload.coverage.complete).toBe(true);
    expect(payload.coverage.recorded_edges).toBe(1);
  });

  test("its limits state its own counts and statuses", () => {
    const limits = altGraph().payload.limits.join(" ");
    expect(limits).toContain("records one execution of this run, computing one kernel call");
    expect(limits).toContain("two person columns inside");
    expect(limits).toContain("execution as running");
    expect(limits).toContain("release eligibility as not evaluated");
    // None of the shipped candidate's figures may appear.
    expect(limits).not.toMatch(
      /two executions|four kernel calls|four household columns|completed|excluded from release/i,
    );
  });

  test("its comparison prose does not describe two executions", () => {
    const { payload } = altGraph();
    expect(payload.comparison.title).toBe("One recorded execution");
    expect(payload.comparison.execution_note).toContain("a single recorded execution");
    expect(payload.comparison.execution_note).toContain("paired by this projection");
    expect(payload.comparison.execution_note).not.toMatch(
      /different byte digests|two executions|four kernel calls/,
    );
    expect(payload.comparison.distinct_executions).toBe(true);
    expect(payload.comparison.same_computation_content_key).toBe(true);
  });

  test("its gate note reads its own single not-applicable gate", () => {
    const { payload } = altGraph();
    expect(payload.gates.records).toBe(1);
    expect(payload.gates.note).toBe(
      "One gate record in this run, scoped to alternate_scope. It attests to its own scope and to nothing else here.",
    );
    const gate = payload.nodes.find((node) => node.role === "gate")!;
    expect(gate.states[0].gate).toBe("not_applicable");
    // Not applicable withheld nothing, and this receipt declared no artifact.
    expect(gate.states[0].outputs).toBe("no_typed_artifact");
  });

  test("the shipped candidate's prose is unchanged by any of this", () => {
    const payload = graph();
    expect(payload.comparison.title).toBe("Same computation, two executions");
    expect(payload.limits.join(" ")).toContain(
      "records two executions of this run, one computing four kernel calls and one computing none",
    );
    expect(payload.gates.note).toBe(
      "One gate record in this run, scoped to geography_assignment_integrity. It attests to its own scope and to nothing else here.",
    );
    expect(payload.limits.join(" ")).toContain(
      "for the four household columns inside the gate's declared tolerance scope",
    );
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

// Snapshot captured from the unchanged base adapter before attachment support.
// Only these two additive fields are authorized on the shared legacy payload.
test("F001 complete response is byte-identical except explicit basis and set", () => {
  const response = graph();
  expect(response.projection.basis).toBe("local_projection");
  expect(response.binding.implementation_set).toBeNull();
  const { basis, ...projection } = response.projection;
  const { implementation_set, ...binding } = response.binding;
  const before = readFileSync(new URL("./fixtures/f001-response-before-attachment.json", import.meta.url), "utf8");
  expect(JSON.stringify({ ...response, projection, binding }, null, 2) + "\n").toBe(before);
});
