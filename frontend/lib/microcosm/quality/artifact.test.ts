import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { CandidateQualityReader, qualityFreshness } from "./artifact";

function fixture(change?: (manifest: Record<string, any>) => void) {
  const payload = JSON.stringify({ release_id: "candidate-26", targets: [] });
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const manifest: Record<string, any> = {
    schema_version: "microcosm.candidate_quality.v1",
    country: "us",
    candidate_release_id: "candidate-26",
    run_id: "run-26",
    created_at: "2026-09-04T12:00:00Z",
    execution_status: "completed",
    release_eligibility: {
      status: "excluded",
      reason: "Historical diagnostic reference.",
    },
    population: { sha256: "a".repeat(64), period: "2024", entity: "household" },
    attachments: {
      calibration_diagnostics: {
        status: "available",
        scope: "population",
        path: "objects/calibration.json",
        sha256: sha(payload),
        identity: {
          candidate_release_id: "candidate-26",
          population_sha256: "a".repeat(64),
        },
      },
      cross_dataset: {
        status: "pending",
        reason: "Independent evaluation has not run.",
      },
    },
  };
  change?.(manifest);
  const text = JSON.stringify(manifest);
  const digest = sha(text);
  const files = new Map<string, string | Uint8Array>([
    [`manifests/${digest}.json`, text],
    ["objects/calibration.json", payload],
  ]);
  const reads: string[] = [];
  const reader = new CandidateQualityReader({
    country: "us",
    readBytes: async (path) => {
      reads.push(path);
      const value = files.get(path);
      if (value === undefined) throw new Error("missing object");
      return typeof value === "string" ? Buffer.from(value, "utf8") : value;
    },
  });
  return { reader, files, reads, digest, manifest };
}

test("direct immutable candidate loads without discovering a mutable index", async () => {
  const f = fixture();
  const manifest = await f.reader.manifest("candidate-26", f.digest);
  expect(manifest.population?.sha256).toBe("a".repeat(64));
  expect(
    await f.reader.attachment(manifest, "calibration_diagnostics"),
  ).toMatchObject({ release_id: "candidate-26" });
  expect(f.reads).not.toContain("index.json");
});

test("changed manifest bytes fail the selected digest", async () => {
  const f = fixture();
  f.files.set(
    `manifests/${f.digest}.json`,
    JSON.stringify({ ...f.manifest, run_id: "other" }),
  );
  await expect(
    f.reader.manifest("candidate-26", f.digest),
  ).rejects.toMatchObject({ code: "hash_mismatch" });
});

test("mixed candidate, country and population identities are refused", async () => {
  for (const mutate of [
    (m: Record<string, any>) => {
      m.country = "uk";
    },
    (m: Record<string, any>) => {
      m.candidate_release_id = "other";
    },
    (m: Record<string, any>) => {
      m.attachments.calibration_diagnostics.identity.population_sha256 =
        "b".repeat(64);
    },
  ]) {
    const f = fixture(mutate);
    await expect(
      f.reader.manifest("candidate-26", f.digest),
    ).rejects.toMatchObject({ code: "stale_artifact" });
  }
});

test("attachment digest and embedded candidate identity fail closed", async () => {
  const f = fixture();
  const manifest = await f.reader.manifest("candidate-26", f.digest);
  f.files.set("objects/calibration.json", "{}");
  await expect(
    f.reader.attachment(manifest, "calibration_diagnostics"),
  ).rejects.toMatchObject({ code: "hash_mismatch" });
});

test("pending and absent evidence stays explicit instead of becoming zero metrics", async () => {
  const f = fixture();
  const manifest = await f.reader.manifest("candidate-26", f.digest);
  expect(manifest.attachments.cross_dataset).toMatchObject({
    status: "pending",
    reason: "Independent evaluation has not run.",
  });
  await expect(
    f.reader.attachment(manifest, "cross_dataset"),
  ).rejects.toMatchObject({ code: "partial_artifact" });
  await expect(f.reader.attachment(manifest, "support")).rejects.toMatchObject({
    code: "partial_artifact",
  });
});

