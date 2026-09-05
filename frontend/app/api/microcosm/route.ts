import { NextResponse } from "next/server";
import { withBasePath } from "@/lib/base-path";

import {
  asObject,
  classifyApiError,
  hfResolveUrl,
  latestMicrocosmCalibrationHighlights,
  latestMicrocosmCalibrationSummary,
  loadRelease,
  parseCountry,
  microcosmRepo,
  microcosmRevision,
  scrub,
} from "@/lib/microcosm/latest-artifact";

export const revalidate = 21_600;
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release") ?? "latest";
  const isLatestRequest = release === "latest" || release === "";
  const country = parseCountry(params.get("country"));
  try {
    const cal = await loadRelease(release, revalidate, country);
    const calibration = latestMicrocosmCalibrationSummary(cal);
    const highlights = latestMicrocosmCalibrationHighlights(cal, 15);
    const prefix = `releases/${cal.release_id}`;
    if (cal.quality_manifest) {
      const manifestParams = new URLSearchParams({ country, view: "manifest", candidate: cal.release_id, manifest_sha256: release.split(":")[2] });
      return NextResponse.json(scrub({
        source_repo: "configured_candidate_evidence", repo_type: "candidate_evidence", revision: release.split(":")[2], source: "candidate_quality",
        release_id: cal.release_id, updated_at: cal.updated_at,
        source_artifacts: [{ name: "candidate_quality_manifest", path: `manifests/${release.split(":")[2]}.json`, url: `${withBasePath("/api/microcosm/quality")}?${manifestParams}` }],
        limitations: ["Candidate evidence is bound to the selected manifest and population digest; it is not a published release.", "Calibration fit does not establish release eligibility or independent validation."],
        quality_manifest: cal.quality_manifest, build_manifest: cal.build_manifest, release_manifest: cal.release_manifest, gates: asObject(cal.build_manifest.gates), calibration, highlights,
      }), { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(
      scrub({
        source_repo: microcosmRepo(country),
        repo_type: "dataset",
        revision: microcosmRevision(country),
        source: "huggingface_live",
        release_id: cal.release_id,
        updated_at: cal.updated_at,
        source_artifacts: [
          ...(isLatestRequest
            ? [{ name: "latest_pointer", path: "latest.json", url: hfResolveUrl("latest.json", country) }]
            : []),
          { name: "build_manifest", path: `${prefix}/build_manifest.json`, url: hfResolveUrl(`${prefix}/build_manifest.json`, country) },
          { name: "release_manifest", path: `${prefix}/release_manifest.json`, url: hfResolveUrl(`${prefix}/release_manifest.json`, country) },
          { name: "calibration_diagnostics", path: `${prefix}/calibration_diagnostics.json`, url: hfResolveUrl(`${prefix}/calibration_diagnostics.json`, country) },
          { name: "demographics", path: `${prefix}/demographics.json`, url: hfResolveUrl(`${prefix}/demographics.json`, country) },
        ],
        limitations: [
          isLatestRequest
            ? `Everything on this page is read live from the ${microcosmRepo(country)} Hugging Face dataset; the current release is resolved through latest.json.`
            : `Everything on this page is read live from the ${microcosmRepo(country)} Hugging Face dataset for the selected release id.`,
          "Loss values are the calibrator's own metric for this release; their scale is not comparable across releases that calibrate to different target surfaces.",
        ],
        build_manifest: cal.build_manifest,
        release_manifest: cal.release_manifest,
        gates: asObject(cal.build_manifest.gates),
        calibration,
        highlights,
      }),
    );
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}
