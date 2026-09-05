import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  cp,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "bun:test";
import {
  configuredQualitySource,
  candidateCrossDatasetReader,
  loadCandidate,
} from "./source";
import { loadRelease } from "../latest-artifact";
import { GET } from "../../../app/api/microcosm/quality/route";
import { GET as microcosmGET } from "../../../app/api/microcosm/route";
import { GET as targetTreeGET } from "../../../app/api/microcosm/target-tree/route";
import { GET as targetDiagnosticsGET } from "../../../app/api/microcosm/target-diagnostics/route";

const roots: string[] = [];
const previous = {
  directory: process.env.MICROCOSM_QUALITY_US_DIR,
  url: process.env.MICROCOSM_QUALITY_US_BASE_URL,
  be: process.env.MICROCOSM_QUALITY_BE_DIR,
};
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
  for (const [key, value] of [
    ["MICROCOSM_QUALITY_US_DIR", previous.directory],
    ["MICROCOSM_QUALITY_US_BASE_URL", previous.url],
    ["MICROCOSM_QUALITY_BE_DIR", previous.be],
  ]) {
    if (value === undefined) delete process.env[key!];
    else process.env[key!] = value;
  }
});

async function bundle(country = "us") {
  const root = await mkdtemp(path.join(os.tmpdir(), "quality-contract-"));
  roots.push(root);
  await mkdir(path.join(root, "manifests"));
  await mkdir(path.join(root, "objects"));
  process.env.MICROCOSM_QUALITY_US_DIR = root;
  delete process.env.MICROCOSM_QUALITY_US_BASE_URL;
  const manifest: Record<string, any> = {
    schema_version: "microcosm.candidate_quality.v1",
    country,
    candidate_release_id: "fixture-only",
    run_id: "build-run",
    created_at: "2026-09-05T00:00:00Z",
    execution_status: "completed",
    release_eligibility: { status: "excluded", reason: "Test fixture only" },
    population: { sha256: "a".repeat(64), period: "2024", entity: "household" },
    attachments: {},
  };
  const attach = async (
    name: string,
    data: unknown,
    identity: Record<string, string> = {},
  ) => {
    const text = JSON.stringify(data);
    const filename = `objects/${name}.json`;
    await writeFile(path.join(root, filename), text);
    manifest.attachments[name] = {
      status: "available",
      scope: "population",
      path: filename,
      sha256: sha(text),
      identity: {
        candidate_release_id: "fixture-only",
        population_sha256: "a".repeat(64),
        ...identity,
      },
    };
  };
  const save = async () => {
    const text = JSON.stringify(manifest);
    const digest = sha(text);
    await writeFile(path.join(root, `manifests/${digest}.json`), text);
    return digest;
  };
  return { root, manifest, attach, save };
}

test("candidate calibration uses existing readers without a latest or staging pointer", async () => {
  const f = await bundle();
  await f.attach("calibration_diagnostics", {
    schema_version: 2,
    release_id: "fixture-only",
    weight_entity: "household",
    targets: [
      {
        name: "national_population",
        target: 10,
        final_estimate: 9,
        initial_estimate: 8,
        relative_error: -0.1,
      },
    ],
  });
  const digest = await f.save();
  const calibration = await loadRelease(
    `candidate:fixture-only:${digest}`,
    0,
    "us",
  );
  expect(calibration.source).toBe("candidate_quality");
  expect(calibration.release_id).toBe("fixture-only");
  expect(calibration.rows[0].final_estimate).toBe(9);
  expect(calibration.quality_manifest?.release_eligibility.status).toBe(
    "excluded",
  );
});

