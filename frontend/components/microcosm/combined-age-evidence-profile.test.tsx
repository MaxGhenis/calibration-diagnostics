import { describe,expect,test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { writtenCombinedAge } from "@/lib/microcosm/graph/fixtures/combined-age-exporter-written/read";
import { normalizeGraphAttachment } from "@/lib/microcosm/graph/attachment";
import { buildReceiptGraph } from "@/lib/microcosm/graph/adapter";
import { ReceiptGraphSurface } from "./receipt-graph-view";
import { CombinedAgeEvidenceProfile } from "./combined-age-evidence-profile";
const f=writtenCombinedAge();
const {projection,checks}=normalizeGraphAttachment(f.graph,f.manifest,f.manifestSha,f.build);
const payload=buildReceiptGraph(projection,f.manifest,f.build,checks);
const profile=payload.combined_age_profile!;
const markup=renderToStaticMarkup(<ReceiptGraphSurface payload={payload} mode="calibration_extension" selectedId="" onModeChange={()=>{}} onSelect={()=>{}} onClearSelection={()=>{}} canvas={<div data-testid="existing-canvas"/>}/>);
describe("combined age evidence surface",()=>{
  test("quality evidence leads and the original graph/inspector remain",()=>{
    expect(markup.indexOf("Combined survey · national ages")).toBeLessThan(markup.indexOf("Recorded execution"));
    expect(markup).toContain('data-testid="existing-canvas"');
    expect(markup).toContain("Steps, output first");
    expect(markup).toContain("What was checked before any of this was drawn");
    expect(markup).toContain("launch ineligible");
    expect(markup).toContain("Recorded geography gate failure");
  });
  test("all 18 bands have chart rows and an accessible exact-value table",()=>{
    expect((markup.match(/data-age-band=/g)||[])).toHaveLength(18);
    expect((markup.match(/<th scope="row"[^>]*>Age[s ]/g)||[])).toHaveLength(18);
    expect(markup).toContain("Age 85+ · zero support");
    expect(markup).toContain("Calibrated error (%)");
    expect(markup).toContain("Initial error (people)");
    expect(markup).toContain("Published SE");
    expect(markup).toContain("17 of 18 · 1 excluded");
    expect(markup).toContain("18 of 18 · 0 excluded");
    expect(markup).toContain("This solver did not consume them");
  });
  test("weights, anchors, source arms and scope are explicit",()=>{
    for (const text of ["Initial importance weights","Calibrated weights","CPS ASEC","ACS","Source observation-date harmonization","Incoming importance weights","Original design weights","Effective sample size (ESS)","Top 1% household weight share","PUF enrichment","Prior wages are outside"])
      expect(markup).toContain(text);
  });
  test("only recorded trajectory values appear with separate API final loss",()=>{
    expect(markup).toContain("API final loss");
    expect(markup).toContain("Convergence decision: unavailable");
    expect(markup).toContain("API final loss is separate from the last trajectory item");
    expect(markup).toContain("Epoch (zero based)");
    expect(markup).not.toContain("converged");
  });
  test("summary-only evidence draws no loss curve",()=>{
    const copy=structuredClone(profile);copy.age_calibration.trajectory.kind="recorded_summary";copy.age_calibration.trajectory.values=null;
    const summary=renderToStaticMarkup(<CombinedAgeEvidenceProfile profile={copy} nodes={payload.nodes}/>);
    expect(summary).toContain("Only a trajectory summary was recorded");
    expect(summary).not.toContain("<polyline");
    expect(summary).not.toContain("Recorded loss values");
  });
  test("materialization remains inspectable provenance, not a public execution",()=>{
    expect(payload.executions).toHaveLength(4);
    expect(markup).toContain("materialization receipt sha256");
    expect(markup).toContain("not a fifth public execution");
  });
});
