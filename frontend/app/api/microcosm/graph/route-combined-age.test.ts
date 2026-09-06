import { test,expect,spyOn } from "bun:test";
import { join } from "node:path";
import { writtenCombinedAge } from "@/lib/microcosm/graph/fixtures/combined-age-exporter-written/read";
import { GET } from "./route";
test("combined profile is reachable by exact candidate and manifest with no discovery index",async()=>{
  const f=writtenCombinedAge();
  const savedDir=process.env.MICROCOSM_QUALITY_US_DIR,savedUrl=process.env.MICROCOSM_QUALITY_US_BASE_URL;
  process.env.MICROCOSM_QUALITY_US_DIR=join(f.root,"candidate");delete process.env.MICROCOSM_QUALITY_US_BASE_URL;
  try {
    const ask=(candidate:string,sha=f.manifestSha)=>GET(new Request(`http://dashboard.test/api/microcosm/graph?country=us&candidate=${candidate}&manifest_sha256=${sha}`));
    const response=await ask(f.manifest.candidate_release_id);expect(response.status).toBe(200);
    const payload=await response.json();expect(payload.available).toBe(true);expect(payload.combined_age_profile.scope.households).toBe(20);
    expect(payload.binding.candidate_manifest_sha256).toBe(f.manifestSha);
    expect(payload.candidate.population.sha256).toBe(f.reference.population_sha256);
    expect(payload.executions).toHaveLength(4);
    const wrong=await (await ask("other-candidate")).json();expect(wrong.available).toBe(false);
    // A digest with no stored manifest is a transport-unavailable response,
    // distinct from an authenticated artifact whose bytes fail its hash.
    const log=spyOn(console,"error").mockImplementation(()=>{});
    try {
      const missingDigest="0".repeat(64);
      const wrongSha=await ask(f.manifest.candidate_release_id,missingDigest);
      expect(wrongSha.status).toBe(503);
      expect(wrongSha.headers.get("Cache-Control")).toBe("no-store");
      expect(await wrongSha.json()).toEqual({
        detail:`Candidate evidence could not be read: manifests/${missingDigest}.json.`,
        artifact_error:"partial_artifact",
      });
      expect(log).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); }
  } finally {
    if(savedDir===undefined)delete process.env.MICROCOSM_QUALITY_US_DIR;else process.env.MICROCOSM_QUALITY_US_DIR=savedDir;
    if(savedUrl===undefined)delete process.env.MICROCOSM_QUALITY_US_BASE_URL;else process.env.MICROCOSM_QUALITY_US_BASE_URL=savedUrl;
  }
});