test("artifact paths cannot escape the configured source", async () => {
  for (const path of [
    "../secret.json",
    "/secret.json",
    "https://other.test/secret.json",
    "a/../../secret.json",
    "a/%2e%2e/secret.json",
    "a\\secret.json",
  ]) {
    const f = fixture((m) => {
      m.attachments.calibration_diagnostics.path = path;
    });
    await expect(
      f.reader.manifest("candidate-26", f.digest),
    ).rejects.toMatchObject({ code: "malformed_artifact" });
  }
});

test("an old discovery feed is stale without relabeling a completed candidate as stalled", () => {
  const now = Date.parse("2026-09-04T12:00:00Z");
  expect(qualityFreshness("2026-07-02T12:00:00Z", now)).toBe("stale");
  expect(qualityFreshness("2026-09-04T11:50:00Z", now)).toBe("current");
  expect(qualityFreshness(null, now)).toBe("unknown");
});

test("pre-population failures omit population identity honestly", async () => {
  const f = fixture((m) => {
    m.population = null;
    m.execution_status = "failed";
    m.attachments = {};
  });
  expect(
    (await f.reader.manifest("candidate-26", f.digest)).population,
  ).toBeNull();
  const invalid = fixture((m) => {
    m.population = null;
    m.attachments = {};
  });
  await expect(
    invalid.reader.manifest("candidate-26", invalid.digest),
  ).rejects.toMatchObject({ code: "malformed_artifact" });
});

test("model evidence keeps model scope without claiming a population identity", async () => {
  const f = fixture((m) => {
    m.population = null;
    m.execution_status = "failed";
    m.attachments = {
      validation_reach: {
        status: "available",
        scope: "model",
        path: "objects/coverage.json",
        sha256: "b".repeat(64),
        identity: {
          model_package: "policyengine-us",
          model_version: "1.764.6",
        },
      },
    };
  });
  expect(
    (await f.reader.manifest("candidate-26", f.digest)).attachments
      .validation_reach.scope,
  ).toBe("model");
});

test("pre-population run evidence binds its exact candidate and run", async () => {
  const make = (run: string) =>
    fixture((m) => {
      m.population = null;
      m.execution_status = "failed";
      m.attachments = {
        build_manifest: {
          status: "available",
          scope: "run",
          path: "objects/build.json",
          sha256: "b".repeat(64),
          identity: { candidate_release_id: "candidate-26", run_id: run },
        },
      };
    });
  const valid = make("run-26");
  expect(
    (await valid.reader.manifest("candidate-26", valid.digest)).attachments
      .build_manifest.scope,
  ).toBe("run");
  const invalid = make("other-run");
  await expect(
    invalid.reader.manifest("candidate-26", invalid.digest),
  ).rejects.toMatchObject({ code: "stale_artifact" });
});

test("eligible status cannot be attached to an incomplete population build", async () => {
  const f = fixture((m) => {
    m.execution_status = "running";
    m.release_eligibility = {
      status: "eligible",
      reason: "Invalid early attestation",
    };
  });
  await expect(
    f.reader.manifest("candidate-26", f.digest),
  ).rejects.toMatchObject({ code: "malformed_artifact" });
});

