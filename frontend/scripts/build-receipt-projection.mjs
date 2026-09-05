#!/usr/bin/env bun
/**
 * Build the compact receipt projection the dashboard ships for one immutable
 * candidate.
 *
 * The dashboard cannot read a producer's graph run manifests: they are hundreds
 * of kilobytes, they name the machine that ran them, and they carry a content
 * key for every column of the population. This script reduces two of them to
 * the aggregate facts a reader needs, and records the digests of everything it
 * read so the result can be regenerated and checked byte for byte.
 *
 * What it does NOT do: it does not write, rewrite or extend the immutable
 * candidate manifest, and the file it produces is not a publisher attachment.
 * It is a local projection whose association with the candidate is re-verified
 * on every request, against the candidate manifest and the publisher's own
 * build-evidence attachment. If any of those bindings stop agreeing, the
 * dashboard shows the run as unavailable rather than drawing this file.
 *
 * Usage (paths are operator arguments, never request input):
 *
 *   bun scripts/build-receipt-projection.mjs \
 *     --quality-dir  /abs/path/to/candidate-quality \
 *     --evidence-dir /abs/path/to/preserved-run-evidence \
 *     --candidate    us-graph-f001-geography-20260905-v1 \
 *     --manifest-sha256 ff2f...885 \
 *     --out lib/microcosm/graph/receipts/us-graph-f001-geography-20260905-v1.json
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PROJECTION_SCHEMA = "microcosm.dashboard.receipt_projection.v1";
const PROJECTION_VERSION = 1;

/** Every field of a run manifest this projection is allowed to carry. Anything
 * outside the list stays on the producer's disk: the host name, the per-column
 * artifact keys, the dtype transition log, the id/order/mapping digests, the
 * checkpoint files and the wall-clock timestamps. */
const SOURCE_FIELD_ALLOWLIST = [
  "key",
  "schema_version",
  "nodes.*.hit",
  "nodes.*.key",
  "nodes.*.kernel_ref",
  "nodes.*.kernel_impl_hash",
  "nodes.*.seed",
  "nodes.*.wall_time",
  "nodes.*.frame_key",
  "nodes.*.weight_key",
  "nodes.*.capabilities.role",
  "nodes.*.capabilities.determinism",
  "nodes.*.capabilities.numeric",
  "nodes.*.capabilities.tolerance",
  "nodes.*.capabilities.dependencies",
  "nodes.*.artifacts.*.entity (counted, never listed)",
  "nodes.*.opaque_artifacts",
  "nodes.*.typed_artifacts.inputs.*.{artifact,key,producer,producer_key,type,numerics.numeric,numerics.tolerance}",
  "nodes.*.typed_artifacts.outputs.*.{artifact,key,type,numerics.numeric,numerics.tolerance}",
  "nodes.*.receipt.phase",
  "nodes.*.receipt.outcome",
  "nodes.*.receipt.scope",
  "nodes.*.receipt.rejected",
  "nodes.*.receipt.execution.{schema,state,blocked_by,unavailable_artifacts}",
  "nodes.*.receipt.evidence.passed",
  "nodes.*.receipt.evidence.gates.*.{passed,failures,details}",
  "nodes.*.receipt.crosswalk_sha256",
  "nodes.*.receipt.ladder_sha256",
  "nodes.*.receipt.district_vintage",
  "nodes.*.receipt.district_count",
  "nodes.*.receipt.puma_count",
  "nodes.*.receipt.summary (selected aggregate counts and weighted shares)",
  "nodes.*.receipt.mass.{before,after,policy}",
  "nodes.*.receipt.assembly.{sample_fraction,sample_seed,mass_anchor_channel,household_mass_shares}",
  "nodes.*.receipt.preparation.{schema,stacked_manifest_version,sampling.survey_samples.*.counts}",
  "decisions (counted, never listed)",
  "known_failures",
];

/** The executor's own exceptional-outcome record, from
 * `microcosm.graph.availability`. Anything else under `receipt.execution` is a
 * producer's free-form diagnostic and is left uninterpreted. */
const EXECUTION_SCHEMA = "microcosm.graph.execution.v1";
/** `microcosm.graph.decl.GATE_OUTCOMES`. */
const GATE_OUTCOMES = ["pass", "fail", "evidence_absent", "not_applicable", "unreached"];

/** Plain renderings of the native node ids. Nothing here adds meaning the
 * receipts do not carry: each label is shown next to its native id, and a node
 * missing from this table falls back to its own id. */
