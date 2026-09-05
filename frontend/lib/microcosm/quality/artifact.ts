import { createHash } from "node:crypto";
import { ArtifactError } from "../../cross-dataset/artifact";
import type { MicrocosmCountry } from "../countries";
import {
  QUALITY_SCHEMA,
  QUALITY_INDEX_SCHEMA,
  type CandidateQualityManifest,
  type CandidateQualityIndex,
  type EvidenceAttachment,
  type EvidenceIdentity,
  type ExecutionStatus,
  type EligibilityStatus,
  type ReleaseEligibility,
} from "./types";

type ObjectValue = Record<string, unknown>;
const executionStatuses: readonly ExecutionStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
];
const eligibilityStatuses: readonly EligibilityStatus[] = [
  "not_evaluated",
  "eligible",
  "ineligible",
  "excluded",
];
const attachmentStatuses: readonly EvidenceAttachment["status"][] = [
  "available",
  "pending",
  "missing",
  "failed",
];

export function object(value: unknown, field = "document"): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ArtifactError(
      "malformed_artifact",
      `${field} must be an object.`,
    );
  return value as ObjectValue;
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new ArtifactError(
      "malformed_artifact",
      `${field} must be a nonempty string.`,
    );
  return value;
}
export function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new ArtifactError(
      "malformed_artifact",
      "Expected a lowercase SHA-256 digest.",
    );
  return value;
}
export function safeArtifactPath(value: unknown): string {
  const path = text(value, "artifact path");
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new ArtifactError(
      "malformed_artifact",
      "Artifact path must remain within its configured root.",
    );
  return path;
}
export function candidateId(value: unknown): string {
  const id = text(value, "candidate_release_id");
  if (id.length > 300 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id))
    throw new ArtifactError(
      "malformed_artifact",
      "Invalid candidate release identifier.",
    );
  return id;
}
function date(value: unknown, field: string): string {
  const result = text(value, field);
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
      result,
    );
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    parts ? parts.slice(1).map((part) => Number(part ?? 0)) : [];
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (
    !parts ||
    year < 1 ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    !Number.isFinite(Date.parse(result))
  )
    throw new ArtifactError(
      "malformed_artifact",
      `${field} must be an ISO timestamp.`,
    );
  return result;
}
// A status is an enumerated string, never whatever an arbitrary value stringifies
// to: `["eligible"]` or `{}` must be refused here rather than flowing on as a
// non-string that fails every later `===` guard and throws in the views.
function enumerated<T extends string>(
  value: unknown,
  allowed: readonly T[],
  message: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw new ArtifactError("malformed_artifact", message);
  return value as T;
}
function execution(value: unknown): ExecutionStatus {
  return enumerated(value, executionStatuses, "Unknown execution_status.");
}
function eligibility(value: unknown): ReleaseEligibility {
  const raw = object(value, "release_eligibility");
  return {
    status: enumerated(
      raw.status,
      eligibilityStatuses,
      "Unknown release eligibility status.",
    ),
    reason: text(raw.reason, "eligibility reason"),
  };
}
function strings(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value === undefined ? {} : object(value)).map(
      ([key, value]) => [key, text(value, key)],
    ),
  );
}
function json(raw: string): ObjectValue {
  try {
    const result = object(JSON.parse(raw));
    const pending: unknown[] = [result];
    while (pending.length) {
      const value = pending.pop();
      if (typeof value === "number" && !Number.isFinite(value))
        throw new ArtifactError(
          "malformed_artifact",
          "Quality JSON numbers must be finite.",
        );
      if (value && typeof value === "object") {
        for (const child of Object.values(value)) pending.push(child);
      }
    }
    return result;
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    throw new ArtifactError(
      "malformed_artifact",
      "Quality artifact is not valid JSON.",
    );
  }
}
function assertSame(actual: unknown, expected: string, description: string) {
  if (actual !== expected)
    throw new ArtifactError(
      "stale_artifact",
      `${description} does not match the selected candidate.`,
    );
}

