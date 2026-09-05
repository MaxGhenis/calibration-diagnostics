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