const NODE_LABELS = {
  "assemble_stacked_spine.prepare": "Assembly preparation",
  assemble_stacked_spine: "Spine harmonization",
  "assign_us_puma_ladder.lookup": "Crosswalk and ladder lookup",
  assign_us_puma_ladder: "Geography assignment",
  "assign_us_puma_ladder.boundary": "Geography boundary step",
  "assign_us_puma_ladder.gate": "Geography integrity gate",
};

/** Stage names for the two id prefixes present in this run. The group is taken
 * mechanically from the text before the first dot in the native id. */
const GROUP_LABELS = {
  assemble_stacked_spine: "Assembly",
  assign_us_puma_ladder: "Geography",
};

/** The two preserved executions, named by the mode key the publisher's build
 * evidence uses for each. `direct` is a third recorded mode with no saved graph
 * manifest, so it is not projected. */
const EXECUTIONS = [
  {
    mode: "cold",
    evidenceKey: "cold",
    file: "cold/graph-manifest.json",
    label: "Cold run",
    description:
      "The graph run recorded with an empty result cache for the geography phase.",
  },
  {
    mode: "replay",
    evidenceKey: "resume",
    file: "resume/graph-manifest.json",
    label: "Required replay",
    description:
      "The cache-only replay the producer required after the cold run, recorded under the build-evidence mode `resume`.",
  },
];

/** Aggregate receipt facts worth showing, per native node id. Each entry names
 * an exact path inside that node's receipt; a path that is absent is skipped
 * rather than defaulted, so a missing measure never becomes a zero. */
const MEASURES = {
  "assemble_stacked_spine.prepare": [
    ["preparation.schema", "Preparation schema"],
    ["preparation.stacked_manifest_version", "Stacked manifest version"],
    ["preparation.sampling.sample_fraction", "Sample fraction"],
    ["preparation.sampling.sample_seed", "Sample seed"],
    [
      "preparation.sampling.survey_samples.acs.realized_household_count",
      "ACS households sampled",
    ],
    [
      "preparation.sampling.survey_samples.acs.eligible_household_count",
      "ACS households eligible",
    ],
    [
      "preparation.sampling.survey_samples.asec.realized_household_count",
      "ASEC households sampled",
    ],
    [
      "preparation.sampling.survey_samples.asec.eligible_household_count",
      "ASEC households eligible",
    ],
    ["preparation.mass_anchor_channel", "Mass anchor channel"],
  ],
  assemble_stacked_spine: [
    ["assembly.version", "Assembly receipt version"],
    ["assembly.sample_fraction", "Sample fraction"],
    ["assembly.sample_seed", "Sample seed"],
    ["assembly.mass_anchor_channel", "Mass anchor channel"],
    ["assembly.household_mass_shares.acs", "ACS household mass share"],
    ["assembly.household_mass_shares.asec", "ASEC household mass share"],
    ["mass.policy", "Weight mass policy"],
    ["mass.before", "Person weight mass before"],
    ["mass.after", "Person weight mass after"],
  ],
  "assign_us_puma_ladder.lookup": [
    ["district_vintage", "District vintage"],
    ["district_count", "Districts in the crosswalk"],
    ["puma_count", "PUMAs in the ladder"],
  ],
  assign_us_puma_ladder: [
    ["district_vintage", "District vintage"],
    ["target_district_count", "Target district count"],
    ["summary.household_rows", "Household rows"],
    ["summary.assigned_puma_values", "Distinct PUMAs assigned"],
    ["summary.assigned_county_fips_values", "Distinct counties assigned"],
    [
      "summary.assigned_congressional_district_geoid_values",
      "Distinct districts assigned",
    ],
    ["summary.puma_nonempty_weighted_share", "PUMA coverage (weighted)"],
    ["summary.county_fips_nonempty_weighted_share", "County coverage (weighted)"],
    [
      "summary.congressional_district_geoid_nonempty_weighted_share",
      "District coverage (weighted)",
    ],
    ["summary.ladder_pumas", "PUMAs in the ladder"],
    ["summary.sampling_basis", "Sampling basis"],
  ],
  "assign_us_puma_ladder.boundary": [
    ["mass.policy", "Weight mass policy"],
    ["mass.before", "Person weight mass before"],
    ["mass.after", "Person weight mass after"],
  ],
  "assign_us_puma_ladder.gate": [],
};

/** Source-file digests a receipt pins directly. These are checked against the
 * publisher's build evidence before the projection is accepted. */
const SOURCE_PINS = {
  "assign_us_puma_ladder.lookup": [
    ["crosswalk_sha256", "congressional_district_vintage_crosswalk", "Congressional district vintage crosswalk"],
    ["ladder_sha256", "puma_ladder", "PUMA ladder"],
  ],
};

