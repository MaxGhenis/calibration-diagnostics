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
  return {
    country,
    candidate,
    manifest_sha256: matches
      ? params.get("candidate")
        ? (params.get("manifest_sha256") ?? "")
        : (token?.manifest_sha256 ?? params.get("manifest_sha256") ?? "")
      : "",
    release: candidate ? "" : release,
    incumbent: matches ? (params.get("incumbent") ?? "") : "",
  };
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
  const next = { ...previous, ...patch };
  if (patch.release !== undefined && !patch.candidate) {
    next.candidate = "";
    next.manifest_sha256 = "";
  } else if (patch.candidate) next.release = "";
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
