import { skipToken, useQuery } from "@tanstack/react-query";
import { useQualityContext } from "@/components/layout/quality-context";
import type { ReceiptGraphPayload } from "@/lib/microcosm/graph/types";
import { parseCandidateToken } from "@/lib/microcosm/quality/selection";
import { candidateReleaseToken } from "@/lib/microcosm/quality/selection";
import { apiGet } from "../client";

/** Build receipts belong to one immutable candidate. Without a candidate
 * selection there is nothing to ask for, and the view says so rather than
 * showing whichever run the dashboard happens to ship. */
export function useReceiptGraph() {
  const { selection } = useQualityContext();
  const identity = parseCandidateToken(candidateReleaseToken(selection));
  return useQuery({
    queryKey: [
      "receipt-graph",
      selection.country,
      identity?.candidate ?? null,
      identity?.manifest_sha256 ?? null,
    ],
    queryFn: identity
      ? () =>
          apiGet<ReceiptGraphPayload>("/microcosm/graph", {
            country: selection.country,
            ...identity,
          })
      : skipToken,
    enabled: Boolean(identity),
    staleTime: Infinity,
    retry: false,
  });
}
