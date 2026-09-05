// Authenticate publisher aggregate graph receipts and normalize into the existing
// ProjectionExecution/Node path. No raw manifests, source files or array values
// are read here. Shape validation is closed before any publisher text is drawn.
import { createHash } from "node:crypto";
import { CandidateQualityReader } from "../quality/artifact";
import type { CandidateQualityManifest } from "../quality/types";
import {
  ReceiptGraphUnavailableError,
  cacheState,
  verifyExecutionStates,
  type ProjectionExecution,
  type ReceiptProjection,
} from "./adapter";
import type { BindingCheck, ImplementationSet } from "./types";
export const MAX_GRAPH_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const GRAPH_RECEIPTS_SCHEMA = "microcosm.graph_receipts.v1";
const BUILD_SCHEMA = "microcosm.graph_build_summary.v1";
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,159}$/;
const REF = /^[A-Za-z0-9_][A-Za-z0-9_.:@-]{0,159}$/;
const PROVENANCE = [
  "run_head",
  "run_receipt_sha256",
  "runner_sha256",
  "roster_sha256",
  "approval_sha256",
  "exporter_sha256",
  "operator_declaration_sha256",
  "runtime_identity_sha256"
] as const;
type RecordValue = Record<string, any>;
type Check = (value: any) => void;
const refuse = (): never => {
  throw new ReceiptGraphUnavailableError("The selected candidate's graph attachment has malformed or inconsistent aggregate evidence.");
};

const assert = (condition: unknown): void => {
  if (!condition)
    refuse();
};

const object = (value: unknown): RecordValue => {
  assert(value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
  return value as RecordValue;
};

const text = (value: unknown, max = 160): void => {
  assert(typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f/\\]/.test(value) && ![
    ".local",
    ".h5",
    "MacBook",
    "person_id",
    "household_id",
    "_buildo-runtime"
  ].some(s => value.includes(s)));
};

const id: Check = value => {
  text(value);
  assert(ID.test(value));
};

const digest: Check = value => {
  assert(typeof value === "string" && HEX.test(value));
};

const bool: Check = value => {
  assert(typeof value === "boolean");
};

const count: Check = value => {
  assert(Number.isSafeInteger(value) && value >= 0);
};

const number: Check = value => {
  assert(typeof value === "number" && Number.isFinite(value) && value >= 0);
};

const scalar: Check = value => {
  if (typeof value === "string")
    text(value);
  else
    assert(typeof value === "boolean" || typeof value === "number" && Number.isFinite(value));
};

const nullable = (check: Check): Check => value => {
  if (value !== null)
    check(value);
};

const reason: Check = value => text(value, 2048);
const enumeration = (...values: unknown[]): Check => value => assert(values.includes(value));
const list = (check: Check, max = 64, min = 0): Check => value => {
  assert(Array.isArray(value) && value.length >= min && value.length <= max);
  value.forEach(check);
};

function shape(value: unknown, fields: Record<string, Check>): RecordValue {
  const o = object(value);
  assert(Object.keys(o).length === Object.keys(fields).length && Object.keys(o).every(k => Object.hasOwn(fields, k)));
  for (const [key, check] of Object.entries(fields))
    check(o[key]);
  return o;
}

const unique = (values: unknown[]) => assert(new Set(values).size === values.length);
/** Typed inputs name a producer recorded in the same execution, so what they
 * declare is a directed graph. The exporter emits its nodes in a strict
 * topological order, but nothing in the wire contract required one, and a
 * cycle was accepted and drawn. The shared renderer is cycle-safe and does not
 * hang; it just picks an arbitrary order for a dependency claim no execution
 * can have produced, so the attachment is refused instead of drawn.
 *
 * The union across executions is checked, because the canvas unions their
 * edges into one graph. Nodes with no typed inputs, nodes nothing consumes and
 * disconnected nodes are all acyclic and unaffected, as are failed, unreached
 * and receipt-absent nodes; none of those readings implies an edge. */
