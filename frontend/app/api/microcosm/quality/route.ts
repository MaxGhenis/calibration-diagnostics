import { NextResponse } from "next/server";
import { ArtifactError } from "@/lib/cross-dataset/artifact";
import { parseCountry } from "@/lib/microcosm/countries";
import { object, qualityFreshness } from "@/lib/microcosm/quality/artifact";
import {
  configuredQualitySource,
  loadCandidate,
  requirePopulationAttachment,
} from "@/lib/microcosm/quality/source";
import {
  validateDistributions,
  validateSupport,
} from "@/lib/microcosm/quality/aggregates";
import { validateValidationReach } from "@/lib/microcosm/quality/reach";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const country = parseCountry(params.get("country"));
  const view = params.get("view") ?? "index";
  try {
    if (view === "index") {
      const index = await configuredQualitySource(country).reader.index();
      return NextResponse.json(
        {
          available: true,
          index,
          freshness: qualityFreshness(index.updated_at),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const candidate = await loadCandidate(
      country,
      params.get("candidate") ?? "",
      params.get("manifest_sha256") ?? "",
    );
    if (view === "manifest")
      return NextResponse.json(candidate.manifest, {
        headers: { "Cache-Control": "no-store" },
      });
    if (["validation_reach", "support", "distributions"].includes(view)) {
      if (view !== "validation_reach")
        requirePopulationAttachment(candidate.manifest, view);
      const data = await candidate.reader.attachment(candidate.manifest, view);
      if (
        view !== "validation_reach" &&
        data.period !== candidate.manifest.population?.period
      )
        throw new ArtifactError(
          "stale_artifact",
          "Aggregate period differs from the selected population.",
        );
      if (view === "validation_reach") {
        if (candidate.manifest.attachments.validation_reach.scope === "run") {
          throw new ArtifactError(
            "stale_artifact",
            "Validation reach requires an explicit model or population scope.",
          );
        }
        const source = object(data.source, "validation reach source");
        const identity =
          candidate.manifest.attachments.validation_reach.identity!;
        if (identity.model_version && identity.model_version !== source.version)
          throw new ArtifactError(
            "stale_artifact",
            "Validation reach model version differs from the attachment identity.",
          );
        if (identity.model_commit && identity.model_commit !== source.commit)
          throw new ArtifactError(
            "stale_artifact",
            "Validation reach model commit differs from the attachment identity.",
          );
        validateValidationReach(data);
      }
      const validated =
        view === "support"
          ? validateSupport(data)
          : view === "distributions"
            ? validateDistributions(data)
            : data;
      return NextResponse.json(validated, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json(
      { detail: "Unknown quality evidence view." },
      { status: 400 },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (view === "index")
      return NextResponse.json(
        { available: false, freshness: "unknown", detail },
        { headers: { "Cache-Control": "no-store" } },
      );
    return NextResponse.json(
      {
        detail,
        artifact_error:
          error instanceof ArtifactError ? error.code : "unavailable",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
