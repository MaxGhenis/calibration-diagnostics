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
  if (!/^\d{4}-\d\d-\d\dT/.test(result) || !Number.isFinite(Date.parse(result)))
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
    return object(JSON.parse(raw));
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
      return {
        candidate_release_id: id,
        run_id: text(entry.run_id, "run_id"),
        execution_status: execution(entry.execution_status),
        release_eligibility: eligibility(entry.release_eligibility),
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
        if (identity.population_sha256 || identity.candidate_release_id)
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
      run_id: text(raw.run_id, "run_id"),
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
    for (const [key, value] of Object.entries(entry.identity ?? {})) {
      if (raw[key] !== undefined) assertSame(raw[key], value, `${name} ${key}`);
    }
    if (entry.scope === "population" && raw.release_id !== undefined)
      assertSame(
        raw.release_id,
        manifest.candidate_release_id,
        `${name} release identity`,
      );
    return raw;
  }
}