function fail(message) {
  console.error(`build-receipt-projection: ${message}`);
  process.exit(1);
}

function args() {
  const parsed = {};
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index].startsWith("--") || argv[index + 1] === undefined)
      fail(`expected --name value pairs, saw ${argv[index]}`);
    parsed[argv[index].slice(2)] = argv[index + 1];
  }
  for (const key of ["quality-dir", "evidence-dir", "candidate", "manifest-sha256", "out"])
    if (!parsed[key]) fail(`--${key} is required`);
  return parsed;
}

async function readVerified(file, expected) {
  const bytes = await readFile(file);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (expected && actual !== expected)
    fail(`${file} hashes to ${actual}, expected ${expected}`);
  return { text: bytes.toString("utf8"), sha256: actual };
}

function at(value, dotted) {
  return dotted
    .split(".")
    .reduce((current, key) => (current == null ? undefined : current[key]), value);
}

function group(id) {
  return id.split(".")[0];
}

/** Seeds are 64-bit and exceed the range JSON numbers survive exactly, so every
 * integer literal too long for IEEE-754 is quoted before parsing and carried as
 * the text the manifest recorded. Shorter integers — counts, versions, district
 * totals — are untouched and stay numbers. */
function parseManifest(text) {
  return JSON.parse(text.replace(/:\s*(-?\d{16,})(?=\s*[,}\]])/g, ': "$1"'));
}

function seedText(raw) {
  return raw === undefined || raw === null ? null : String(raw);
}

function typedArtifact(name, entry, withProducer) {
  return {
    name,
    artifact: entry.artifact ?? name,
    type: at(entry, "type.name") ?? null,
    type_version: at(entry, "type.schema_version") ?? null,
    artifact_key: entry.key ?? null,
    numeric: at(entry, "numerics.numeric") ?? null,
    tolerance: at(entry, "numerics.tolerance") ?? null,
    ...(withProducer
      ? { producer: entry.producer ?? null, producer_key: entry.producer_key ?? null }
      : {}),
  };
}

/** The executor records an unreached or gate-exception node under
 * `receipt.execution`, keyed by its own schema. A receipt without that exact
 * schema carries no executor claim, so nothing is inferred from it. */
function executionRecord(receipt) {
  const execution = receipt.execution;
  if (!execution || execution.schema !== EXECUTION_SCHEMA) return null;
  const blockers = execution.blocked_by ?? {};
  return {
    state: typeof execution.state === "string" ? execution.state : null,
    blocked_by: Object.entries(blockers).map(([node, key]) => ({ node, key })),
    unavailable_artifacts: Array.isArray(execution.unavailable_artifacts)
      ? execution.unavailable_artifacts.map(String)
      : [],
  };
}

