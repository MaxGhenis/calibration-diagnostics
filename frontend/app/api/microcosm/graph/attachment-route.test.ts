// All new candidates below are invented and read from private ephemeral roots.
// No index is written: every request selects the exact candidate digest.
import { afterEach, beforeEach, expect, test, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "./route";
import { inventedGraph, digestOf, h } from "@/lib/microcosm/graph/fixtures/invented-graph";
import * as registry from "@/lib/microcosm/graph/projections";
const keys = ["MICROCOSM_QUALITY_US_DIR", "MICROCOSM_QUALITY_US_BASE_URL"];
let saved: Record<string, string | undefined>, directory: string;
beforeEach(() => {
  saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  keys.forEach(k => delete process.env[k]);
  directory = mkdtempSync(join(tmpdir(), "graph-attachment-test-"));
  process.env.MICROCOSM_QUALITY_US_DIR = directory;
});
afterEach(() => {
  for (const k of keys) {
    if (saved[k] === undefined)
      delete process.env[k];
    else
      process.env[k] = saved[k];
  }
  rmSync(directory, {
    recursive: true,
    force: true
  });
});
function publish(mutate: (x: ReturnType<typeof inventedGraph>) => void = () => {
}) {
  const x = inventedGraph();
  mutate(x);
  mkdirSync(join(directory, "artifacts"), {
    recursive: true
  });
  mkdirSync(join(directory, "manifests"), {
    recursive: true
  });
  const graphSha = digestOf(x.graph);
  x.build.graph_receipts_sha256 = graphSha;
  const buildSha = digestOf(x.build);
  if (x.manifest.attachments.graph_receipts?.status === "available")
    Object.assign(x.manifest.attachments.graph_receipts, {
      sha256: graphSha,
      path: `artifacts/${graphSha}.json`
    });
  if (x.manifest.attachments.build_manifest?.status === "available")
    Object.assign(x.manifest.attachments.build_manifest, {
      sha256: buildSha,
      path: `artifacts/${buildSha}.json`
    });
  for (const [sha, value] of [[graphSha, x.graph], [buildSha, x.build]] as const)
    writeFileSync(join(directory, "artifacts", `${sha}.json`), JSON.stringify(value));
  const manifestSha = digestOf(x.manifest);
  writeFileSync(join(directory, "manifests", `${manifestSha}.json`), JSON.stringify(x.manifest));
  return {
    ...x,
    graphSha,
    manifestSha
  };
}

function ask(x: {
  manifest: {
    candidate_release_id: string;
  };
  manifestSha: string;
}) {
  return GET(new Request(`http://test.invalid/api/microcosm/graph?country=us&candidate=${x.manifest.candidate_release_id}&manifest_sha256=${x.manifestSha}`));
}

test("real quality reader serves invented attachments by immutable URL with no index", async () => {
  const x = publish(), r = await ask(x), p = await r.json();
  expect(r.status).toBe(200);
  expect(p.available).toBe(true);
  expect(p.nodes).toHaveLength(3);
  expect(p.projection.basis).toBe("authenticated_attachment");
  expect(p.binding.candidate_manifest_sha256).toBe(x.manifestSha);
});
for (const status of ["pending", "missing", "failed"] as const)
  test(`present ${status} uses bounded publisher reason and never registry`, async () => {
    const x = publish(x => {
      x.manifest.attachments.graph_receipts = {
        status,
        reason: `Graph evidence ${status}.`
      };
    });
    const spy = spyOn(registry, "receiptProjectionFor");
    try {
      const r = await ask(x), p = await r.json();
      expect(r.status).toBe(200);
      expect(p).toMatchObject({
        available: false,
        reason: `Graph evidence ${status}.`
      });
      expect(spy).not.toHaveBeenCalled();
    }
    finally {
      spy.mockRestore();
    }
  });
for (const mutate of [
  (x: ReturnType<typeof inventedGraph>) => {
    x.graph.schema_version = "microcosm.graph_receipts.v999";
  },
  (x: ReturnType<typeof inventedGraph>) => {
    (x.graph.executions[0].nodes[0] as any).host = "secret-host";
  },
  (x: ReturnType<typeof inventedGraph>) => {
    x.manifest.attachments.graph_receipts = {
      status: "pending",
      reason: "host.local unsafe/path"
    };
  },
  (x: ReturnType<typeof inventedGraph>) => {
    x.manifest.attachments.calibration_diagnostics.reason = "host.local";
  },
  (x: ReturnType<typeof inventedGraph>) => {
    x.manifest.attachments.build_manifest = {
      status: "failed",
      reason: "host.local unsafe/path"
    };
  }
])
  test("malformed present evidence refuses with no registry or publisher text leak", async () => {
    const x = publish(mutate), spy = spyOn(registry, "receiptProjectionFor");
    try {
      const r = await ask(x), p = await r.json();
      expect(r.status).toBe(200);
      expect(p.available).toBe(false);
      expect(JSON.stringify(p)).not.toMatch(/secret-host|host.local|unsafe/);
      expect(spy).not.toHaveBeenCalled();
    }
    finally {
      spy.mockRestore();
    }
  });
test("tampered attachment cannot be served or fall back", async () => {
  const x = publish();
  writeFileSync(join(directory, "artifacts", `${x.graphSha}.json`), "{}");
  const spy = spyOn(registry, "receiptProjectionFor");
  try {
    const p = await (await ask(x)).json();
    expect(p.available).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  }
  finally {
    spy.mockRestore();
  }
});
test("absent attachment consults exact legacy registry only", async () => {
  const x = publish(x => {
    delete x.manifest.attachments.graph_receipts;
  });
  const spy = spyOn(registry, "receiptProjectionFor");
  try {
    const p = await (await ask(x)).json();
    expect(p.available).toBe(false);
    expect(p.reason).toContain("ships no build receipts");
    expect(spy).toHaveBeenCalledWith("us", x.manifest.candidate_release_id, x.manifestSha);
  }
  finally {
    spy.mockRestore();
  }
});
test("well-formed unserved manifest keeps sanitized 503 before registry lookup", async () => {
  const spy = spyOn(registry, "receiptProjectionFor");
  try {
    const r = await ask({
      manifest: {
        candidate_release_id: "unserved-invented"
      },
      manifestSha: h("9")
    }), p = await r.json();
    expect(r.status).toBe(503);
    expect(p.artifact_error).toBe("partial_artifact");
    expect(JSON.stringify(p)).not.toContain(directory);
    expect(JSON.stringify(p)).not.toContain("ENOENT");
    expect(spy).not.toHaveBeenCalled();
  }
  finally {
    spy.mockRestore();
  }
});
test("bounds exact attachment bytes including JSON whitespace before decoding", async () => {
  const x = publish();
  const bytes = JSON.stringify(x.graph) + " ".repeat(4 * 1024 * 1024);
  const { createHash } = await import("node:crypto");
  const sha = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(directory, "artifacts", `${sha}.json`), bytes);
  Object.assign(x.manifest.attachments.graph_receipts, {
    sha256: sha,
    path: `artifacts/${sha}.json`
  });
  x.manifestSha = digestOf(x.manifest);
  writeFileSync(join(directory, "manifests", `${x.manifestSha}.json`), JSON.stringify(x.manifest));
  const r = await ask(x), p = await r.json();
  expect(r.status).toBe(200);
  expect(p.available).toBe(false);
});

