import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  ArtifactError,
  CrossDatasetArtifactReader,
} from "../../cross-dataset/artifact";
import { countryRegistration, type MicrocosmCountry } from "../countries";
import {
  CandidateQualityReader,
  candidateId,
  decodeArtifactText,
  digest,
  safeArtifactPath,
} from "./artifact";
import type { CandidateQualityManifest } from "./types";

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
// Both transports hand back the artifact's exact bytes; decoding happens once,
// strictly, in decodeArtifactText, so a digest is checked against what was
// stored or served rather than against one transport's interpretation of it.
export interface QualitySource {
  reader: CandidateQualityReader;
  readBytes: (relativePath: string) => Promise<Uint8Array>;
  readText: (relativePath: string) => Promise<string>;
}

export function configuredQualitySource(
  country: MicrocosmCountry,
): QualitySource {
  const prefix = `MICROCOSM_QUALITY_${country.toUpperCase()}`;
  const directory = process.env[`${prefix}_DIR`]?.trim();
  const baseUrl = process.env[`${prefix}_BASE_URL`]?.trim();
  if (directory && baseUrl)
    throw new ArtifactError(
      "malformed_artifact",
      `Configure one of ${prefix}_DIR and ${prefix}_BASE_URL, not both.`,
    );
  if (!directory && !baseUrl)
    throw new ArtifactError(
      "partial_artifact",
      "Candidate evidence is not configured for this country.",
    );
  let readBytes: QualitySource["readBytes"];
  if (directory) {
    readBytes = async (relativePath) => {
      const root = await realpath(directory);
      const resolved = await realpath(
        path.resolve(root, safeArtifactPath(relativePath)),
      );
      if (!resolved.startsWith(`${root}${path.sep}`))
        throw new ArtifactError(
          "malformed_artifact",
          "Artifact path escaped the configured directory.",
        );
      if ((await stat(resolved)).size > MAX_ARTIFACT_BYTES)
        throw new ArtifactError(
          "malformed_artifact",
          "Evidence must be a compact aggregate artifact (at most 64 MiB).",
        );
      return readFile(resolved);
    };
  } else {
    let base: URL;
    try {
      base = new URL(baseUrl!.endsWith("/") ? baseUrl! : `${baseUrl}/`);
    } catch {
      throw new ArtifactError(
        "malformed_artifact",
        `${prefix}_BASE_URL must be an HTTP(S) URL.`,
      );
    }
    if (
      !/^https?:$/.test(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw new ArtifactError(
        "malformed_artifact",
        "Candidate evidence base URL must be HTTP(S), without credentials, query or fragment.",
      );
    readBytes = async (relativePath) => {
      const url = new URL(safeArtifactPath(relativePath), base);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
        throw new ArtifactError(
          "malformed_artifact",
          "Artifact path escaped the configured URL.",
        );
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok)
        throw new ArtifactError(
          "partial_artifact",
          `Candidate evidence returned HTTP ${response.status}.`,
        );
      if (Number(response.headers.get("content-length")) > MAX_ARTIFACT_BYTES)
        throw new ArtifactError(
          "malformed_artifact",
          "Evidence exceeds the aggregate artifact size limit.",
        );
      if (!response.body)
        throw new ArtifactError(
          "partial_artifact",
          "Evidence response has no body.",
        );
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_ARTIFACT_BYTES)
            throw new ArtifactError(
              "malformed_artifact",
              "Evidence exceeds the aggregate artifact size limit.",
            );
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return Buffer.concat(chunks);
    };
  }
  const readText: QualitySource["readText"] = async (relativePath) =>
    decodeArtifactText(await readBytes(relativePath));
  return {
    reader: new CandidateQualityReader({ country, readBytes }),
    readBytes,
    readText,
  };
}

export function parseCandidateToken(token: string): {
  id: string;
  sha256: string;
} {
  const pieces = token.split(":");
  if (pieces.length !== 3 || pieces[0] !== "candidate")
    throw new ArtifactError(
      "malformed_artifact",
      "Invalid immutable candidate selection.",
    );
  return { id: candidateId(pieces[1]), sha256: digest(pieces[2]) };
}

export async function loadCandidate(
  country: MicrocosmCountry,
  id: string,
  sha256: string,
) {
  const source = configuredQualitySource(country);
  const manifest = await source.reader.manifest(id, sha256);
  return { ...source, manifest };
}

export function requirePopulationAttachment(
  manifest: CandidateQualityManifest,
  name: string,
) {
  const attachment = manifest.attachments[name];
  if (!attachment || attachment.status !== "available")
    throw new ArtifactError(
      "partial_artifact",
      attachment?.reason ??
        `${name.replaceAll("_", " ")} has not been published for this candidate.`,
    );
  if (attachment.scope !== "population")
    throw new ArtifactError(
      "stale_artifact",
      `${name} is ${attachment.scope}-scoped evidence, not evidence for the selected population.`,
    );
  return attachment;
}

export async function candidateCrossDatasetReader(
  country: MicrocosmCountry,
  id: string,
  sha256: string,
): Promise<CrossDatasetArtifactReader> {
  const source = await loadCandidate(country, id, sha256);
  const attachment = requirePopulationAttachment(
    source.manifest,
    "cross_dataset",
  );
  const raw = await source.reader.attachment(source.manifest, "cross_dataset");
  const identity = attachment.identity!;
  if (!identity.run_id || !identity.snapshot_id || !identity.source_id)
    throw new ArtifactError(
      "malformed_artifact",
      "Cross-dataset evidence must name its run, snapshot and candidate source.",
    );
  if (
    raw.run_id !== identity.run_id ||
    raw.snapshot_id !== identity.snapshot_id
  )
    throw new ArtifactError(
      "stale_artifact",
      "Cross-dataset identity does not match its attachment.",
    );
  const parent = attachment.path!.split("/").slice(0, -1).join("/");
  const reader = new CrossDatasetArtifactReader({
    expectedRunId: identity.run_id,
    expectedJurisdiction: country.toUpperCase(),
    jurisdictionAliases: countryRegistration(country).jurisdiction_aliases,
    readText: async (relativePath) =>
      relativePath === "manifest.json"
        ? source.reader.verified(attachment.path!, attachment.sha256!)
        : source.readText(
            parent
              ? `${parent}/${safeArtifactPath(relativePath)}`
              : safeArtifactPath(relativePath),
          ),
  });
  const summary = await reader.summary();
  if (!summary.sources.some((item) => item.source_id === identity.source_id))
    throw new ArtifactError(
      "stale_artifact",
      "Cross-dataset candidate source is absent from the bound evaluation.",
    );
  return reader;
}
