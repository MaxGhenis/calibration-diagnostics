// Invented aggregate evidence only. These bytes describe no real population.
import { createHash } from "node:crypto";
import type { CandidateQualityManifest } from "../../quality/types";
import type { ProjectionNode } from "../adapter";
export const h = (n: string) => n.repeat(64);
export const digestOf = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function inventedGraph() {
  const ids = ["a", "b", "c"];
  const source_sha256 = { invented_source: h("8") };
  const by_node = Object.fromEntries(ids.map((id, i) => [id, {kernel_ref: `test.${id}@1`, kernel_impl_hash: h(i === 2 ? "2" : "1")}]));
  const implementation_set = {sha256: createHash("sha256").update(ids.map(id => `${id}\t${by_node[id].kernel_impl_hash}\n`).join(""), "ascii").digest("hex"), by_node};
  const identity = {run_head:"a".repeat(40),run_receipt_sha256:h("1"),runner_sha256:h("2"),roster_sha256:h("3"),approval_sha256:h("4"),exporter_sha256:h("5"),operator_declaration_sha256:h("6"),runtime_identity_sha256:h("7")};
  const artifact = (i:number) => ({name:"result", artifact:"result",type:"test.aggregate",type_version:1,artifact_key:h(String(i+4)),numeric:"exact",tolerance:0});
  const node = (id:string, i:number, mode:string): ProjectionNode => ({
    id,label:`Invented ${id}`,group:"test",group_label:"Invented evidence",role:null,
    receipt_present:true,failed:false,blocked:false,gate_exception:false,execution_record:null,receipt_outcome:null,
    cache: mode === "cold" && i === 0 ? "computed" : "hit", node_key:h(String(i+1)),...by_node[id],
    determinism:"deterministic",numeric:"exact",tolerance:0,runtime_dependencies:[],seed:null,wall_time_seconds:0,
    frame_key:null,weight_key:null,phase:null,
    typed_inputs:i ? [{...artifact(i-1),name:"input",producer:ids[i-1],producer_key:h(String(i))}] : [],
    typed_outputs:[artifact(i)],opaque_artifact_keys:[],column_artifact_counts:[],column_artifact_total:0,gate:null,
    source_pins:[{key:"invented_source",label:"Invented source",sha256:h("8")}],
    measures:[{key:"aggregate_count",label:"Invented count",value:0}],
  });
  const executions = ["cold", "warm"].map(mode => ({mode,label:`Invented ${mode}`,description:"Invented cache evidence.",
    execution_manifest_sha256:h(mode === "cold" ? "a" : "b"), computation_content_key:h("c"),
    kernel_calls:mode === "cold" ? 1 : 0,source_preparation_calls:mode === "cold" ? 1 : 0,
    computed_count:mode === "cold" ? 1 : 0,cache_hit_count:mode === "cold" ? 2 : 3,
    failed_node_ids:[],blocked_node_ids:[],gate_exception_node_ids:[],nodes:ids.map((id,i)=>node(id,i,mode))}));
  const common = {country:"us",candidate_release_id:"test-invented-graph",run_id:"test-invented-run",...identity,implementation_set,source_sha256};
  const graph = {schema_version:"microcosm.graph_receipts.v1",...common,population_sha256:h("d"),period:"2024",entity:"household",period_basis:"operator_declared",period_reason:"Invented target period declaration.",computation_content_key:h("c"),provenance_note:"Invented authenticated aggregate evidence.",label_basis:"Invented presentation metadata.",coverage:{basis:"typed_artifacts",complete:false,reason:"Only declared typed artifacts are represented."},content_key_note:"Same output content can belong to distinct executions.",executions};
  const checks = Object.fromEntries(executions.map(e=>[e.mode,{population_sha256:h("d"),receipt_sha256:h(e.mode === "cold" ? "e" : "f"),execution_manifest_sha256:e.execution_manifest_sha256,computation_content_key:e.computation_content_key,kernel_calls:e.kernel_calls,source_preparation_calls:e.source_preparation_calls,direct_checkpoint_table_weight_parity:true,direct_real_engine_array_parity:true,money_33_fields_all_axes_parity:true}]));
  const build = {schema_version:"microcosm.graph_build_summary.v1",...common,graph_receipts_sha256:digestOf(graph),checks:{direct:{population_sha256:h("d"),receipt_sha256:h("0"),household_count:3,person_count:8,source_preparation_calls:1},...checks}};
  const manifest:CandidateQualityManifest = {schema_version:"microcosm.candidate_quality.v1",country:"us",candidate_release_id:common.candidate_release_id,run_id:common.run_id,created_at:"2026-09-05T00:00:00Z",execution_status:"completed",release_eligibility:{status:"excluded",reason:"Invented engineering fixture excluded from release."},population:{sha256:h("d"),period:"2024",entity:"household"},geography:null,provenance:{...identity,implementation_set_sha256:implementation_set.sha256},attachments:{graph_receipts:{status:"available",scope:"population",sha256:digestOf(graph),path:`artifacts/${digestOf(graph)}.json`,identity:{country:"us",candidate_release_id:common.candidate_release_id,run_id:common.run_id,population_sha256:h("d")}},build_manifest:{status:"available",scope:"run",sha256:digestOf(build),path:`artifacts/${digestOf(build)}.json`,identity:{country:"us",candidate_release_id:common.candidate_release_id,run_id:common.run_id}},calibration_diagnostics:{status:"missing",reason:"Calibration was not evaluated for this invented fixture."}}};
  return {graph,build,manifest,manifestSha:digestOf(manifest)};
}