// A present graph attachment whose run-scoped build summary is not published is
// an unavailable candidate, not a server condition. Root's frozen head answered
// these with a 503 from the reader's partial_artifact.
for (const status of ["pending", "missing", "failed"] as const)
  test(`present graph receipts with ${status} build summary is unavailable, never 503 or registry`, async () => {
    const x = publish(x => {
      x.manifest.attachments.build_manifest = {
        status,
        reason: `Build summary ${status}.`
      };
    });
    const spy = spyOn(registry, "receiptProjectionFor");
    try {
      const r = await ask(x), p = await r.json();
      expect(r.status).toBe(200);
      expect(p).toMatchObject({
        available: false,
        reason: `Build summary ${status}.`
      });
      expect(p.artifact_error).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    }
    finally {
      spy.mockRestore();
    }
  });
test("present graph receipts with no build summary at all is unavailable, never 503 or registry", async () => {
  const x = publish(x => {
    delete (x.manifest.attachments as Record<string, unknown>).build_manifest;
  });
  const spy = spyOn(registry, "receiptProjectionFor");
  try {
    const r = await ask(x), p = await r.json();
    expect(r.status).toBe(200);
    expect(p.available).toBe(false);
    expect(p.reason).toContain("without the run-scoped build summary");
    expect(p.artifact_error).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  }
  finally {
    spy.mockRestore();
  }
});
test("an available build summary that cannot be read keeps the sanitized 503", async () => {
  const x = publish();
  rmSync(join(directory, "artifacts", `${digestOf(x.build)}.json`));
  const spy = spyOn(registry, "receiptProjectionFor");
  try {
    const r = await ask(x), p = await r.json();
    expect(r.status).toBe(503);
    expect(p.artifact_error).toBe("partial_artifact");
    expect(JSON.stringify(p)).not.toContain(directory);
    expect(JSON.stringify(p)).not.toContain("ENOENT");
    expect(spy).not.toHaveBeenCalled();
  }
  finally {
    spy.mockRestore();
  }
});
