// The receipt projections this dashboard ships, keyed by the immutable
// candidate each one describes.
//
// A request names a country, a candidate release id and a manifest digest, and
// nothing else. There is no path, prefix or filename in the lookup, so a
// request cannot reach a file this module does not already import, and a
// candidate with no projection here is answered "unavailable" rather than being
// shown some other candidate's run.

import type { ReceiptProjection } from "./adapter";
import geographyV1 from "./receipts/us-graph-f001-geography-20260905-v1.json";

const PROJECTIONS: ReceiptProjection[] = [
  geographyV1 as unknown as ReceiptProjection,
];

export function receiptProjectionFor(
  country: string,
  candidate: string,
  manifestSha256: string,
): ReceiptProjection | undefined {
  return PROJECTIONS.find(
    (projection) =>
      projection.country === country &&
      projection.candidate_release_id === candidate &&
      projection.candidate_manifest_sha256 === manifestSha256,
  );
}

/** Candidate ids the dashboard can draw, for messages that explain what is and
 * is not covered. Digests are deliberately not listed: a reader who has one
 * candidate selected does not need another's identity. */
export function projectedCandidateIds(country: string): string[] {
  return PROJECTIONS.filter((projection) => projection.country === country).map(
    (projection) => projection.candidate_release_id,
  );
}
