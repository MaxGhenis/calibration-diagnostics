import { NextResponse } from "next/server";
import { ArtifactError } from "@/lib/cross-dataset/artifact";
import { parseCountry } from "@/lib/microcosm/countries";
import {
  ReceiptGraphUnavailableError,
  buildReceiptGraph,
  verifyProjectionBinding,
} from "@/lib/microcosm/graph/adapter";
import { boundedGraphReader, normalizeGraphAttachment, safePublisherReason, verifyGraphManifestPresentation } from "@/lib/microcosm/graph/attachment";
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

  try {
    // Presence is authoritative only after the requested immutable manifest has
    // been read. An unavailable or malformed present attachment never consults
    // the legacy registry. Transport failures retain the quality reader's 503.
    const source = await loadCandidate(country, candidate, manifestSha256);
    if (Object.hasOwn(source.manifest.attachments, "graph_receipts")) {
      verifyGraphManifestPresentation(source.manifest);
      const attachment = source.manifest.attachments.graph_receipts;
      if (attachment.status !== "available")
        return unavailable(safePublisherReason(attachment.reason));
      // The aggregate graph is only presentable together with the run-scoped
      // build summary that binds it. A candidate that publishes one without the
      // other is unavailable for the same reason a pending graph attachment is,
      // not a server condition, and still never reaches the legacy registry.
      // Only an actual transport or read failure below is answered with a 503.
      const buildAttachment = source.manifest.attachments.build_manifest;
      if (!buildAttachment || buildAttachment.status !== "available")
        return unavailable(
          buildAttachment?.reason !== undefined
            ? safePublisherReason(buildAttachment.reason)
            : "The selected candidate publishes aggregate graph receipts without the run-scoped build summary that binds them to this run, so nothing is shown.",
        );
      const reader = boundedGraphReader(country, source.readBytes);
      const graph = await reader.attachment(source.manifest, "graph_receipts");
      const build = await reader.attachment(source.manifest, "build_manifest");
      const { projection, checks } = normalizeGraphAttachment(graph, source.manifest, manifestSha256, build);
      return NextResponse.json(buildReceiptGraph(projection, source.manifest, build, checks), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const projection = receiptProjectionFor(country, candidate, manifestSha256);
    if (!projection)
      return unavailable(
        "This dashboard ships no build receipts for the selected candidate. Nothing is shown rather than another candidate's run.",
      );
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
      buildReceiptGraph(projection, source.manifest, buildEvidence, checks),
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
