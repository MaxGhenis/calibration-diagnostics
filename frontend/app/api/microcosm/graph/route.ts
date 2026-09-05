import { NextResponse } from "next/server";
import { ArtifactError } from "@/lib/cross-dataset/artifact";
import { parseCountry } from "@/lib/microcosm/countries";
import {
  ReceiptGraphUnavailableError,
  buildReceiptGraph,
  verifyProjectionBinding,
} from "@/lib/microcosm/graph/adapter";
import { receiptProjectionFor } from "@/lib/microcosm/graph/projections";
import { RECEIPT_GRAPH_SCHEMA } from "@/lib/microcosm/graph/types";
import { loadCandidate } from "@/lib/microcosm/quality/source";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const CANDIDATE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,299}$/;
const DIGEST = /^[a-f0-9]{64}$/;

function unavailable(reason: string) {
  return NextResponse.json(
    { schema_version: RECEIPT_GRAPH_SCHEMA, available: false, reason },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const country = parseCountry(params.get("country"));
  const candidate = params.get("candidate") ?? "";
  const manifestSha256 = params.get("manifest_sha256") ?? "";

  // The request names an immutable candidate and nothing else. No path, prefix
  // or filename is accepted, here or anywhere below.
  if (!candidate || !manifestSha256)
    return NextResponse.json(
      { detail: "Select an immutable candidate to inspect its build receipts." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  if (!CANDIDATE.test(candidate) || !DIGEST.test(manifestSha256))
    return NextResponse.json(
      { detail: "Invalid immutable candidate selection." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );

  const projection = receiptProjectionFor(country, candidate, manifestSha256);
  if (!projection)
    return unavailable(
      "This dashboard ships no build receipts for the selected candidate. Nothing is shown rather than another candidate's run.",
    );

  try {
    const source = await loadCandidate(country, candidate, manifestSha256);
    const buildEvidence = await source.reader.attachment(
      source.manifest,
      "build_manifest",
    );
    const checks = verifyProjectionBinding(
      projection,
      source.manifest,
      manifestSha256,
      buildEvidence,
    );
    return NextResponse.json(
      buildReceiptGraph(projection, source.manifest, checks),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // A refusal is a normal answer: the evidence did not establish that these
    // receipts belong to the selected candidate, so the run is unavailable. A
    // digest mismatch or a stale identity is the same kind of answer. Only a
    // transport or configuration failure is reported as a server condition,
    // and only with a message this feature authored.
    if (error instanceof ReceiptGraphUnavailableError)
      return unavailable(error.message);
    if (
      error instanceof ArtifactError &&
      ["hash_mismatch", "stale_artifact", "malformed_artifact"].includes(error.code)
    )
      return unavailable(error.message);
    if (error instanceof ArtifactError)
      return NextResponse.json(
        { detail: error.message, artifact_error: error.code },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    console.error("Receipt graph request failed", error);
    return NextResponse.json(
      {
        detail:
          "Candidate build receipts could not be read from their configured source.",
        artifact_error: "unavailable",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
