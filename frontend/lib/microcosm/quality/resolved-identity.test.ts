import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "bun:test";

import { SelfComparisonError, loadComparison } from "../latest-artifact";
import { SAME_POPULATION_REASON } from "./identity";
import { GET as compare } from "../../../app/api/microcosm/compare/route";

// Every artifact here is a temporary synthetic fixture and every published
// fetch is stubbed; nothing reaches Hugging Face or a real evidence source.
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const POPULATION_A = "a".repeat(64);
const POPULATION_B = "b".repeat(64);
const DIAGNOSTICS = {
  schema_version: 2,
  weight_entity: "household",
  targets: [
    {
      name: "national_population",
      target: 10,
      initial_estimate: 8,
      final_estimate: 9,
      relative_error: -0.1,
    },
  ],
};

const roots: string[] = [];
const previous = {
  directory: process.env.MICROCOSM_QUALITY_US_DIR,
  url: process.env.MICROCOSM_QUALITY_US_BASE_URL,
};
const realFetch = globalThis.fetch;
afterEach(async () => {
  globalThis.fetch = realFetch;
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
  for (const [key, value] of [
    ["MICROCOSM_QUALITY_US_DIR", previous.directory],
    ["MICROCOSM_QUALITY_US_BASE_URL", previous.url],
  ]) {
    if (value === undefined) delete process.env[key!];
    else process.env[key!] = value;
  }
});

// loadRelease memoizes by country:id:revalidate for at least a second, and
// these tests reuse release ids and candidate ids deliberately, so each test
// takes its own revalidate to keep one test's stubbed release out of the next
// one's loader.
let seed = 100;
const isolated = () => (seed += 1);

async function candidateSource() {
  const root = await mkdtemp(path.join(os.tmpdir(), "quality-resolved-"));
  roots.push(root);
  await mkdir(path.join(root, "manifests"));
  await mkdir(path.join(root, "objects"));
  process.env.MICROCOSM_QUALITY_US_DIR = root;
  delete process.env.MICROCOSM_QUALITY_US_BASE_URL;
  let registered = 0;
  /** Register one immutable manifest and hand back its transport token. */
  return async (
    id: string,
    populationSha256: string,
    createdAt: string,
  ): Promise<string> => {
    const file = `objects/calibration-${(registered += 1)}.json`;
    const diagnostics = JSON.stringify({ ...DIAGNOSTICS, release_id: id });
    await writeFile(path.join(root, file), diagnostics);
    const manifest = JSON.stringify({
      schema_version: "microcosm.candidate_quality.v1",
      country: "us",
      candidate_release_id: id,
      run_id: "fixture-run",
      created_at: createdAt,
      execution_status: "completed",
      release_eligibility: { status: "excluded", reason: "Test fixture only" },
      population: {
        sha256: populationSha256,
        period: "2024",
        entity: "household",
      },
      attachments: {
        calibration_diagnostics: {
          status: "available",
          scope: "population",
          path: file,
          sha256: sha(diagnostics),
          identity: {
            candidate_release_id: id,
            population_sha256: populationSha256,
          },
        },
      },
    });
    const digest = sha(manifest);
    await writeFile(path.join(root, `manifests/${digest}.json`), manifest);
    return `candidate:${id}:${digest}`;
  };
}

/** Serve the named published releases and, optionally, a pointer at one of
 * them. Anything else answers 404 rather than reaching the network. */
function publish(
  releases: string[],
  latest?: string,
  declaredIds: Record<string, string> = {},
): string[] {
  const requested: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("/latest.json"))
      return latest
        ? Response.json({
            release_id: latest,
            updated_at: "2026-09-05T00:00:00Z",
          })
        : new Response("fixture absent", { status: 404 });
    for (const id of releases)
      if (url.includes(`/releases/${id}/calibration_diagnostics.json`))
        return Response.json({ ...DIAGNOSTICS, release_id: declaredIds[id] ?? id });
    return new Response("fixture absent", { status: 404 });
  }) as typeof fetch;
  return requested;
}

