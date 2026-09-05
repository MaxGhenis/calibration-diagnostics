import { skipToken, useQuery } from "@tanstack/react-query";
import { useQualityContext } from "@/components/layout/quality-context";
import { receiptGraphIdentity } from "@/lib/microcosm/graph/navigation";
import type { ReceiptGraphPayload } from "@/lib/microcosm/graph/types";
import { apiGet } from "../client";

/** Build receipts belong to one immutable candidate. Without a candidate
 * selection there is nothing to ask for, and the view says so rather than
 * showing whichever run the dashboard happens to ship. The same rule decides
 * whether this query runs and what the view says when it does not, so a
 * selection that cannot be requested is never left reading as one that is still
 * being fetched. */
export function useReceiptGraph() {
  const { selection } = useQualityContext();
  const identity = receiptGraphIdentity(selection);
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