function assertAcyclic(dependencies: Map<string, Set<string>>): void {
  const remaining = new Map([...dependencies].map(([node, producers]) => [node, new Set(producers)]));
  for (let settled = true; settled;) {
    settled = false;
    for (const [node, producers] of remaining)
      if (producers.size === 0) {
        remaining.delete(node);
        for (const rest of remaining.values())
          rest.delete(node);
        settled = true;
      }
  }
  assert(remaining.size === 0);
}
const equal = (a: unknown, b: unknown) => assert(a === b);
const sourceMap: Check = value => {
  const o = object(value);
  assert(Object.keys(o).length <= 64);
  for (const [key, v] of Object.entries(o)) {
    id(key);
    digest(v);
  }
};

function canonical(value: any): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return JSON.stringify(value.map(entry => JSON.parse(canonical(entry))));
  return JSON.stringify(Object.fromEntries(
    Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))]),
  ));
}
function boundedArtifact(value: unknown) {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  }
  catch {
    refuse();
  }
  assert(Buffer.byteLength(encoded!, "utf8") <= MAX_GRAPH_ATTACHMENT_BYTES);
  function walk(v: unknown, depth: number) {
    assert(depth <= 16);
    if (v && typeof v === "object") {
      for (const [key, child] of Object.entries(v)) {
        assert(key !== "candidate_manifest_sha256");
        walk(child, depth + 1);
      }
    }
  }
  walk(value, 0);
}

/** Keep the existing reader's exact-byte hash and identity verification, with
 * a narrower transport bound for these two aggregate graph attachments. */
export function boundedGraphReader(
  country: CandidateQualityManifest["country"],
  readBytes: (relativePath: string) => Promise<Uint8Array>,
): CandidateQualityReader {
  return new CandidateQualityReader({
    country,
    readBytes: async (relativePath) => {
      const bytes = await readBytes(relativePath);
      assert(bytes.byteLength <= MAX_GRAPH_ATTACHMENT_BYTES);
      return bytes;
    }
  });
}

export function safePublisherReason(value: unknown): string {
  reason(value);
  return value as string;
}

/** Validate all manifest strings the shared response can carry, before reading
 * attachments whose unavailable reasons might otherwise bypass this boundary. */
export function verifyGraphManifestPresentation(manifest: CandidateQualityManifest): void {
  safePublisherReason(manifest.release_eligibility.reason);
  assert(Object.keys(manifest.attachments).length <= 64);
  for (const attachment of Object.values(manifest.attachments))
    if (attachment.reason !== undefined)
      safePublisherReason(attachment.reason);
  if (manifest.geography) {
    list(id)(manifest.geography.levels);
    if (manifest.geography.vintage !== undefined)
      text(manifest.geography.vintage);
  }
}

export function implementationSetDigest(value: unknown): string {
  const byNode = object(value), ids = Object.keys(byNode).sort();
  assert(ids.length > 0 && ids.length <= 64);
  for (const key of ids) {
    id(key);
    shape(byNode[key], {
      kernel_ref: v => {
        text(v);
        assert(REF.test(v));
      },
      kernel_impl_hash: digest
    });
  }
  return createHash("sha256").update(ids.map(key => `${key}\t${byNode[key].kernel_impl_hash}\n`).join(""), "ascii").digest("hex");
}

const implementation: Check = value => {
  const o = shape(value, {
    sha256: digest,
    by_node: v => {
      implementationSetDigest(v);
    }
  });
  equal(o.sha256, implementationSetDigest(o.by_node));
};

const pin: Check = value => {
  shape(value, {
    key: id,
    label: text,
    sha256: digest
  });
};

const typedFields = {
  name: id,
  artifact: id,
  type: nullable(id),
  type_version: nullable(v => {
    count(v);
    assert(v > 0);
  }),
  artifact_key: nullable(digest),
  numeric: nullable(id),
  tolerance: nullable(number)
};

const output: Check = value => {
  shape(value, typedFields);
};

const input: Check = value => {
  shape(value, {
    ...typedFields,
    producer: nullable(id),
    producer_key: nullable(digest)
  });
};

const gate: Check = value => {
  const o = shape(value, {
    outcome: nullable(enumeration("pass", "fail", "evidence_absent", "not_applicable", "unreached")),
    scope: nullable(id),
    passed: nullable(bool),
    checks: list(v => {
      const c = shape(v, {
        name: id,
        passed: nullable(bool),
        failures: list(reason),
        details: list(d => {
          shape(d, {
            key: id,
            value: scalar
          });
        })
      });
      unique(c.details.map((d: RecordValue) => d.key));
    })
  });
  unique(o.checks.map((c: RecordValue) => c.name));
  assert(!(o.outcome === "pass" && (o.passed !== true || o.checks.some((c: RecordValue) => c.passed !== true || c.failures.length > 0))));
  assert(!(o.outcome === "fail" && o.passed === true));
  assert(!(["not_applicable", "unreached", "evidence_absent"].includes(o.outcome) && o.passed === true));
};