test("candidate tree resolves exact geography identities and refuses an ambiguous old label", async () => {
  const f = await bundle();
  await f.attach("calibration_diagnostics", {
    schema_version: 7,
    release_id: "fixture-only",
    dimensions: {
      region: {
        role: "geography",
        label: "Region",
        level: "region",
        values: { north: "Shared", south: "Shared" },
      },
    },
    targets: ["north", "south"].map((id) => ({
      name: `invented.${id}@2024`,
      source: { id: "invented" },
      variable: { id: "population", measure: "count" },
      dimensions: { region: id },
      target: 100,
      initial_estimate: 90,
      final_estimate: 100,
    })),
  });
  const digest = await f.save();
  const url = new URL("http://example.test/api/microcosm/target-tree");
  const release = `candidate:fixture-only:${digest}`;
  url.searchParams.set("release", release);
  url.searchParams.set("breakdown", "geography");
  const overview = await targetTreeGET(new Request(url));
  expect(overview.status).toBe(200);
  const nodes = (await overview.json()).groups[0].nodes;
  expect(nodes).toHaveLength(2);
  for (const node of nodes) {
    url.searchParams.set("path_geography", node.id);
    const selected = await targetTreeGET(new Request(url));
    expect(selected.status).toBe(200);
    const body = await selected.json();
    expect(body.filteredMetrics.nTargets).toBe(1);
    expect(body.path.geography).toBe(node.id);
    expect(body.releaseId).toBe("fixture-only");
  }
  url.searchParams.set("path_geography", "Shared");
  const ambiguous = await targetTreeGET(new Request(url));
  expect(ambiguous.status).toBe(400);
  expect((await ambiguous.json()).detail).toContain(
    "more than one geographic identity",
  );
  expect(url.searchParams.get("release")).toBe(release);
  const candidate = await loadCandidate("us", "fixture-only", digest);
  expect(candidate.manifest.population?.sha256).toBe("a".repeat(64));
  expect(candidate.manifest.release_eligibility.status).toBe("excluded");
});

test("embedded diagnostics from another release are refused even with matching descriptor hash", async () => {
  const f = await bundle();
  await f.attach("calibration_diagnostics", {
    release_id: "different-population",
    targets: [],
  });
  const digest = await f.save();
  await expect(
    loadRelease(`candidate:fixture-only:${digest}`, 0, "us"),
  ).rejects.toMatchObject({ code: "stale_artifact" });
});

test("run and model attachments cannot supply population coverage or calibration metadata", async () => {
  const f = await bundle();
  await f.attach("calibration_diagnostics", {
    release_id: "fixture-only",
    targets: [],
  });
  await f.attach("demographics", {
    geography_coverage: {
      congressional_district: { covered: 999, expected: 999 },
    },
  });
  await f.attach("build_manifest", {
    gates: { target_compilation: { declared_targets: 999 } },
  });
  await f.attach("release_manifest", {
    description: "Unbound model fixture description",
  });
  for (const name of ["demographics", "build_manifest"]) {
    f.manifest.attachments[name].scope = "run";
    f.manifest.attachments[name].identity = {
      candidate_release_id: "fixture-only",
      run_id: "build-run",
    };
  }
  f.manifest.attachments.release_manifest.scope = "model";
  f.manifest.attachments.release_manifest.identity = {
    model_package: "test-model",
    model_version: "test-version",
  };
  const digest = await f.save();
  const cal = await loadRelease(`candidate:fixture-only:${digest}`, 0, "us");
  expect(cal.geography_coverage).toBeNull();
  expect(cal.declared_targets).toBeNull();
  expect(cal.description).toBeNull();
  expect(cal.quality_manifest?.attachments.demographics.scope).toBe("run");
});

test("directory and URL configuration cannot be mixed", async () => {
  await bundle();
  process.env.MICROCOSM_QUALITY_US_BASE_URL = "https://example.test/quality/";
  expect(() => configuredQualitySource("us")).toThrow("Configure one");
});

test("existing cross-dataset bundle retains its independent run and partition integrity", async () => {
  const f = await bundle("be");
  process.env.MICROCOSM_QUALITY_BE_DIR = f.root;
  const source = path.resolve(
    import.meta.dir,
    "../../cross-dataset/fixtures/be-frontend-bundle",
  );
  await cp(source, path.join(f.root, "evaluation"), { recursive: true });
  const original = await readFile(path.join(source, "manifest.json"), "utf8");
  const evaluation = JSON.parse(original);
  f.manifest.attachments.cross_dataset = {
    status: "available",
    scope: "population",
    path: "evaluation/manifest.json",
    sha256: sha(original),
    identity: {
      candidate_release_id: "fixture-only",
      population_sha256: "a".repeat(64),
      run_id: evaluation.run_id,
      snapshot_id: evaluation.snapshot_id,
      source_id: "microcosm_be_v04_euromod",
    },
  };
  const digest = await f.save();
  expect(
    (
      await (
        await candidateCrossDatasetReader("be", "fixture-only", digest)
      ).summary()
    ).run_id,
  ).toBe(evaluation.run_id);
  await writeFile(
    path.join(f.root, "evaluation", evaluation.partitions.summary.path),
    "{}",
  );
  await expect(
    candidateCrossDatasetReader("be", "fixture-only", digest),
  ).rejects.toMatchObject({ code: "hash_mismatch" });
});

