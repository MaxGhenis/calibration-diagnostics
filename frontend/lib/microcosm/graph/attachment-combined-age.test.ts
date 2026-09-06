import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { writtenCombinedAge } from "./fixtures/combined-age-exporter-written/read";
import { normalizeGraphAttachment } from "./attachment";
import { buildReceiptGraph, ReceiptGraphUnavailableError } from "./adapter";
import { COMBINED_AGE_MODES, COMBINED_AGE_NODES, COMBINED_AGE_PROFILE } from "./combined-age";

export function combinedPayload(size:20|200=20) {
  const f=writtenCombinedAge(size); const v=normalizeGraphAttachment(f.graph,f.manifest,f.manifestSha,f.build);
  return buildReceiptGraph(v.projection,f.manifest,f.build,v.checks);
}
describe("sealed combined-age exporter contract",() => {
  for (const size of [20,200] as const) {
    test(`${size} households: exact immutable bytes and complete four-pass reader`,() => {
      const f=writtenCombinedAge(size);
      for (const [path,sha] of [[f.reference.path,f.manifestSha],[f.manifest.attachments.graph_receipts.path,f.reference.graph_receipts_sha256],[f.manifest.attachments.build_manifest.path,f.reference.build_summary_sha256]])
        expect(createHash("sha256").update(readFileSync(join(f.root,"candidate",path!))).digest("hex")).toBe(sha);
      const p=combinedPayload(size);
      expect(p.combined_age_profile?.id).toBe(COMBINED_AGE_PROFILE);
      expect(p.combined_age_profile?.scope.households).toBe(size);
      expect(p.combined_age_profile?.age_calibration.cells).toHaveLength(18);
      expect(p.executions.map(e=>e.mode)).toEqual([...COMBINED_AGE_MODES]);
      expect(p.executions.map(e=>e.computed_count)).toEqual([9,0,2,0]);
      expect(p.nodes).toHaveLength(11);
      expect(p.nodes.find(n=>n.id===COMBINED_AGE_NODES[5])?.states.every(s=>s.execution === "failed")).toBe(true);
      expect(p.nodes.find(n=>n.id===COMBINED_AGE_NODES[9])?.states[0].execution).toBe("not_evidenced");
      expect(p.binding.population_sha256).toBe(f.reference.population_sha256);
      expect(p.evidence_profile).toBeUndefined();
      expect(p.comparison.same_computation_content_key).toBe(false);
      expect(p.comparison.title).toBe("Composition and calibration, four recorded executions");
      expect(p.comparison.execution_note).not.toContain("a shared computation content key");
      expect(p.mappings.find(m=>m.key==="calibration")?.state).toBe("present");
    });
  }
});
const mutations:Record<string,(f:ReturnType<typeof writtenCombinedAge>)=>void>={
  "contradictory evidence classification":f=>{f.graph.genuine=f.build.genuine=true;},
  "classification mismatch across attachments":f=>f.graph.invented_sources=false,
  "invented classification absent":f=>delete f.graph.invented_sources,
  "wrong source arm label":f=>f.graph.scope.source_arms[0].label="ACS",
  "profile only on graph":f=>delete f.build.profile,
  "unknown profile":f=>{f.graph.profile=f.build.profile="unknown";},
  "extra graph field":f=>f.graph.unreviewed="accepted",
  "wrong selected candidate":f=>f.manifest.candidate_release_id="another-candidate",
  "wrong run":f=>f.build.run_id="another-run",
  "wrong population":f=>f.manifest.population!.sha256="0".repeat(64),
  "weight digest as checkpoint":f=>{f.graph.population_sha256=f.manifest.population!.sha256=f.graph.provenance.calibrated_weights_sha256;},
  "mixed composition receipt":f=>f.graph.composition.run_receipt_sha256="0".repeat(64),
  "materialization provenance omitted":f=>delete f.graph.provenance.materialization_receipt_sha256,
  "public source path":f=>f.graph.quality.note="/private/source/path",
  "release eligibility":f=>f.manifest.release_eligibility.status="eligible",
  "missing cell":f=>f.graph.age_calibration.cells.pop(),
  "duplicate cell":f=>f.graph.age_calibration.cells[1]=f.graph.age_calibration.cells[0],
  "wrong band definition":f=>f.graph.age_calibration.cells[0].maximum_age=5,
  "wrong cell label":f=>f.graph.age_calibration.cells[0].label="Ages 5–9",
  "compiled target differs":f=>f.graph.age_calibration.cells[0].compiled_target+=1,
  "initial arithmetic":f=>f.graph.age_calibration.cells[0].initial_deviation+=1,
  "final arithmetic":f=>f.graph.age_calibration.cells[0].final_relative_deviation+=1,
  "nonfinite cell":f=>f.graph.age_calibration.cells[0].final_estimate=Infinity,
  "zero support presented as supported":f=>f.graph.age_calibration.cells.at(-1).support_status="supported",
  "zero support nonzero estimate":f=>f.graph.age_calibration.cells.at(-1).initial_estimate=1,
  "wrong support count":f=>f.graph.age_calibration.cells[0].supported_households=99999,
  "wrong source arms":f=>f.graph.scope.source_arms[0].households+=1,
  "unknown source arm":f=>f.graph.scope.source_arms[0].id="puf",
  "numeric vintage":f=>f.graph.scope.source_arms[0].source_vintages[0]=2024,
  "wrong person partition":f=>f.graph.age_calibration.cells[0].unweighted_people_in_band+=1,
  "excluded zero support silently":f=>f.graph.age_calibration.error_summary.all_cells.denominator=17,
  "wrong supported summary":f=>f.graph.age_calibration.error_summary.supported_cells.maximum_absolute_relative_deviation=0,
  "invented pass tolerance":f=>f.graph.age_calibration.tolerance=.1,
  "claimed SE consumption":f=>f.graph.age_calibration.consumes_standard_errors=true,
  "incorrect ESS fraction":f=>f.graph.age_calibration.weights.calibrated.effective_sample_size_fraction=.01,
  "incorrect weight count":f=>f.graph.age_calibration.weights.calibrated.positive_records+=1,
  "incorrect max share":f=>f.graph.age_calibration.weights.calibrated.maximum_weight_share=.9,
  "incorrect top one percent":f=>f.graph.age_calibration.weights.calibrated.top_1pct_count+=1,
  "swapped cap anchor":f=>f.graph.age_calibration.caps.executor.anchor="incoming_importance",
  "cap exceeded":f=>f.graph.age_calibration.caps.solver.realized=999,
  "manufactured convergence":f=>f.graph.age_calibration.solver.convergence_status="converged",
  "trajectory summary mismatch":f=>f.graph.age_calibration.trajectory.summary.last+=1,
  "interpolated summary trajectory":f=>f.graph.age_calibration.trajectory.kind="recorded_summary",
  "column provenance mismatch":f=>f.graph.age_calibration.column_provenance[0].source_sha256="0".repeat(64),
  "extra materialization execution":f=>f.graph.executions.push({...f.graph.executions[3],mode:"materialization"}),
  "wrong execution byte identity":f=>f.graph.executions[1].execution_manifest_sha256="0".repeat(64),
  "wrong content key":f=>f.graph.executions[0].computation_content_key=f.graph.computation_content_key,
  "wrong cache origin":f=>f.graph.executions[2].cache_origin="empty_composition_store",
  "wrong cache counts":f=>f.graph.executions[2].computed_count=11,
  "inherited node changed":f=>f.graph.executions[2].nodes[0].node_key="0".repeat(64),
  "roster node missing":f=>f.graph.executions[2].nodes.pop(),
  "gate verdict erased in every pass":f=>{for(const e of f.graph.executions)e.nodes[5].gate=null;},
  "gate verdict contradicts failed receipt":f=>{for(const e of f.graph.executions)e.nodes[5].gate={outcome:"pass",scope:"geography",passed:true,checks:[]};},
  "gate failure hidden":f=>f.graph.executions[1].failed_node_ids=[],
  "build verification false":f=>f.build.checks.all_18_targets_reconciled=false,
};
describe("closed combined profile refuses contradictory aggregates",()=>{
  for (const [label,mutate] of Object.entries(mutations)) test(label,()=>{const f=writtenCombinedAge();mutate(f);expect(()=>normalizeGraphAttachment(f.graph,f.manifest,f.manifestSha,f.build)).toThrow(ReceiptGraphUnavailableError);});
  test("summary-only trajectory remains a summary, and API final loss remains separate",()=>{
    const f=writtenCombinedAge();f.graph.age_calibration.trajectory.kind="recorded_summary";f.graph.age_calibration.trajectory.values=null;
    const {projection}=normalizeGraphAttachment(f.graph,f.manifest,f.manifestSha,f.build);
    expect(projection.combined_age_profile?.age_calibration.trajectory.values).toBeNull();
    expect(projection.combined_age_profile?.age_calibration.solver.final_loss).not.toBe(f.graph.age_calibration.trajectory.summary.last);
  });
});