const node: Check = value => {
  const n = shape(value, {
    id,
    label: text,
    group: id,
    group_label: text,
    role: nullable(id),
    receipt_present: bool,
    failed: bool,
    blocked: bool,
    gate_exception: bool,
    execution_record: nullable(v => {
      shape(v, {
        state: nullable(enumeration("unreached", "gate_exception")),
        blocked_by: list(b => {
          shape(b, {
            node: id,
            key: digest
          });
        }),
        unavailable_artifacts: list(id)
      });
    }),
    receipt_outcome: nullable(id),
    cache: enumeration("hit", "computed"),
    node_key: nullable(digest),
    kernel_ref: nullable(v => {
      text(v);
      assert(REF.test(v));
    }),
    kernel_impl_hash: nullable(digest),
    determinism: nullable(id),
    numeric: nullable(id),
    tolerance: nullable(number),
    runtime_dependencies: list(id),
    seed: nullable(v => {
      assert(typeof v === "string" && v.length <= 32 && /^-?[0-9]+$/.test(v));
    }),
    wall_time_seconds: nullable(number),
    frame_key: nullable(digest),
    weight_key: nullable(digest),
    phase: nullable(id),
    typed_inputs: list(input, 128),
    typed_outputs: list(output, 128),
    opaque_artifact_keys: list(v => {
      shape(v, {
        name: id,
        key: digest
      });
    }, 128),
    column_artifact_counts: list(v => {
      shape(v, {
        entity: id,
        count
      });
    }),
    column_artifact_total: count,
    gate: nullable(gate),
    source_pins: list(pin),
    measures: list(v => {
      shape(v, {
        key: id,
        label: text,
        value: scalar
      });
    })
  });
  for (const [field, key] of [
    ["typed_inputs", "name"],
    ["typed_outputs", "name"],
    ["typed_outputs", "artifact"],
    ["opaque_artifact_keys", "name"],
    ["column_artifact_counts", "entity"],
    ["source_pins", "key"],
    ["measures", "key"]
  ])
    unique(n[field].map((v: RecordValue) => v[key]));
  equal(n.column_artifact_total, n.column_artifact_counts.reduce((sum: number, v: RecordValue) => sum + v.count, 0));
  if (n.receipt_present) {
    digest(n.node_key);
    digest(n.kernel_impl_hash);
    assert(n.kernel_ref !== null);
  }
  if (n.gate !== null || n.gate_exception)
    equal(n.role, "gate");
  for (const output of n.typed_outputs) {
    const opaque = n.opaque_artifact_keys.find((o: RecordValue) => o.name === output.artifact);
    if (opaque)
      equal(opaque.key, output.artifact_key);
  }
};

const executionFields = {
  mode: id,
  label: text,
  description: reason,
  execution_manifest_sha256: digest,
  computation_content_key: digest,
  kernel_calls: count,
  source_preparation_calls: count,
  computed_count: count,
  cache_hit_count: count,
  failed_node_ids: list(id),
  blocked_node_ids: list(id),
  gate_exception_node_ids: list(id),
  nodes: list(node, 64, 1)
};

const provenanceFields = Object.fromEntries(PROVENANCE.map(k => [k, k === "run_head" ? (v: unknown) => assert(typeof v === "string" && /^[a-f0-9]{40}$/.test(v)) : digest]));
const commonFields = {
  country: id,
  candidate_release_id: (v: unknown) => {
    assert(typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,299}$/.test(v));
  },
  run_id: id,
  ...provenanceFields,
  implementation_set: implementation,
  source_sha256: sourceMap
};

const executionCheck: Check = v => {
  shape(v, {
    population_sha256: digest,
    receipt_sha256: digest,
    execution_manifest_sha256: digest,
    computation_content_key: digest,
    kernel_calls: count,
    source_preparation_calls: count,
    direct_checkpoint_table_weight_parity: bool,
    direct_real_engine_array_parity: bool,
    money_33_fields_all_axes_parity: bool
  });
};