test("candidate evaluation never falls back when an attachment is missing", async () => {
  const f = await bundle();
  const digest = await f.save();
  await expect(
    candidateCrossDatasetReader("us", "fixture-only", digest),
  ).rejects.toMatchObject({ code: "partial_artifact" });
});

test("remote immutable evidence loads directly without an index or client source override", async () => {
  const f = await bundle();
  const digest = await f.save();
  const requested: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const relative = new URL(request.url).pathname;
      requested.push(relative);
      return relative === `/quality/manifests/${digest}.json`
        ? new Response(
            await readFile(path.join(f.root, `manifests/${digest}.json`)),
          )
        : new Response("absent", { status: 404 });
    },
  });
  try {
    delete process.env.MICROCOSM_QUALITY_US_DIR;
    process.env.MICROCOSM_QUALITY_US_BASE_URL = `${server.url}quality/`;
    const response = await GET(
      new Request(
        `http://localhost/api/microcosm/quality?country=us&view=manifest&candidate=fixture-only&manifest_sha256=${digest}&base_url=https://untrusted.invalid/&path=../../elsewhere`,
      ),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).candidate_release_id).toBe("fixture-only");
    expect(requested).toEqual([`/quality/manifests/${digest}.json`]);
  } finally {
    await server.stop(true);
  }
});

test("configured remote artifacts cannot redirect out of the evidence root", async () => {
  const f = await bundle();
  const digest = await f.save();
  const requested: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      requested.push(new URL(request.url).pathname);
      return new Response(null, {
        status: 302,
        headers: { Location: "/outside.json" },
      });
    },
  });
  try {
    delete process.env.MICROCOSM_QUALITY_US_DIR;
    process.env.MICROCOSM_QUALITY_US_BASE_URL = `${server.url}quality/`;
    await expect(loadCandidate("us", "fixture-only", digest)).rejects.toThrow();
    expect(requested).toEqual([`/quality/manifests/${digest}.json`]);
  } finally {
    await server.stop(true);
  }
});

test("local symlinks cannot escape the configured evidence root", async () => {
  const f = await bundle();
  const outside = await mkdtemp(path.join(os.tmpdir(), "quality-outside-"));
  roots.push(outside);
  await writeFile(path.join(outside, "other.json"), "{}");
  await symlink(
    path.join(outside, "other.json"),
    path.join(f.root, "objects", "link.json"),
  );
  await expect(
    configuredQualitySource("us").readText("objects/link.json"),
  ).rejects.toMatchObject({ code: "malformed_artifact" });
});

test("quality API refuses a different aggregate period and reports missing evidence explicitly", async () => {
  const f = await bundle();
  await f.attach("support", { period: "2025" });
  const digest = await f.save();
  const response = await GET(
    new Request(
      `http://localhost/api/microcosm/quality?country=us&view=support&candidate=fixture-only&manifest_sha256=${digest}`,
    ),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    artifact_error: "stale_artifact",
  });
  const missing = await GET(
    new Request(
      `http://localhost/api/microcosm/quality?country=us&view=distributions&candidate=fixture-only&manifest_sha256=${digest}`,
    ),
  );
  expect(missing.status).toBe(503);
  expect(await missing.json()).toMatchObject({
    artifact_error: "partial_artifact",
  });
});

test("model reach checks nested model identity before displaying another model version", async () => {
  const f = await bundle();
  await f.attach("validation_reach", {
    source: { version: "different-model" },
    tree: {},
    totals: {},
    anchor_counts: {},
  });
  f.manifest.attachments.validation_reach.scope = "model";
  f.manifest.attachments.validation_reach.identity = {
    model_package: "test-model",
    model_version: "fixture-version",
  };
  const digest = await f.save();
  const response = await GET(
    new Request(
      `http://localhost/api/microcosm/quality?country=us&view=validation_reach&candidate=fixture-only&manifest_sha256=${digest}`,
    ),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    artifact_error: "stale_artifact",
  });
});