type BindingContext = Pick<
  CandidateQualityManifest,
  "country" | "candidate_release_id" | "run_id" | "population" | "provenance"
>;

function identityBindings(
  manifest: BindingContext,
  scope: EvidenceAttachment["scope"],
  name: string,
  identity?: EvidenceIdentity,
): Record<string, string> {
  const expected: Record<string, string> =
    scope === "model"
      ? Object.fromEntries(
          Object.entries(manifest.provenance).filter(([key]) =>
            ["model_package", "model_version", "model_commit"].includes(key),
          ),
        )
      : {
          ...manifest.provenance,
          candidate_release_id: manifest.candidate_release_id,
          release_id: manifest.candidate_release_id,
          run_id: manifest.run_id,
        };
  if (scope !== "model" && manifest.provenance.chronicle_snapshot_id)
    expected.snapshot_id = manifest.provenance.chronicle_snapshot_id;
  if (scope === "population" && manifest.population)
    expected.population_sha256 = manifest.population.sha256;
  expected.country = manifest.country;
  if (name === "cross_dataset" && scope === "population") {
    // This evaluation has its own run and snapshot, independent of calibration.
    delete expected.run_id;
    delete expected.snapshot_id;
    delete expected.chronicle_snapshot_id;
    if (identity?.snapshot_id)
      expected.chronicle_snapshot_id = identity.snapshot_id;
  }
  return expected;
}

function validatePayloadIdentity(
  manifest: BindingContext,
  entry: EvidenceAttachment,
  name: string,
  payload: ObjectValue,
): void {
  const forbidden =
    entry.scope === "model"
      ? ["population_sha256", "candidate_release_id", "release_id"]
      : entry.scope === "run"
        ? ["population_sha256"]
        : [];
  if (forbidden.some((key) => Object.hasOwn(payload, key)))
    throw new ArtifactError(
      "stale_artifact",
      "Embedded attachment claims an incompatible scope.",
    );
  const expected: Record<string, string> = {
    ...identityBindings(manifest, entry.scope, name, entry.identity),
    ...entry.identity,
  };
  if (
    name === "cross_dataset" &&
    entry.scope === "population" &&
    entry.identity?.snapshot_id
  )
    expected.chronicle_snapshot_id = entry.identity.snapshot_id;
  for (const [key, value] of Object.entries(expected)) {
    if (!Object.hasOwn(payload, key)) continue;
    let actual = payload[key];
    if (
      key === "country" &&
      actual &&
      typeof actual === "object" &&
      !Array.isArray(actual)
    ) {
      // The existing presentation block uses code; its label is not an identity.
      if (!Object.hasOwn(actual, "code")) continue;
      actual = (actual as ObjectValue).code;
    }
    assertSame(actual, value, `${name} ${key}`);
  }
}

/** The digest names an artifact's exact bytes, so it is taken before anything is
 * decoded and this is the only place the bytes become text. Decoding is strict:
 * malformed UTF-8 is refused rather than silently becoming replacement
 * characters, and a byte order mark is refused rather than being kept by one
 * transport and stripped by the other. Refusing the mark, instead of removing
 * it after hashing, keeps the bytes and their text identical for every artifact
 * the reader accepts. */
export function decodeArtifactText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new ArtifactError(
      "malformed_artifact",
      "Artifact bytes are not valid UTF-8.",
    );
  }
  if (text.startsWith("\uFEFF"))
    throw new ArtifactError(
      "malformed_artifact",
      "Artifact bytes must not begin with a byte order mark.",
    );
  return text;
}

export function qualityFreshness(
  updatedAt: string | null,
  now = Date.now(),
): "current" | "stale" | "unknown" {
  const timestamp = updatedAt ? Date.parse(updatedAt) : NaN;
  if (!Number.isFinite(timestamp) || timestamp > now + 300_000)
    return "unknown";
  return now - timestamp > 86_400_000 ? "stale" : "current";
}

