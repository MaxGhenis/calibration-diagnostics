import type { MicrocosmCountry } from "../countries";

export const QUALITY_SELECTION_KEYS = [
  "candidate",
  "manifest_sha256",
  "release",
  "incumbent",
] as const;

export interface QualitySelection {
  country: MicrocosmCountry;
  candidate: string;
  manifest_sha256: string;
  release: string;
  incumbent: string;
}

export function parseCandidateToken(token: string) {
  const match =
    /^candidate:([A-Za-z0-9][A-Za-z0-9._-]{0,299}):([a-f0-9]{64})$/.exec(token);
  return match
    ? { candidate: match[1], manifest_sha256: match[2] }
    : undefined;
}

// The incumbent a URL asked for, before any self-comparison is resolved away.
// A surface that reports why a comparison is not being drawn needs to know one
// was requested at all, which the resolved selection no longer records.
export function requestedIncumbent(
  params: URLSearchParams,
  country: MicrocosmCountry,
): string {
  return !params.get("country") || params.get("country") === country
    ? (params.get("incumbent") ?? "")
    : "";
}

export function selectionFromSearch(
  params: URLSearchParams,
  country: MicrocosmCountry,
): QualitySelection {
  const matches = !params.get("country") || params.get("country") === country;
  const release = matches ? (params.get("release") ?? "") : "";
  // Accept the existing loader transport form in copied target URLs as the
  // same global candidate context, rather than loading candidate calibration
  // while unrelated default evaluation remains selected.
  const token = parseCandidateToken(release);
  const candidate = matches ? params.get("candidate") || token?.candidate || "" : "";
  return withoutSelfComparison({
    country,
    candidate,
    manifest_sha256: matches
      ? params.get("candidate")
        ? (params.get("manifest_sha256") ?? "")
        : (token?.manifest_sha256 ?? params.get("manifest_sha256") ?? "")
      : "",
    release: candidate ? "" : release,
    incumbent: requestedIncumbent(params, country),
  });
}

// An incumbent names a DIFFERENT population to compare against. A selection
// whose incumbent is its own population describes no comparison, however it was
// authored, so it resolves to none here rather than overlaying a population on
// itself and labelling one copy Incumbent. This settles the spellings that are
// equal as strings, synchronously and without a fetch; the spellings that are
// equal only once resolved -- `latest` against the id it points at, two
// manifests of one population -- are settled against loaded identities in
// lib/microcosm/quality/identity.ts.
export function withoutSelfComparison(
  selection: QualitySelection,
): QualitySelection {
  const current = candidateReleaseToken(selection) || selection.release;
  return selection.incumbent && selection.incumbent === current
    ? { ...selection, incumbent: "" }
    : selection;
}

export function candidateReleaseToken(selection: QualitySelection): string {
  return selection.candidate
    ? `candidate:${selection.candidate}:${selection.manifest_sha256}`
    : "";
}

export function qualityHref(href: string, selection: QualitySelection): string {
  if (/^(?:https?:)?\/\//.test(href)) return href;
  const url = new URL(href, "https://dashboard.invalid");
  url.searchParams.set("country", selection.country);
  for (const key of QUALITY_SELECTION_KEYS) {
    if (selection[key]) url.searchParams.set(key, selection[key]);
    else url.searchParams.delete(key);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function selectionUrl(
  current: string,
  country: MicrocosmCountry,
  patch: Partial<Omit<QualitySelection, "country">>,
): string {
  const url = new URL(current);
  const previous = selectionFromSearch(url.searchParams, country);
  let next = { ...previous, ...patch };
  if (patch.release !== undefined && !patch.candidate) {
    next.candidate = "";
    next.manifest_sha256 = "";
  } else if (patch.candidate) next.release = "";
  // Selecting the population an existing incumbent already names leaves no
  // comparison to draw, so the incumbent goes with it.
  next = withoutSelfComparison(next);
  const populationChanged =
    candidateReleaseToken(previous) !== candidateReleaseToken(next) ||
    previous.release !== next.release;
  if (populationChanged) {
    // Dataset-specific fact/target keys must not accidentally inspect another
    // population after the global selector changes.
    for (const key of Array.from(url.searchParams.keys())) {
      if (
        key !== "country" &&
        !QUALITY_SELECTION_KEYS.includes(
          key as (typeof QUALITY_SELECTION_KEYS)[number],
        )
      )
        url.searchParams.delete(key);
    }
  }
  return new URL(
    qualityHref(`${url.pathname}${url.search}${url.hash}`, next),
    url.origin,
  ).toString();
}