function projectNode(id, node, failedIds) {
  const receipt = node.receipt ?? {};
  const capabilities = node.capabilities ?? {};
  const execution = executionRecord(receipt);
  const counts = {};
  for (const artifact of node.artifacts ?? [])
    counts[artifact.entity] = (counts[artifact.entity] ?? 0) + 1;

  const measures = [];
  for (const [dotted, label] of MEASURES[id] ?? []) {
    const value = at(receipt, dotted);
    if (value === undefined || value === null) continue;
    if (typeof value === "object") continue;
    measures.push({ key: dotted, label, value });
  }

  const pins = [];
  for (const [field, evidenceKey, label] of SOURCE_PINS[id] ?? []) {
    const value = receipt[field];
    if (typeof value === "string") pins.push({ key: evidenceKey, label, sha256: value });
  }

  // A gate record belongs to a gate-role receipt. `receipt.outcome` also
  // appears on an unreached node of any role, so the role is what decides.
  let gate = null;
  if (capabilities.role === "gate") {
    const gates = at(receipt, "evidence.gates") ?? {};
    const outcome = receipt.outcome ?? null;
    if (outcome !== null && !GATE_OUTCOMES.includes(outcome))
      fail(`${id} records gate outcome ${outcome}, which is not a declared outcome`);
    gate = {
      outcome,
      scope: receipt.scope ?? null,
      passed: at(receipt, "evidence.passed") ?? null,
      checks: Object.entries(gates).map(([name, value]) => ({
        name,
        passed: value?.passed ?? null,
        failures: Array.isArray(value?.failures) ? value.failures.map(String) : [],
        details: Object.entries(value?.details ?? {})
          .filter(([, detail]) => typeof detail !== "object")
          .map(([key, detail]) => ({ key, value: detail })),
      })),
    };
  }

  const inputs = Object.entries(at(node, "typed_artifacts.inputs") ?? {}).map(
    ([name, entry]) => typedArtifact(name, entry, true),
  );
  const outputs = Object.entries(at(node, "typed_artifacts.outputs") ?? {}).map(
    ([name, entry]) => typedArtifact(name, entry, false),
  );

  return {
    id,
    label: NODE_LABELS[id] ?? id,
    group: group(id),
    group_label: GROUP_LABELS[group(id)] ?? group(id),
    role: capabilities.role ?? null,
    receipt_present: true,
    // `known_failures` is the manifest's own derivation and an umbrella: it
    // collects every gate whose outcome is not certifying, `unreached` among
    // them, as well as nodes the run rejected. It is carried through as-is and
    // is deliberately not the last word — `blocked` below is the executor's own
    // narrower record of the same node, and the adapter reads that one first so
    // a step the run never reached is not reported as one that failed.
    failed: failedIds.includes(id) || receipt.rejected === true,
    blocked: execution?.state === "unreached",
    gate_exception: execution?.state === "gate_exception",
    execution_record: execution,
    receipt_outcome: capabilities.role === "gate" ? null : (receipt.outcome ?? null),
    cache: node.hit === true ? "hit" : "computed",
    node_key: node.key ?? null,
    kernel_ref: node.kernel_ref ?? null,
    kernel_impl_hash: node.kernel_impl_hash ?? null,
    determinism: capabilities.determinism ?? null,
    numeric: capabilities.numeric ?? null,
    tolerance: capabilities.tolerance ?? null,
    runtime_dependencies: Array.isArray(capabilities.dependencies)
      ? capabilities.dependencies.map(String)
      : [],
    seed: seedText(node.seed),
    wall_time_seconds:
      typeof node.wall_time === "number" ? Number(node.wall_time.toFixed(4)) : null,
    frame_key: node.frame_key ?? null,
    weight_key: node.weight_key ?? null,
    phase: receipt.phase ?? null,
    typed_inputs: inputs,
    typed_outputs: outputs,
    opaque_artifact_keys: Object.entries(node.opaque_artifacts ?? {}).map(
      ([name, key]) => ({ name, key }),
    ),
    column_artifact_counts: Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([entity, count]) => ({ entity, count })),
    column_artifact_total: (node.artifacts ?? []).length,
    gate,
    source_pins: pins,
    measures,
  };
}