test("unexpected read failures stay generic while authored contract messages remain public", async () => {
  const f = await bundle();
  await f.attach("support", {
    schema_version: "microcosm.population_support.v1",
    candidate_release_id: "fixture-only",
    population_sha256: "a".repeat(64),
    period: "2024",
    entity: "household",
    weight_entity: "household",
    weight_basis: "calibrated",
    rows: {},
  });
  const digest = await f.save();
  const ask = (query: string) =>
    GET(
      new Request(`http://localhost/api/microcosm/quality?country=us${query}`),
    );

  // No index.json was ever published, so the underlying failure is an ENOENT
  // naming the configured directory — and every page polls this view.
  const discovery = await (await ask("")).json();
  expect(discovery.available).toBe(false);
  expect(discovery.detail).not.toInclude(f.root);
  expect(discovery.detail).not.toInclude("ENOENT");

  const bound = `&candidate=fixture-only&manifest_sha256=${digest}`;
  expect(await (await ask(`&view=distributions${bound}`)).json()).toMatchObject(
    {
      artifact_error: "partial_artifact",
      detail: "distributions has not been published for this candidate.",
    },
  );
  expect(await (await ask(`&view=support${bound}`)).json()).toMatchObject({
    artifact_error: "malformed_artifact",
    detail: "Aggregate rows must be an array.",
  });
});

test("the digest covers the artifact's exact bytes, identically over both transports", async () => {
  const f = await bundle();
  const clean = await readFile(
    path.join(f.root, `manifests/${await f.save()}.json`),
  );
  // Bytes that a decoder does not round-trip: the two transports used to keep
  // or drop a byte order mark, and to substitute replacement characters for
  // malformed input, so the same stored artifact failed for different reasons
  // depending on where it was read from.
  const cases = [
    {
      bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), clean]),
      message: "Artifact bytes must not begin with a byte order mark.",
    },
    {
      bytes: Buffer.concat([clean, Buffer.from([0xff])]),
      message: "Artifact bytes are not valid UTF-8.",
    },
  ].map((item) => ({
    ...item,
    digest: createHash("sha256").update(item.bytes).digest("hex"),
  }));
  const served = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const item of cases) {
    await writeFile(
      path.join(f.root, `manifests/${item.digest}.json`),
      item.bytes,
    );
    served.set(
      `/quality/manifests/${item.digest}.json`,
      new Uint8Array(item.bytes),
    );
  }

  // The stored bytes hash to the requested digest, so each failure names the
  // encoding rather than reporting a mismatch against intact bytes.
  for (const item of cases) {
    await expect(
      loadCandidate("us", "fixture-only", item.digest),
    ).rejects.toThrow(item.message);
    await expect(
      loadCandidate("us", "fixture-only", item.digest),
    ).rejects.toMatchObject({ code: "malformed_artifact" });
  }

  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const bytes = served.get(new URL(request.url).pathname);
      return bytes
        ? new Response(bytes)
        : new Response("absent", { status: 404 });
    },
  });
  try {
    delete process.env.MICROCOSM_QUALITY_US_DIR;
    process.env.MICROCOSM_QUALITY_US_BASE_URL = `${server.url}quality/`;
    for (const item of cases)
      await expect(
        loadCandidate("us", "fixture-only", item.digest),
      ).rejects.toThrow(item.message);
  } finally {
    await server.stop(true);
  }
});

test("a candidate token cannot report the configured directory through any route", async () => {
  // Every calibration route resolves a candidate token through loadRelease, and
  // most report a raw error message, so the containment has to hold at the
  // evidence reader rather than at one route.
  const f = await bundle();
  const absent = "c".repeat(64);
  const response = await microcosmGET(
    new Request(
      `http://localhost/api/microcosm?country=us&release=candidate:fixture-only:${absent}`,
    ),
  );
  expect(response.status).toBe(502);
  const { detail } = await response.json();
  expect(detail).not.toInclude(f.root);
  expect(detail).not.toInclude("ENOENT");
  expect(detail).toBe(
    `Candidate evidence could not be read: manifests/${absent}.json.`,
  );
});

