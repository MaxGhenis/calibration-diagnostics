import { queryOptions, skipToken, useQuery } from "@tanstack/react-query";
import { useQualityContext } from "@/components/layout/quality-context";
import {
  candidatePopulationIdentity,
  publishedComparisonIdentities,
  resolveComparison,
  type ResolvedComparison,
} from "@/lib/microcosm/quality/identity";
import { parseCandidateToken } from "@/lib/microcosm/quality/selection";
import type { MicrocosmCountry } from "@/lib/microcosm/countries";
import type {
  CandidateQualityManifest,
  QualityIndexResponse,
} from "@/lib/microcosm/quality/types";
import { apiGet } from "../client";
import { qualityAttachmentOptions } from "../quality-attachment";
import { useMicrocosmReleases } from "./use-microcosm";

export function useQualityIndex() {
  const { selection } = useQualityContext();
  return useQuery({
    queryKey: ["quality", "index", selection.country],
    queryFn: () =>
      apiGet<QualityIndexResponse>("/microcosm/quality", {
        country: selection.country,
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useQualityParams() {
  const { selection } = useQualityContext();
  return {
    candidate: selection.candidate || undefined,
    manifest_sha256: selection.candidate
      ? selection.manifest_sha256
      : undefined,
  };
}

interface CandidateIdentity {
  candidate: string;
  manifest_sha256: string;
}

// One key shape for every manifest, whichever side of a comparison asked for
// it, so selecting the incumbent as the population reuses the manifest that
// resolved it rather than fetching the same immutable file again.
function manifestOptions(
  country: MicrocosmCountry,
  identity: CandidateIdentity | undefined,
) {
  return queryOptions({
    queryKey: [
      "quality",
      "manifest",
      country,
      identity?.candidate ?? null,
      identity?.manifest_sha256 ?? null,
    ],
    queryFn: identity
      ? () =>
          apiGet<CandidateQualityManifest>("/microcosm/quality", {
            view: "manifest",
            country,
            ...identity,
          })
      : skipToken,
    enabled: Boolean(identity),
    staleTime: Infinity,
    retry: false,
  });
}

function selectedIdentity(
  selection: ReturnType<typeof useQualityContext>["selection"],
): CandidateIdentity | undefined {
  return selection.candidate
    ? {
        candidate: selection.candidate,
        manifest_sha256: selection.manifest_sha256,
      }
    : undefined;
}

export function useQualityManifest() {
  const { selection } = useQualityContext();
  return useQuery(
    manifestOptions(selection.country, selectedIdentity(selection)),
  );
}

export type { ResolvedComparison };

/** The one place the dashboard decides whether a requested incumbent is a
 * second population. The population strip, the compare page and the quality
 * overview all read it, so a refusal empties the incumbent control, the
 * incumbent columns and the incumbent overlay together, and is explained in the
 * same words wherever it is explained. */
export function useResolvedComparison(): ResolvedComparison {
  const { selection, release, requestedIncumbent } = useQualityContext();
  const releases = useMicrocosmReleases();
  const selected = selectedIdentity(selection);
  const incumbentToken = parseCandidateToken(selection.incumbent);
  const selectedManifest = useQuery(
    manifestOptions(selection.country, selected),
  );
  const incumbentManifest = useQuery(
    manifestOptions(selection.country, incumbentToken),
  );
  // Resolve Latest on either side to the concrete release before identifying
  // it. An empty selected release is the pointer; an empty incumbent is absent.
  const latest =
    releases.data?.latest_release_id ||
    releases.data?.releases?.[0]?.release_id ||
    "";
  const published = publishedComparisonIdentities(
    selection.country,
    release,
    selection.incumbent,
    latest,
  );
  return resolveComparison({
    requested: requestedIncumbent,
    incumbent: selection.incumbent,
    selected: selected
      ? candidatePopulationIdentity(selection.country, selectedManifest.data)
      : published.selected,
    against: incumbentToken
      ? candidatePopulationIdentity(selection.country, incumbentManifest.data)
      : published.incumbent,
    resolving:
      Boolean(requestedIncumbent) &&
      (selectedManifest.isLoading ||
        incumbentManifest.isLoading ||
        (published.needsPointer && releases.isLoading)),
  });
}

export function useQualityAttachment<T>(
  view: string,
  enabled = true,
  token?: string,
) {
  const { selection } = useQualityContext();
  return useQuery(qualityAttachmentOptions<T>(view, selection, enabled, token));
}