test("statuses must be real strings, so an array cannot smuggle one past its guard", async () => {
  for (const mutate of [
    (m: Record<string, any>) => {
      m.execution_status = ["completed"];
    },
    (m: Record<string, any>) => {
      m.release_eligibility.status = ["excluded"];
    },
    (m: Record<string, any>) => {
      m.attachments.cross_dataset.status = ["pending"];
    },
  ]) {
    const f = fixture(mutate);
    await expect(
      f.reader.manifest("candidate-26", f.digest),
    ).rejects.toMatchObject({ code: "malformed_artifact" });
  }
  // String(["eligible"]) is "eligible", but the completed-build guard compares
  // strictly, so a coerced status would have been published as eligible on a
  // running build with the guard silently skipped.
  const smuggled = fixture((m: Record<string, any>) => {
    m.execution_status = "running";
    m.release_eligibility = {
      status: ["eligible"],
      reason: "Attestation that is not a status.",
    };
  });
  await expect(
    smuggled.reader.manifest("candidate-26", smuggled.digest),
  ).rejects.toMatchObject({ code: "malformed_artifact" });
});

function payloadFixture(
  payload: string,
  change?: (manifest: Record<string, any>) => void,
) {
  const f = fixture(change);
  f.files.set("objects/calibration.json", payload);
  f.manifest.attachments.calibration_diagnostics.sha256 = createHash("sha256")
    .update(payload)
    .digest("hex");
  const text = JSON.stringify(f.manifest);
  f.digest = createHash("sha256").update(text).digest("hex");
  f.files.set(`manifests/${f.digest}.json`, text);
  return f;
}

test("embedded identity omissions cannot cross run, model, snapshot or country", async () => {
  for (const [key, value] of [
    ["run_id", "another-run"],
    ["model_version", "2"],
    ["snapshot_id", "another-snapshot"],
    ["country", "uk"],
    ["country", { code: "uk", label: "Invented" }],
  ]) {
    const f = payloadFixture(
      JSON.stringify({ [key as string]: value }),
      (m) => {
        m.provenance = {
          model_version: "1",
          chronicle_snapshot_id: "calibration-snapshot",
        };
      },
    );
    const manifest = await f.reader.manifest("candidate-26", f.digest);
    await expect(
      f.reader.attachment(manifest, "calibration_diagnostics"),
    ).rejects.toMatchObject({ code: "stale_artifact" });
  }
});

test("matching country presentation and optional identities keep original payload fields", async () => {
  const f = payloadFixture(
    '{"country":{"code":"us","label":"Invented"},"targets":[]}',
  );
  const manifest = await f.reader.manifest("candidate-26", f.digest);
  expect(
    await f.reader.attachment(manifest, "calibration_diagnostics"),
  ).toEqual({ country: { code: "us", label: "Invented" }, targets: [] });
});

test("nested overflow numbers refuse instead of entering quality evidence", async () => {
  for (const raw of [
    '{"x":1e400}',
    '{"x":[{"value":-1e400}]}',
    `{"x":${"9".repeat(400)}}`,
  ]) {
    const f = payloadFixture(raw);
    const manifest = await f.reader.manifest("candidate-26", f.digest);
    await expect(
      f.reader.attachment(manifest, "calibration_diagnostics"),
    ).rejects.toMatchObject({ code: "malformed_artifact" });
  }
});

test("timestamp grammar has a timezone and a real calendar date", async () => {
  for (const value of [
    "2026-09-05 00:00:00+00:00",
    "2026-09-05T00:00:00",
    "2026-02-30T00:00:00Z",
    "0000-01-01T00:00:00Z",
    "2026-09-05T00:00:00+01:99",
    "2026-09-05T00:00:00+24:00",
  ]) {
    const f = fixture((m) => {
      m.created_at = value;
    });
    await expect(
      f.reader.manifest("candidate-26", f.digest),
    ).rejects.toMatchObject({ code: "malformed_artifact" });
  }
  const f = fixture((m) => {
    m.created_at = "2024-02-29T12:00:00.123+05:30";
  });
  expect((await f.reader.manifest("candidate-26", f.digest)).created_at).toBe(
    "2024-02-29T12:00:00.123+05:30",
  );
});