export class CandidateQualityReader {
  constructor(
    private readonly options: {
      country: MicrocosmCountry;
      readBytes: (path: string) => Promise<Uint8Array>;
    },
  ) {}

  async verified(path: string, expected: string): Promise<string> {
    const bytes = await this.options.readBytes(safeArtifactPath(path));
    if (createHash("sha256").update(bytes).digest("hex") !== digest(expected))
      throw new ArtifactError(
        "hash_mismatch",
        `Artifact digest mismatch: ${path}.`,
      );
    return decodeArtifactText(bytes);
  }

  async index(): Promise<CandidateQualityIndex> {
    const raw = json(
      decodeArtifactText(await this.options.readBytes("index.json")),
    );
    if (raw.schema_version !== QUALITY_INDEX_SCHEMA)
      throw new ArtifactError(
        "malformed_artifact",
        "Unsupported candidate quality index schema.",
      );
    assertSame(raw.country, this.options.country, "Index country");
    if (!Array.isArray(raw.candidates))
      throw new ArtifactError(
        "malformed_artifact",
        "Candidate index must contain candidates.",
      );
    const seen = new Set<string>();
    const candidates = raw.candidates.map((value) => {
      const entry = object(value);
      const manifest = object(entry.manifest);
      const hash = digest(manifest.sha256);
      const id = candidateId(entry.candidate_release_id);
      if (seen.has(id))
        throw new ArtifactError(
          "malformed_artifact",
          "Candidate index has duplicate identifiers.",
        );
      seen.add(id);
      const path = safeArtifactPath(manifest.path);
      if (path !== `manifests/${hash}.json`)
        throw new ArtifactError(
          "malformed_artifact",
          "Candidate manifest must use its content-addressed path.",
        );
      const status = execution(entry.execution_status);
      const releaseEligibility = eligibility(entry.release_eligibility);
      if (releaseEligibility.status === "eligible" && status !== "completed")
        throw new ArtifactError(
          "malformed_artifact",
          "Eligible index entry requires completion.",
        );
      return {
        candidate_release_id: id,
        run_id: text(entry.run_id, "run_id"),
        execution_status: status,
        release_eligibility: releaseEligibility,
        updated_at: date(entry.updated_at, "updated_at"),
        manifest: { path, sha256: hash },
      };
    });
    return {
      schema_version: QUALITY_INDEX_SCHEMA,
      country: this.options.country,
      updated_at: date(raw.updated_at, "updated_at"),
      candidates,
    };
  }

