// The route is exercised against the real quality directory bytes for the
// `us-graph-launch-20260905` build: the immutable candidate manifest, the
// run-scoped build evidence it attaches, and a second real candidate whose
// build failed and for which this dashboard ships no receipts.

import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { GET } from "./route";

const ENV_KEYS = ["MICROCOSM_QUALITY_US_DIR", "MICROCOSM_QUALITY_US_BASE_URL"] as const;
const FIXTURE = fileURLToPath(
  new URL("../../../../lib/microcosm/graph/fixtures/us-graph-launch-quality/", import.meta.url),
);
const TAMPERED = fileURLToPath(
  new URL(
    "../../../../lib/microcosm/graph/fixtures/us-graph-launch-quality-tampered/",
    import.meta.url,
  ),
);
const CANDIDATE = "us-graph-f001-geography-20260905-v1";
const DIGEST = "ff2f231bbe96267bbb230264cece5131314edab449d9cdd03b85aa452535b885";
const FAILED_CANDIDATE = "us-graph-f001-assembly-20260905-v1";
const FAILED_DIGEST =
  "e6b41503383e5662e7b03699f1053a18a96c2aa3b66159dd7de5e2cbec5a0764";

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.MICROCOSM_QUALITY_US_DIR = FIXTURE;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function ask(query: string) {
  return GET(new Request(`http://dashboard.test/api/microcosm/graph?${query}`));
}

const selected = `country=us&candidate=${CANDIDATE}&manifest_sha256=${DIGEST}`;

describe("a candidate this dashboard has receipts for", () => {
  test("answers with the run bound to that exact manifest", async () => {
    const response = await ask(selected);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const payload = await response.json();
    expect(payload.available).toBe(true);
    expect(payload.schema_version).toBe("microcosm.dashboard.receipt_graph.v1");
    expect(payload.candidate).toMatchObject({
      country: "us",
      id: CANDIDATE,
      run_id: CANDIDATE,
      execution_status: "completed",
      release_eligibility: { status: "excluded" },
    });
    expect(payload.binding.candidate_manifest_sha256).toBe(DIGEST);
    expect(payload.binding.build_evidence_sha256).toBe(
      "1d3b94d8720b07cb1be22fe65efd88eba31787742c090b411d28938e40abbf6b",
    );
    expect(payload.nodes).toHaveLength(6);
    expect(payload.edges).toHaveLength(3);
    expect(payload.coverage.complete).toBe(false);
    expect(payload.executions.map((execution: { mode: string }) => execution.mode)).toEqual([
      "cold",
      "replay",
    ]);
  });

  test("sends no host, path, payload byte or individual identifier", async () => {
    const body = await (await ask(selected)).text();
    for (const forbidden of [
      "MacBook",
      ".local",
      "/Users/",
      "_buildo-runtime",
      "fixtures",
      "graph-manifest.json",
      "peak_rss",
      "artifacts/",
      "manifests/",
      "person_id",
      "household_id",
    ])
      expect(body).not.toContain(forbidden);
  });

  test("keeps the run's one gate scoped to what it declared", async () => {
    const payload = await (await ask(selected)).json();
    expect(payload.gates.records).toBe(1);
    expect(payload.gates.note).toContain("geography_assignment_integrity");
    const gated = payload.nodes.find(
      (node: { id: string }) => node.id === "assign_us_puma_ladder.gate",
    );
    expect(
      gated.states.map((state: { mode: string; gate: string }) => [state.mode, state.gate]),
    ).toEqual([
      ["cold", "pass"],
      ["replay", "pass"],
    ]);
  });
});

describe("a candidate this dashboard has no receipts for", () => {
  test("says so rather than showing another candidate's run", async () => {
    const response = await ask(
      `country=us&candidate=${FAILED_CANDIDATE}&manifest_sha256=${FAILED_DIGEST}`,
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.available).toBe(false);
    expect(payload.reason).toMatch(/ships no build receipts/);
    expect(JSON.stringify(payload)).not.toContain(CANDIDATE);
  });

  test("refuses a real candidate id carrying another candidate's digest", async () => {
    const payload = await (
      await ask(`country=us&candidate=${CANDIDATE}&manifest_sha256=${FAILED_DIGEST}`)
    ).json();
    expect(payload.available).toBe(false);
    expect(payload.reason).toMatch(/Manifest identity does not match the selected candidate/);
    expect(JSON.stringify(payload)).not.toContain(FAILED_CANDIDATE);
  });

  test("refuses the shipped digest under another candidate's id", async () => {
    const payload = await (
      await ask(`country=us&candidate=${FAILED_CANDIDATE}&manifest_sha256=${DIGEST}`)
    ).json();
    expect(payload.available).toBe(false);
  });

  test("refuses the candidate under a country that did not publish it", async () => {
    process.env.MICROCOSM_QUALITY_BE_DIR = FIXTURE;
    try {
      const payload = await (await ask(`country=be&candidate=${CANDIDATE}&manifest_sha256=${DIGEST}`)).json();
      expect(payload.available).toBe(false);
    } finally {
      delete process.env.MICROCOSM_QUALITY_BE_DIR;
    }
  });
});

describe("bytes that do not hash to the digest the request asked for", () => {
  test("are refused, and the eligibility they claim is not served", async () => {
    process.env.MICROCOSM_QUALITY_US_DIR = TAMPERED;
    const response = await ask(selected);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.available).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("eligible");
  });
});

describe("what the request is allowed to say", () => {
  test("names an immutable candidate and nothing else", async () => {
    for (const query of [
      "country=us",
      `country=us&candidate=${CANDIDATE}`,
      `country=us&manifest_sha256=${DIGEST}`,
    ]) {
      const response = await ask(query);
      expect(response.status).toBe(400);
      expect((await response.json()).detail).toMatch(/immutable candidate/);
    }
  });

  test("rejects a candidate that is really a path", async () => {
    for (const candidate of [
      "../../../../etc/passwd",
      "..%2F..%2Fmanifests",
      "manifests/ff2f231b",
      "http://elsewhere.test/manifest",
    ]) {
      const response = await ask(
        `country=us&candidate=${encodeURIComponent(candidate)}&manifest_sha256=${DIGEST}`,
      );
      expect(response.status).toBe(400);
      expect((await response.json()).detail).toBe("Invalid immutable candidate selection.");
    }
  });

  test("rejects a digest that is not one", async () => {
    for (const digest of [
      "not-a-digest",
      DIGEST.toUpperCase(),
      `${DIGEST}0`,
      DIGEST.slice(0, 63),
      "../artifacts/1d3b94d8",
    ]) {
      const response = await ask(
        `country=us&candidate=${CANDIDATE}&manifest_sha256=${encodeURIComponent(digest)}`,
      );
      expect(response.status).toBe(400);
    }
  });
});

describe("a country with no configured evidence", () => {
  test("is a service condition, not a claim about the candidate", async () => {
    delete process.env.MICROCOSM_QUALITY_US_DIR;
    const response = await ask(selected);
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.artifact_error).toBe("partial_artifact");
    expect(payload.detail).toMatch(/not configured/);
  });
});