test("run and model payloads cannot claim population scope", async () => {
  for (const scope of ["run", "model"]) {
    const f = payloadFixture(
      '{"population_sha256":"' + "a".repeat(64) + '"}',
      (m) => {
        const entry = m.attachments.calibration_diagnostics;
        entry.scope = scope;
        entry.identity =
          scope === "run"
            ? { candidate_release_id: "candidate-26", run_id: "run-26" }
            : { model_package: "invented-model", model_version: "1" };
      },
    );
    const manifest = await f.reader.manifest("candidate-26", f.digest);
    await expect(
      f.reader.attachment(manifest, "calibration_diagnostics"),
    ).rejects.toMatchObject({ code: "stale_artifact" });
  }
});

test("model inspection and cross-dataset evaluation keep independent runs", async () => {
  for (const scope of ["model", "population"]) {
    const f = payloadFixture(
      '{"run_id":"evaluation-run","snapshot_id":"evaluation-snapshot"}',
      (m) => {
        m.provenance = { chronicle_snapshot_id: "calibration-snapshot" };
        const entry = m.attachments.calibration_diagnostics;
        entry.scope = scope;
        entry.identity =
          scope === "model"
            ? {
                model_package: "invented-model",
                model_version: "1",
                run_id: "evaluation-run",
                snapshot_id: "evaluation-snapshot",
              }
            : {
                ...entry.identity,
                run_id: "evaluation-run",
                snapshot_id: "evaluation-snapshot",
              };
        if (scope === "population") m.attachments.cross_dataset = entry;
      },
    );
    // Only cross_dataset gets the evaluation exception for population scope.
    if (scope === "population") {
      delete f.manifest.attachments.calibration_diagnostics;
      const text = JSON.stringify(f.manifest);
      f.digest = createHash("sha256").update(text).digest("hex");
      f.files.set(`manifests/${f.digest}.json`, text);
    }
    const manifest = await f.reader.manifest("candidate-26", f.digest);
    expect(
      await f.reader.attachment(
        manifest,
        scope === "model" ? "calibration_diagnostics" : "cross_dataset",
      ),
    ).toMatchObject({
      run_id: "evaluation-run",
      snapshot_id: "evaluation-snapshot",
    });
  }
});

test("evaluation snapshot alias cannot contradict its descriptor", async () => {
  const f = fixture((m) => {
    m.attachments.cross_dataset = {
      ...m.attachments.calibration_diagnostics,
      identity: {
        ...m.attachments.calibration_diagnostics.identity,
        run_id: "evaluation-run",
        snapshot_id: "evaluation-snapshot",
        chronicle_snapshot_id: "another-evaluation",
      },
    };
  });
  await expect(
    f.reader.manifest("candidate-26", f.digest),
  ).rejects.toMatchObject({ code: "stale_artifact" });
});

test("model descriptor cannot claim candidate aliases", async () => {
  for (const field of [
    "candidate_release_id",
    "release_id",
    "population_sha256",
  ]) {
    const f = fixture((m) => {
      m.attachments.calibration_diagnostics.scope = "model";
      m.attachments.calibration_diagnostics.identity = {
        model_package: "invented-model",
        model_version: "1",
        [field]: "another-population",
      };
    });
    await expect(
      f.reader.manifest("candidate-26", f.digest),
    ).rejects.toMatchObject({ code: "malformed_artifact" });
  }
});

test("discovery cannot announce an incomplete run as eligible", async () => {
  const f = fixture();
  f.files.set(
    "index.json",
    JSON.stringify({
      schema_version: "microcosm.candidate_quality_index.v1",
      country: "us",
      updated_at: f.manifest.created_at,
      candidates: [
        {
          candidate_release_id: "candidate-26",
          run_id: "run-26",
          updated_at: f.manifest.created_at,
          execution_status: "running",
          release_eligibility: {
            status: "eligible",
            reason: "Invented inconsistent attestation",
          },
          manifest: { path: `manifests/${f.digest}.json`, sha256: f.digest },
        },
      ],
    }),
  );
  await expect(f.reader.index()).rejects.toMatchObject({
    code: "malformed_artifact",
  });
});
