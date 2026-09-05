import { queryOptions, skipToken } from "@tanstack/react-query";
import {
  candidateReleaseToken,
  parseCandidateToken,
  type QualitySelection,
} from "@/lib/microcosm/quality/selection";
import { apiGet } from "./client";

export function qualityAttachmentOptions<T>(
  view: string,
  selection: QualitySelection,
  enabled = true,
  token?: string,
) {
  // Only an omitted token means the selected candidate. An explicitly empty
  // incumbent, published release or malformed token has no candidate identity.
  const identity = parseCandidateToken(
    token === undefined ? candidateReleaseToken(selection) : token,
  );
  const active = enabled && Boolean(identity);
  return queryOptions({
    queryKey: [
      "quality",
      view,
      selection.country,
      identity?.candidate ?? null,
      identity?.manifest_sha256 ?? null,
    ],
    queryFn: identity
      ? () =>
          apiGet<T>("/microcosm/quality", {
            view,
            country: selection.country,
            ...identity,
          })
      : skipToken,
    enabled: active,
    // A disabled observer still sees its query's cached data. Do not expose
    // an attachment that the current manifest/selection has not enabled.
    select: (data: T) => (active ? data : undefined),
    staleTime: Infinity,
    retry: false,
  });
}