/** Both artifacts have already passed the unchanged candidate reader's byte and
 * embedded identity checks. This entry point adds strict shape, per-node and
 * separate execution-byte/content-key binding; all interpretation stays shared. */
export function normalizeGraphAttachment(
  raw: unknown,
  manifest: CandidateQualityManifest,
  manifestSha256: string,
  rawBuild: unknown,
): {
  projection: ReceiptProjection;
  checks: BindingCheck[];
} {
  boundedArtifact(raw);
  boundedArtifact(rawBuild);
  digest(manifestSha256);
  verifyGraphManifestPresentation(manifest);
  const graph = shape(raw, {
    schema_version: enumeration(GRAPH_RECEIPTS_SCHEMA),
    ...commonFields,
    population_sha256: digest,
    period: text,
    entity: id,
    period_basis: id,
    period_reason: reason,
    computation_content_key: digest,
    provenance_note: reason,
    label_basis: reason,
    coverage: v => {
      shape(v, {
        basis: id,
        complete: bool,
        reason
      });
    },
    content_key_note: reason,
    executions: list(v => {
      shape(v, executionFields);
    }, 8, 1)
  });
  const build = shape(rawBuild, {
    schema_version: enumeration(BUILD_SCHEMA),
    ...commonFields,
    graph_receipts_sha256: digest,
    checks: v => {
      object(v);
    }
  });
  const descriptor = manifest.attachments.graph_receipts, buildDescriptor = manifest.attachments.build_manifest;
  assert(descriptor?.status === "available" && descriptor.scope === "population");
  assert(buildDescriptor?.status === "available" && buildDescriptor.scope === "run");
  digest(descriptor.sha256);
  digest(buildDescriptor.sha256);
  equal(build.graph_receipts_sha256, descriptor.sha256);
  for (const key of ["country", "candidate_release_id", "run_id"]) {
    equal(graph[key], manifest[key as keyof CandidateQualityManifest]);
    equal(build[key], graph[key]);
  }
  for (const key of PROVENANCE) {
    equal(graph[key], manifest.provenance[key]);
    equal(build[key], graph[key]);
  }
  assert(!Object.hasOwn(manifest.provenance, "source_implementation_sha256"));
  equal(manifest.provenance.implementation_set_sha256, graph.implementation_set.sha256);
  equal(canonical(build.implementation_set), canonical(graph.implementation_set));
  equal(canonical(build.source_sha256), canonical(graph.source_sha256));
  assert(manifest.population !== null);
  equal(graph.population_sha256, manifest.population!.sha256);
  equal(graph.period, manifest.population!.period);
  equal(graph.entity, manifest.population!.entity);
  equal(manifest.release_eligibility.status, "excluded");
  const executions: ProjectionExecution[] = graph.executions.map((e: RecordValue) => ({
    mode: e.mode,
    label: e.label,
    description: e.description,
    manifest_sha256: e.execution_manifest_sha256,
    content_key: e.computation_content_key,
    kernel_calls: e.kernel_calls,
    source_preparation_calls: e.source_preparation_calls,
    computed_count: e.computed_count,
    cache_hit_count: e.cache_hit_count,
    failed_node_ids: e.failed_node_ids,
    blocked_node_ids: e.blocked_node_ids,
    gate_exception_node_ids: e.gate_exception_node_ids,
    nodes: e.nodes
  }));
  unique(executions.map(e => e.mode));
  unique(executions.map(e => e.manifest_sha256));
  assert(!executions.some(e => e.mode === "direct"));
  equal(canonical(Object.keys(build.checks).sort()), canonical(["direct", ...executions.map(e => e.mode)].sort()));
  const direct = shape(build.checks.direct, {
    population_sha256: digest,
    receipt_sha256: digest,
    household_count: count,
    person_count: count,
    source_preparation_calls: count
  });
  equal(direct.population_sha256, graph.population_sha256);
  const expectedIds = Object.keys(graph.implementation_set.by_node).sort();
  const checks: BindingCheck[] = [
    {
      label: "Candidate manifest",
      detail: "Authenticated by its selected immutable digest."
    },
    {
      label: "Graph attachment",
      detail: "Population-scoped aggregate graph bytes authenticated by the candidate reader; the run-scoped build summary names this attachment digest."
    },
    {
      label: "Implementation set",
      detail: "The canonical ASCII node-id and hash set digest agrees with the manifest. Each node separately agrees with its declared kernel reference and implementation hash."
    },
    {
      label: "Run and exporter identities",
      detail: "Original run head, receipt, runner, roster and approval identities remain distinct from exporter code, operator declaration and runtime identities."
    }
  ];
  let exceptional = false;
  const dependencies = new Map<string, Set<string>>(expectedIds.map(nodeId => [nodeId, new Set<string>()]));
  for (const e of executions) {
    const c = build.checks[e.mode];
    executionCheck(c);
    equal(c.population_sha256, graph.population_sha256);
    equal(c.execution_manifest_sha256, e.manifest_sha256);
    equal(c.computation_content_key, e.content_key);
    equal(e.content_key, graph.computation_content_key);
    assert(e.manifest_sha256 !== e.content_key);
    equal(c.kernel_calls, e.kernel_calls);
    equal(c.source_preparation_calls, e.source_preparation_calls);
    unique(e.nodes.map(n => n.id));
    equal(canonical(e.nodes.map(n => n.id).sort()), canonical(expectedIds));
    verifyExecutionStates(e);
    const computed = e.nodes.filter(n => cacheState(n) === "computed").length, hits = e.nodes.filter(n => cacheState(n) === "hit").length;
    equal(e.computed_count, computed);
    equal(e.cache_hit_count, hits);
    equal(e.kernel_calls, computed);
    const failed = e.nodes.some(n => n.failed || n.blocked || n.gate_exception || !n.receipt_present);
    exceptional ||= failed;
    if (!failed)
      for (const field of ["direct_checkpoint_table_weight_parity", "direct_real_engine_array_parity", "money_33_fields_all_axes_parity"])
        equal(c[field], true);
    const nodes = new Map(e.nodes.map(n => [n.id, n]));
    for (const n of e.nodes) {
      const declared = graph.implementation_set.by_node[n.id];
      equal(n.kernel_ref, declared.kernel_ref);
      equal(n.kernel_impl_hash, declared.kernel_impl_hash);
      for (const p of n.source_pins)
        equal(p.sha256, graph.source_sha256[p.key]);
      for (const a of n.typed_inputs) {
        const producer = a.producer ? nodes.get(a.producer) : undefined;
        assert(producer && producer.id !== n.id && producer.node_key === a.producer_key && a.producer_key !== null);
        const outputs = producer!.typed_outputs.filter(o => o.artifact === a.artifact);
        assert(outputs.length === 1 && a.artifact_key !== null && a.type !== null && a.type_version !== null);
        const o = outputs[0];
        equal(o.artifact_key, a.artifact_key);
        equal(o.type, a.type);
        equal(o.type_version, a.type_version);
        dependencies.get(n.id)!.add(a.producer as string);
      }
    }
    checks.push({
      label: `${e.label} receipts`,
      detail: `${computed} computed and ${hits} served from cache; ${e.source_preparation_calls} source preparation calls are counted separately. Exact execution-manifest byte digest and computation content key agree with the build summary. Source pins agree with the bound aggregate source map.`
    });
  }
  assertAcyclic(dependencies);
  assert(exceptional ? ["completed", "failed"].includes(manifest.execution_status) : manifest.execution_status === "completed");
  return {
    projection: {
      schema_version: GRAPH_RECEIPTS_SCHEMA,
      projection_version: 1,
      is_publisher_attachment: true,
      basis: "authenticated_attachment",
      implementation_set: graph.implementation_set as ImplementationSet,
      provenance_note: graph.provenance_note,
      label_basis: graph.label_basis,
      coverage: graph.coverage,
      country: graph.country,
      candidate_release_id: graph.candidate_release_id,
      candidate_manifest_sha256: manifestSha256,
      run_id: graph.run_id,
      population_sha256: graph.population_sha256,
      build_evidence_sha256: buildDescriptor.sha256!,
      kernel_impl_hash: null,
      computation_content_key: graph.computation_content_key,
      content_key_note: graph.content_key_note,
      executions
    },
    checks
  };
}