  async manifest(
    id: string,
    sha256: string,
  ): Promise<CandidateQualityManifest> {
    candidateId(id);
    digest(sha256);
    const raw = json(await this.verified(`manifests/${sha256}.json`, sha256));
    if (raw.schema_version !== QUALITY_SCHEMA)
      throw new ArtifactError(
        "malformed_artifact",
        "Unsupported candidate quality manifest schema.",
      );
    assertSame(raw.country, this.options.country, "Manifest country");
    assertSame(raw.candidate_release_id, id, "Manifest identity");
    const status = execution(raw.execution_status);
    const pop = raw.population == null ? null : object(raw.population);
    if (!pop && !["pending", "failed", "cancelled"].includes(status))
      throw new ArtifactError(
        "malformed_artifact",
        "Only pending or failed pre-population builds may omit population identity.",
      );
    const population = pop
      ? {
          sha256: digest(pop.sha256),
          period: text(pop.period, "population period"),
          entity: text(pop.entity, "population entity"),
        }
      : null;
    const provenance = strings(raw.provenance);
    const runId = text(raw.run_id, "run_id");
    const context: BindingContext = {
      country: this.options.country,
      candidate_release_id: id,
      run_id: runId,
      population,
      provenance,
    };
    const attachments: Record<string, EvidenceAttachment> = {};
    for (const [name, value] of Object.entries(
      object(raw.attachments, "attachments"),
    )) {
      const entry = object(value, name);
      const status = enumerated(
        entry.status,
        attachmentStatuses,
        `Unknown ${name} attachment status.`,
      );
      if (status !== "available") {
        attachments[name] = {
          status,
          reason: text(entry.reason, `${name} reason`),
        };
        continue;
      }
      const identity: EvidenceIdentity = strings(entry.identity);
      if (entry.scope === "population") {
        if (!population)
          throw new ArtifactError(
            "stale_artifact",
            "Population evidence requires an actual population identity.",
          );
        assertSame(
          identity.candidate_release_id,
          id,
          `${name} candidate identity`,
        );
        assertSame(
          identity.population_sha256,
          population.sha256,
          `${name} population identity`,
        );
        for (const key of [
          "model_package",
          "model_version",
          "model_commit",
          "target_surface_sha256",
        ] as const) {
          if (identity[key] && provenance[key])
            assertSame(identity[key], provenance[key], `${name} ${key}`);
        }
      } else if (entry.scope === "model") {
        text(identity.model_package, `${name} model package`);
        text(identity.model_version, `${name} model version`);
        if (
          identity.population_sha256 ||
          identity.candidate_release_id ||
          identity.release_id
        )
          throw new ArtifactError(
            "malformed_artifact",
            "Model-only evidence must not claim population scope.",
          );
      } else if (entry.scope === "run") {
        assertSame(
          identity.candidate_release_id,
          id,
          `${name} candidate identity`,
        );
        assertSame(
          identity.run_id,
          text(raw.run_id, "run_id"),
          `${name} run identity`,
        );
        if (identity.population_sha256)
          throw new ArtifactError(
            "malformed_artifact",
            "Run-only evidence must not claim population scope.",
          );
      } else
        throw new ArtifactError(
          "malformed_artifact",
          `Available ${name} evidence requires population, model or run scope.`,
        );
      const bindings = identityBindings(context, entry.scope, name, identity);
      for (const [key, value] of Object.entries(identity)) {
        if (Object.hasOwn(bindings, key))
          assertSame(value, bindings[key], `${name} ${key}`);
      }
      attachments[name] = {
        status: "available",
        scope: entry.scope,
        path: safeArtifactPath(entry.path),
        sha256: digest(entry.sha256),
        identity,
      };
    }
    let geography: CandidateQualityManifest["geography"] = null;
    if (raw.geography != null) {
      const geo = object(raw.geography);
      if (!Array.isArray(geo.levels))
        throw new ArtifactError(
          "malformed_artifact",
          "Geography levels must be declared.",
        );
      geography = {
        levels: geo.levels.map((value) => text(value, "geography level")),
        ...(geo.vintage !== undefined
          ? { vintage: text(geo.vintage, "geography vintage") }
          : {}),
      };
    }
    const release_eligibility = eligibility(raw.release_eligibility);
    if (
      release_eligibility.status === "eligible" &&
      (!population || status !== "completed")
    )
      throw new ArtifactError(
        "malformed_artifact",
        "Release eligibility requires a completed population build.",
      );
    return {
      schema_version: QUALITY_SCHEMA,
      country: this.options.country,
      candidate_release_id: id,
      run_id: runId,
      created_at: date(raw.created_at, "created_at"),
      execution_status: status,
      release_eligibility,
      population,
      provenance,
      geography,
      attachments,
    };
  }

  async attachment(
    manifest: CandidateQualityManifest,
    name: string,
  ): Promise<ObjectValue> {
    const entry = manifest.attachments[name];
    if (!entry || entry.status !== "available")
      throw new ArtifactError(
        "partial_artifact",
        entry?.reason ??
          `${name.replaceAll("_", " ")} has not been published for this candidate.`,
      );
    const raw = json(await this.verified(entry.path!, entry.sha256!));
    validatePayloadIdentity(manifest, entry, name, raw);
    return raw;
  }
}