test("the Latest pointer and the concrete id it resolves to are one population", async () => {
  const requested = publish(["build-20260905"], "build-20260905");
  // An explicit ?release=latest keeps its own token, so the compare page asks
  // for the published id against "latest" and both sides resolve to one build.
  const rejected = loadComparison("build-20260905", "latest", isolated(), "us");
  await expect(rejected).rejects.toBeInstanceOf(SelfComparisonError);
  await expect(rejected).rejects.toThrow(SAME_POPULATION_REASON);
  expect(requested.every((url) => url.startsWith("https://huggingface.co/"))).toBe(
    true,
  );
});

test("two immutable manifests recording one population do not compare", async () => {
  const register = await candidateSource();
  // An evidence update legitimately changes the manifest digest without
  // changing a population byte, so both tokens stay addressable and distinct.
  const first = await register("rebuilt", POPULATION_A, "2026-09-04T00:00:00Z");
  const second = await register("rebuilt", POPULATION_A, "2026-09-05T00:00:00Z");
  expect(first).not.toBe(second);
  await expect(
    loadComparison(second, first, isolated(), "us"),
  ).rejects.toBeInstanceOf(SelfComparisonError);
});

test("published addresses stay distinct when diagnostics reuse an authored id", async () => {
  publish(["address-a", "address-b"], undefined, {
    "address-a": "declared-build",
    "address-b": "declared-build",
  });
  const comparison = await loadComparison("address-a", "address-b", isolated(), "us");
  expect(comparison.identity.status).toBe("distinct_population");
  expect(comparison.summary.common).toBe(1);
});

test("the resolved pointer matches its address despite a different authored id", async () => {
  publish(["address-current"], "address-current", {
    "address-current": "declared-earlier-build",
  });
  await expect(loadComparison("address-current", "latest", isolated(), "us"))
    .rejects.toBeInstanceOf(SelfComparisonError);
});

test("a reused candidate id over different population bytes still compares", async () => {
  const register = await candidateSource();
  const first = await register("rebuilt", POPULATION_A, "2026-09-04T00:00:00Z");
  const second = await register("rebuilt", POPULATION_B, "2026-09-05T00:00:00Z");
  const comparison = await loadComparison(first, second, isolated(), "us");
  expect(comparison.identity).toEqual({
    status: "distinct_population",
    reason: "",
  });
  // The same id on both sides: the digests, not the id, made this a comparison.
  expect([comparison.a.release_id, comparison.b.release_id]).toEqual([
    "rebuilt",
    "rebuilt",
  ]);
  expect(comparison.summary.common).toBe(1);
});

test("two published releases compare, and a candidate against one is not established to", async () => {
  publish(["build-a", "build-b"]);
  expect(
    (await loadComparison("build-a", "build-b", isolated(), "us")).identity
      .status,
  ).toBe("distinct_population");

  const register = await candidateSource();
  const candidate = await register(
    "unpublished",
    POPULATION_A,
    "2026-09-05T00:00:00Z",
  );
  // A published release publishes no population digest to hold the candidate's
  // against, so the comparison stands and reports that it is unestablished
  // rather than claiming two populations.
  const across = await loadComparison(candidate, "build-a", isolated(), "us");
  expect(across.identity.status).toBe("unverified");
  expect(across.identity.reason).not.toBe("");
  expect(across.summary.common).toBe(1);
});

test("a direct comparison request cannot bypass the resolution", async () => {
  publish(["build-direct"], "build-direct");
  // ?a=<the id the pointer holds> with no b: the route fills b from the
  // pointer, and the two tokens name one build.
  const response = await compare(
    new Request("https://dashboard.test/api/microcosm/compare?a=build-direct"),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ detail: SAME_POPULATION_REASON });
});