test("candidate target diagnostics preserves geography identities and immutable release binding", async () => {
  const f = await bundle();
  await f.attach("calibration_diagnostics", {
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
    targets: ["north", "south"].map((id) => ({
      name: `invented.${id}@2024`,
      source: { id: "invented" },
      variable: { id: "population", measure: "count" },
      dimensions: { region: id },
      target: 100,
      initial_estimate: 90,
      final_estimate: 100,
    })),
  });
  const digest = await f.save();
  const token = `candidate:fixture-only:${digest}`;
  const request = async (query: Record<string, string | undefined>) =>
    targetDiagnosticsGET(
      new Request(
        `http://example.test/api/microcosm/target-diagnostics?${new URLSearchParams(Object.entries({ country: "us", release: token, ...query }).filter((entry): entry is [string, string] => entry[1] !== undefined))}`,
      ),
    );
  const response = await request({});
  expect(response.status).toBe(200);
  const overview = await response.json();
  expect(overview.geographies).toHaveLength(2);
  expect(Object.values(overview.geography_labels)).toEqual([
    "Shared (region / south)",
    "Shared (region / north)",
  ]);
  for (const key of overview.geographies) {
    for (const query of [{ geography: key }, { facet: `geography:${key}` }]) {
      const selected = await request(query);
      expect(selected.status).toBe(200);
      const body = await selected.json();
      expect(body.filtered_total).toBe(1);
      expect(body.targets[0].geography_key).toBe(key);
      expect(body.targets[0].geography_dimension_id).toBe("region");
      expect(body.release_id).toBe("fixture-only");
    }
  }
  for (const query of [
    { geography: "Shared", source: "missing" },
    { facet: "geography:Shared", scope: "healthcare" },
  ]) {
    const ambiguous = await request(query);
    expect(ambiguous.status).toBe(400);
    expect((await ambiguous.json()).detail).toContain(
      "more than one geographic identity",
    );
  }
  expect(
    (await (await request({ geography: "unknown" })).json()).filtered_total,
  ).toBe(0);
  expect(
    (await request({ release: `candidate:fixture-only:${"b".repeat(64)}` }))
      .status,
  ).not.toBe(200);
  const unchanged = await loadCandidate("us", "fixture-only", digest);
  expect(unchanged.manifest.population?.sha256).toBe("a".repeat(64));
  expect(unchanged.manifest.release_eligibility.status).toBe("excluded");
});

test("actual candidate target route refuses embedded identity conflicts before showing targets", async () => {
  for (const [field, value] of [
    ["run_id", "other-run"],
    ["model_version", "2"],
    ["snapshot_id", "other-snapshot"],
    ["country", "uk"],
  ]) {
    const f = await bundle();
    f.manifest.provenance = {
      model_version: "1",
      chronicle_snapshot_id: "calibration-snapshot",
    };
    await f.attach("calibration_diagnostics", {
      schema_version: 7,
      [field]: value,
      targets: [
        {
          name: "invented.population@2024",
          target: 10,
          initial_estimate: 8,
          final_estimate: 9,
        },
      ],
    });
    const digest = await f.save();
    const response = await targetDiagnosticsGET(
      new Request(
        `http://example.test/api/microcosm/target-diagnostics?country=us&release=candidate:fixture-only:${digest}`,
      ),
    );
    expect(response.status).not.toBe(200);
    expect((await response.json()).detail).toContain(
      "does not match the selected candidate",
    );
  }
});

test("local discovery cannot follow an index symlink", async () => {
  const f = await bundle();
  await writeFile(path.join(f.root, "outside-index.json"), "{}");
  await symlink(
    path.join(f.root, "outside-index.json"),
    path.join(f.root, "index.json"),
  );
  await expect(
    configuredQualitySource("us").reader.index(),
  ).rejects.toMatchObject({ code: "malformed_artifact" });
});

test("local aggregate read refuses a FIFO in a bounded subprocess", async () => {
  if (process.platform === "win32") return;
  const f = await bundle();
  const fifo = path.join(f.root, "aggregate.json");
  expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0);
  const sourceModule = path.join(import.meta.dir, "source.ts");
  const code = `import { configuredQualitySource } from ${JSON.stringify(sourceModule)};
    const timeout = setTimeout(() => process.exit(3), 1000);
    try { await configuredQualitySource("us").readBytes("aggregate.json"); process.exitCode = 1; }
    catch (error) { if (error.code === "malformed_artifact") console.log("refused"); else process.exitCode = 2; }
    clearTimeout(timeout);`;
  const child = Bun.spawn([process.execPath, "-e", code], {
    env: { MICROCOSM_QUALITY_US_DIR: f.root },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await child.exited).toBe(0);
  expect(await new Response(child.stdout).text()).toContain("refused");
});
