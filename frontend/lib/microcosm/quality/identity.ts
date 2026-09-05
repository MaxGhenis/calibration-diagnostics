import type { MicrocosmCountry } from "../countries";
import type { CandidateQualityManifest } from "./types";

/** Two selections describe a comparison only when they name two different
 * populations, and the transport spells one population more than one way: the
 * `latest` pointer and the concrete release id it currently resolves to, or two
 * immutable candidate manifests recording the same population bytes under the
 * same reused candidate id. Equality of the URL tokens therefore settles
 * nothing. Every surface -- the population strip, the compare page, the quality
 * overview and the server comparison itself -- resolves identity through this
 * module, so they agree on what is being compared and say the same thing about
 * it. It stays free of server-only imports because the browser resolves the
 * same identities the API route does. */

export type PopulationIdentityBasis =
  | "population_digest"
  | "published_release"
  | "unresolved";

export interface PopulationIdentity {
  basis: PopulationIdentityBasis;
  /** Empty when the basis is unresolved. Only keys of the same basis are
   * comparable: a digest over population bytes and a release id are different
   * kinds of name, and equality of one says nothing about the other. */
  key: string;
  /** The population digest alone, when there is one. Equal bytes cannot be two
   * populations however the rest of the key is spelled. */
  digest: string;
}

export type ComparisonIdentityStatus =
  | "same_population"
  | "distinct_population"
  | "unverified";

export interface ComparisonIdentity {
  status: ComparisonIdentityStatus;
  /** Display-ready and authored here, so every surface explains the same
   * resolution in the same words. Empty for two populations established to be
   * different, which needs no explanation. */
  reason: string;
}

export const SAME_POPULATION_REASON =
  "The requested incumbent resolves to the population already selected, so there is no comparison to draw.";
export const UNVERIFIED_POPULATION_REASON =
  "The two selections publish no comparable population identity, so this comparison is not established to be between different populations.";

const UNRESOLVED: PopulationIdentity = {
  basis: "unresolved",
  key: "",
  digest: "",
};

/** A candidate's population is named by the digest its immutable manifest
 * binds, read with the period and entity that digest was produced for. The
 * candidate id is not an identity: the same id is reused across rebuilds, and
 * evidence updates change the manifest digest without changing population
 * bytes. A pending, failed or cancelled build may legitimately have produced no
 * population at all, and then names none. */
export function candidatePopulationIdentity(
  country: MicrocosmCountry,
  manifest: Pick<CandidateQualityManifest, "population"> | null | undefined,
): PopulationIdentity {
  const population = manifest?.population;
  return population
    ? {
        basis: "population_digest",
        key: JSON.stringify([
          country,
          population.sha256,
          population.period,
          population.entity,
        ]),
        digest: population.sha256,
      }
    : UNRESOLVED;
}

/** A published release names a population by its concrete release id. The
 * caller resolves the pointer first: `latest` and the empty default are the
 * name of whichever release the pointer currently holds, not of a population,
 * and a candidate transport token is not a published release at all. */
export function publishedPopulationIdentity(
  country: MicrocosmCountry,
  releaseId: string,
): PopulationIdentity {
  return releaseId &&
    releaseId !== "latest" &&
    !releaseId.startsWith("candidate:")
    ? {
        basis: "published_release",
        key: JSON.stringify([country, releaseId]),
        digest: "",
      }
    : UNRESOLVED;
}

/** The concrete release a published selection names. The pointer is the
 * selection's default, but it is also writable as `latest`, and both spellings
 * mean whichever release the pointer currently holds. */
export function resolvedReleaseId(selected: string, latest: string): string {
  return !selected || selected === "latest" ? latest : selected;
}

/** Resolve the pointer on either side before comparing published selections.
 * An empty selected release means Latest; an empty incumbent means no request.
 * Keep the pointer requirement explicit so clients wait for either alias. */
export function publishedComparisonIdentities(
  country: MicrocosmCountry,
  selected: string,
  incumbent: string,
  latest: string,
): {
  selected: PopulationIdentity;
  incumbent: PopulationIdentity;
  needsPointer: boolean;
} {
  return {
    selected: publishedPopulationIdentity(
      country,
      resolvedReleaseId(selected, latest),
    ),
    incumbent: publishedPopulationIdentity(
      country,
      incumbent ? resolvedReleaseId(incumbent, latest) : "",
    ),
    needsPointer:
      !latest && (!selected || selected === "latest" || incumbent === "latest"),
  };
}

/** The structural part of a loaded calibration that names its population. */
export interface PopulationIdentitySource {
  country: MicrocosmCountry;
  source: string;
  release_id: string;
  resolved_release_id?: string;
  quality_manifest?: Pick<CandidateQualityManifest, "population">;
}

export function populationIdentity(
  calibration: PopulationIdentitySource,
): PopulationIdentity {
  return calibration.source === "candidate_quality"
    ? candidatePopulationIdentity(
        calibration.country,
        calibration.quality_manifest,
      )
    : publishedPopulationIdentity(
        calibration.country,
        calibration.resolved_release_id ?? "",
      );
}

/** Same basis and same key is one population under two names, whatever the
 * tokens looked like. Same basis and different keys is a real comparison, which
 * is why a reused candidate id over different population bytes still compares.
 * Anything else -- a build with no population yet, or a candidate digest held
 * against a published release id, which publishes no digest to hold it against
 * -- leaves the question open, so the comparison stands and says so. */
export function comparisonIdentity(
  selected: PopulationIdentity,
  incumbent: PopulationIdentity,
): ComparisonIdentity {
  if (
    selected.basis === "unresolved" ||
    incumbent.basis === "unresolved" ||
    selected.basis !== incumbent.basis
  )
    return { status: "unverified", reason: UNVERIFIED_POPULATION_REASON };
  if (selected.key === incumbent.key)
    return { status: "same_population", reason: SAME_POPULATION_REASON };
  // One digest under two periods or two entities is a contradiction in the
  // evidence rather than a second population, so it does not buy a comparison.
  return selected.digest && selected.digest === incumbent.digest
    ? { status: "unverified", reason: UNVERIFIED_POPULATION_REASON }
    : { status: "distinct_population", reason: "" };
}

export interface ResolvedComparison extends ComparisonIdentity {
  /** The incumbent to actually load: empty when the request resolved to no
   * comparison, and empty while identity is still resolving, so no surface
   * overlays an incumbent it has not established is a second population. */
  incumbent: string;
  resolving: boolean;
}

/** The whole client-side decision, kept out of the hook that gathers its
 * inputs. `requested` is the incumbent the URL asked for and `incumbent` is
 * what survived resolving the spellings that are equal as strings, so the two
 * differing is itself a refusal that has to be explained. */
export function resolveComparison(input: {
  requested: string;
  incumbent: string;
  selected: PopulationIdentity;
  against: PopulationIdentity;
  resolving: boolean;
}): ResolvedComparison {
  const identity: ComparisonIdentity = !input.requested
    ? { status: "distinct_population", reason: "" }
    : !input.incumbent
      ? { status: "same_population", reason: SAME_POPULATION_REASON }
      : comparisonIdentity(input.selected, input.against);
  return {
    incumbent:
      input.resolving || identity.status === "same_population"
        ? ""
        : input.incumbent,
    status: identity.status,
    reason: input.resolving ? "" : identity.reason,
    resolving: input.resolving,
  };
}