async function main() {
  const options = args();
  const qualityDirectory = path.resolve(options["quality-dir"]);
  const evidenceDirectory = path.resolve(options["evidence-dir"]);
  const manifestSha256 = options["manifest-sha256"];

  const candidate = JSON.parse(
    (
      await readVerified(
        path.join(qualityDirectory, "manifests", `${manifestSha256}.json`),
        manifestSha256,
      )
    ).text,
  );
  if (candidate.schema_version !== "microcosm.candidate_quality.v1")
    fail("candidate manifest schema is not microcosm.candidate_quality.v1");
  if (candidate.candidate_release_id !== options.candidate)
    fail("candidate manifest names a different candidate");
  const buildAttachment = candidate.attachments?.build_manifest;
  if (!buildAttachment || buildAttachment.status !== "available")
    fail("candidate manifest publishes no available build_manifest attachment");
  if (buildAttachment.scope !== "run")
    fail("build_manifest attachment must be run-scoped");

  const buildEvidenceFile = path.join(qualityDirectory, buildAttachment.path);
  const buildEvidence = JSON.parse(
    (await readVerified(buildEvidenceFile, buildAttachment.sha256)).text,
  );
  if (buildEvidence.candidate_release_id !== candidate.candidate_release_id)
    fail("build evidence names a different candidate");
  if (buildEvidence.run_id !== candidate.run_id)
    fail("build evidence names a different run");

  const implementation = candidate.provenance?.source_implementation_sha256;
  if (!implementation) fail("candidate manifest declares no source implementation hash");
  const population = candidate.population?.sha256;
  if (!population) fail("candidate manifest declares no population digest");

  const executions = [];
  let contentKey = null;
  for (const execution of EXECUTIONS) {
    const source = await readVerified(path.join(evidenceDirectory, execution.file));
    const manifest = parseManifest(source.text);
    const check = buildEvidence.checks?.[execution.evidenceKey];
    if (!check) fail(`build evidence records no ${execution.evidenceKey} check`);
    if (check.manifest_sha256 !== manifest.key)
      fail(`${execution.mode} content key disagrees with the build evidence`);
    if (check.implementation_sha256 !== implementation)
      fail(`${execution.mode} implementation hash disagrees with the candidate manifest`);
    if (check.population_sha256 !== population)
      fail(`${execution.mode} population digest disagrees with the candidate manifest`);
    if (contentKey && contentKey !== manifest.key)
      fail("the two executions do not share one computation content key");
    contentKey = manifest.key;

    // `known_failures` is derived by the manifest itself from gate outcomes and
    // explicit rejections, and re-derived when it is loaded, so it is taken as
    // recorded rather than recomputed here.
    const failedIds = (manifest.known_failures ?? []).map(String);

    const nodes = Object.entries(manifest.nodes ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, node]) => projectNode(id, node, failedIds));
    if (!nodes.length) fail(`${execution.mode} manifest records no node receipts`);

    const computed = nodes.filter((node) => node.cache === "computed").length;
    if (check.kernel_calls !== undefined && check.kernel_calls !== computed)
      fail(
        `${execution.mode} records ${computed} computed receipts but the build evidence reports ${check.kernel_calls} kernel calls`,
      );
    for (const node of nodes) {
      for (const pin of node.source_pins) {
        const published = check.source_sha256?.[pin.key];
        if (published && published !== pin.sha256)
          fail(`${execution.mode} ${pin.key} pin disagrees with the build evidence`);
      }
      if (node.kernel_impl_hash && node.kernel_impl_hash !== implementation)
        fail(`${execution.mode} ${node.id} was produced by a different implementation`);
    }

    executions.push({
      mode: execution.mode,
      evidence_key: execution.evidenceKey,
      label: execution.label,
      description: execution.description,
      manifest_sha256: source.sha256,
      manifest_schema_version: manifest.schema_version ?? null,
      content_key: manifest.key,
      kernel_calls: check.kernel_calls ?? null,
      computed_count: computed,
      cache_hit_count: nodes.length - computed,
      failed_node_ids: failedIds.filter(Boolean),
      blocked_node_ids: nodes.filter((node) => node.blocked).map((node) => node.id),
      gate_exception_node_ids: nodes
        .filter((node) => node.gate_exception)
        .map((node) => node.id),
      release_tier: manifest.tier ?? null,
      decision_count: (manifest.decisions ?? []).length,
      nodes,
    });
  }

  const projection = {
    schema_version: PROJECTION_SCHEMA,
    projection_version: PROJECTION_VERSION,
    generated_by: "frontend/scripts/build-receipt-projection.mjs",
    is_publisher_attachment: false,
    provenance_note:
      "A local reduction of the producer's preserved graph run manifests. Not a publisher attachment: the dashboard re-verifies its association with the immutable candidate manifest and the published build evidence on every request.",
    label_basis:
      "Stage names are plain renderings of the native node ids, which are shown alongside them. Groups are taken from the text before the first dot in each id.",
    coverage: {
      basis: "run_manifest_typed_artifacts",
      complete: false,
      reason:
        "The preserved run manifests record typed artifact inputs and outputs receipt by receipt, not the compiled structural declaration of the graph. Column-level data flow, population-version and base relationships, source edges, the canonical order and column ownership are all part of the compiled graph and none of them are serialized into a run manifest. A receipt that declares no typed artifact therefore cannot be connected to any other, so this is a partial view of the run.",
    },
    source_field_allowlist: SOURCE_FIELD_ALLOWLIST,
    country: candidate.country,
    candidate_release_id: candidate.candidate_release_id,
    candidate_manifest_sha256: manifestSha256,
    run_id: candidate.run_id,
    population_sha256: population,
    build_evidence_sha256: buildAttachment.sha256,
    kernel_impl_hash: implementation,
    computation_content_key: contentKey,
    content_key_note:
      "One content key identifies the computation and its outputs. It is taken over the node payloads with the run-level fields removed \u2014 whether each node was a cache hit, and how long it took \u2014 so two executions of the same computation share it and it does not identify an execution. The executions below are told apart by the byte digest of each recorded run manifest.",
    executions,
  };

  const serialized = `${JSON.stringify(projection, null, 2)}\n`;
  for (const forbidden of [".local", "/Users/", ".h5", "MacBook"]) {
    if (serialized.includes(forbidden))
      fail(`projection would leak ${forbidden}`);
  }
  const out = path.resolve(options.out);
  await writeFile(out, serialized, "utf8");
  console.log(
    `${out}\n  sha256 ${createHash("sha256").update(serialized).digest("hex")}\n  executions ${executions
      .map((entry) => `${entry.mode}=${entry.manifest_sha256.slice(0, 12)}`)
      .join(" ")}`,
  );
}

await main();
