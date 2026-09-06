import type { CandidateQualityManifest } from "../quality/types";
import { ReceiptGraphUnavailableError, verifyExecutionStates, type ReceiptProjection, type ProjectionExecution, type ProjectionNode } from "./adapter";
import type { BindingCheck, ImplementationSet } from "./types";
import type { AgeCell, AgeWeights, CombinedAgeProfile } from "./combined-age-types";

export const COMBINED_AGE_PROFILE = "us_combined_asec_acs_national_age_v1";
export const COMBINED_AGE_NODES = [
  "composed_population.prepare", "composed_population", "assign_us_puma_ladder.lookup",
  "assign_us_puma_ladder.boundary", "assign_us_puma_ladder", "assign_us_puma_ladder.gate",
  "composed_population.asec_bind", "composed_population.asec_cps_carried_current",
  "composed_population.asec_reported_income", "national.age_counts", "national.demographic_calibration",
] as const;
export const COMBINED_AGE_MODES = ["composition_cold", "composition_warm", "calibration_extension", "calibration_replay"] as const;
const ROLES = ["composition_acceptance", "composition_run", "composition_cold_receipt", "composition_warm_receipt", "composition_cold_manifest", "composition_warm_manifest", "calibration_acceptance", "calibration_run", "calibration_extension_receipt", "calibration_replay_receipt", "calibration_extension_manifest", "calibration_replay_manifest", "materialization_receipt", "aggregate_verification", "checkpoint_readback", "diagnostics", "calibrated_manifest"];
const REVISIONS = ["composition_head", "calibration_head", "materializer_head"];
const HASHES = ["composition_runner_sha256", "calibration_runner_sha256", "materializer_sha256", "exporter_sha256", "base_exporter_sha256", "writer_sha256", ...ROLES.map(r => `${r}_sha256`), "root_binding_sha256", "calibrated_weights_sha256"];
const BUILD_CHECKS = ["pinned_aggregate_inputs", "accepted_composition_ancestry", "extension_and_replay_cache_origin", "all_18_targets_reconciled", "independent_support_reconciled", "checkpoint_file_identity_attested", "recorded_trajectory_verified", "no_source_or_population_reads", "release_excluded"];
const MISSING = ["Group-quarters representativeness", "Sex and household-reference mapping", "Source observation-date harmonization", "Housing transfer", "PUF enrichment", "National launch validation", "Congressional-district validation", "Pruned analysis"];
const REASON = "Local development age-calibration experiment; launch validation remains incomplete.";
const CONVENTION = "max(1, ceil(0.01 * all household rows))";
// The outer reader already applies the shared byte/depth bound. This table is
// deliberately separate from income-v3: four ancestry passes are not its
// direct/cold/warm parity contract, and no legacy shape is relaxed here.
type Obj = Record<string, any>;
type Check = (v: any) => void;
function require(ok: unknown): asserts ok { if (!ok) throw new ReceiptGraphUnavailableError("Combined survey age evidence disagrees with its closed profile or selected candidate."); }
function object(v: any): Obj { require(v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype); return v; }
function canonical(v: any): string { return JSON.stringify(v && typeof v === "object" ? Array.isArray(v) ? v.map(x => JSON.parse(canonical(x))) : Object.fromEntries(Object.keys(v).sort().map(k => [k, JSON.parse(canonical(v[k]))])) : v); }
const equal = (a: any,b: any) => require(canonical(a) === canonical(b));
function shape(v: any, fields: Record<string, Check>): Obj { const o = object(v); equal(Object.keys(o).sort(), Object.keys(fields).sort()); for (const [k,check] of Object.entries(fields)) check(o[k]); return o; }
const text: Check = v => require(typeof v === "string" && v.length > 0 && v.length <= 2048 && !/[\x00-\x1f\x7f/\\]/.test(v) && !/\.local|\.h5|macbook|person_id|household_id|_buildo-runtime/i.test(v));
const id: Check = v => { text(v); require(/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,159}$/.test(v)); };
const digest: Check = v => require(typeof v === "string" && /^[a-f0-9]{64}$/.test(v));
const revision: Check = v => require(typeof v === "string" && /^[a-f0-9]{40}$/.test(v));
const finite: Check = v => require(typeof v === "number" && Number.isFinite(v));
const number: Check = v => { finite(v); require(v >= 0); };
const count: Check = v => { number(v); require(Number.isSafeInteger(v)); };
const positive: Check = v => { number(v); require(v > 0); };
const nil: Check = v => require(v === null);
const bool: Check = v => require(typeof v === "boolean");
const literal = (expected: any): Check => v => equal(v, expected);
const nullable = (check: Check): Check => v => v === null ? nil(v) : check(v);
const array = (check: Check, max = 64, min = 0): Check => v => { require(Array.isArray(v) && v.length >= min && v.length <= max); for (const item of v) check(item); };
const fields = (keys: string[], check: Check) => Object.fromEntries(keys.map(k => [k,check]));
const unique = (v: any[]) => require(new Set(v).size === v.length);
const close = (a: number,b: number) => { finite(a); finite(b); require(Math.abs(a-b) <= Math.max(1e-8, 2e-6 * Math.max(Math.abs(a),Math.abs(b)))); };
const provenance: Check = v => shape(v, { ...fields(REVISIONS, revision), ...fields(HASHES,digest) });
const eligibility: Check = v => shape(v, {status:literal("excluded"),reason:literal(REASON)});
const scope: Check = v => {
  const s = shape(v, {households: count, persons: count,
    entity_rows: array(r => shape(r,{entity:id,rows:count}),16,2),
    source_arms: array(r => shape(r,{id, label:text, households:count, persons:count, source_vintages:array(text,12,1)}),2,2)});
  require(s.households > 0 && s.persons >= s.households);
  unique(s.entity_rows.map((r: Obj) => r.entity));
  equal(s.entity_rows.find((r:Obj) => r.entity === "household")?.rows,s.households);
  equal(s.entity_rows.find((r:Obj) => r.entity === "person")?.rows,s.persons);
  equal(s.source_arms.map((r:Obj) => r.id).sort(),["acs","asec"]);
  for (const arm of s.source_arms) { equal(arm.label,arm.id === "asec" ? "CPS ASEC" : "ACS"); require(arm.persons >= arm.households); unique(arm.source_vintages); }
  for (const key of ["households","persons"]) equal(s.source_arms.reduce((total:number,r:Obj) => total+r[key],0),s[key]);
};
const composition: Check = v => shape(v,fields(["checkpoint_sha256","run_receipt_sha256","acceptance_sha256","computation_content_key"],digest));
const quality: Check = v => shape(v,{status:literal("incomplete"),basis:literal("age_only_development_calibration"),score:nil,missing:literal(MISSING),note:text});
const cell: Check = v => shape(v,{cell:id,measure:id,label:text,minimum_age:count,maximum_age:nullable(count),
  ...fields(["published_value","published_se","compiled_target","initial_estimate","final_estimate"],number),
  ...fields(["initial_deviation","final_deviation","initial_relative_deviation","final_relative_deviation"],finite),
  ...fields(["supported_households","unweighted_people_in_band","maximum_band_count_in_a_household"],count),
  support_status:v => require(["supported","zero_support"].includes(v)),within_tolerance:nil});
const weights: Check = v => shape(v,{
  ...fields(["records","positive_records","zero_records","top_1pct_count"],count),
  ...fields(["total","minimum","maximum","maximum_weight_share","effective_sample_size","effective_sample_size_fraction","top_1pct_weight_share"],number),top_1pct_convention:literal(CONVENTION)});
const errorSummary: Check = v => shape(v,{denominator:count,excluded_cells:count,maximum_absolute_relative_deviation:nullable(number)});
const age: Check = v => shape(v,{target_year:literal(2024),consumes_standard_errors:literal(false),tolerance:nil,tolerance_status:literal("unavailable"),
  cells:array(cell,18,18),error_summary:v => shape(v,{all_cells:errorSummary,supported_cells:errorSummary}),
  weights:v => shape(v,{initial_importance:weights,calibrated:weights}),
  caps:v => shape(v,Object.fromEntries(["executor","solver"].map(role => [role,(v:any) => shape(v,{anchor:literal(role === "executor" ? "original_design" : "incoming_importance"),max_weight_ratio:positive,realized:number})]))),
  solver:v => shape(v,{method:id,epochs:count,learning_rate:positive,seed:count,mass:id,initial_loss:number,final_loss:number,convergence_status:literal("unavailable"),diagnostic_warnings:array(text)}),
  trajectory:v => shape(v,{kind:v => require(["complete_recorded","recorded_summary"].includes(v)),
    summary:v => shape(v,{epochs_recorded:count,first:number,last:number,minimum:number,argmin_epoch:count,monotone_nonincreasing_steps:count,total_steps:count,monotone_nonincreasing:bool,last10_relative_change:nullable(finite)}),values:nullable(array(number,4096,1))}),
  column_provenance:array(v => shape(v,{columns:array(id,16,1),source_role:id,source_sha256:digest}),3,3)});

function reconcileAge(g: Obj) {
  const a = g.age_calibration as CombinedAgeProfile["age_calibration"];
  unique(a.cells.map(c => c.cell));
  a.cells.forEach((c,index) => {
    equal(c.cell,`S0101_C01_${String(index+2).padStart(3,"0")}`);
    equal(c.measure,index === 17 ? "people_age_85_plus" : `people_age_${index*5}_${index*5+4}`);
    equal(c.minimum_age,index*5); equal(c.maximum_age,index === 17 ? null : index*5+4);
    equal(c.label,index === 17 ? "Age 85+" : `Ages ${index*5}–${index*5+4}`);
    require(c.published_value > 0); equal(c.published_value,c.compiled_target);
    for (const phase of ["initial","final"] as const) {
      close(c[`${phase}_deviation`], c[`${phase}_estimate`]-c.compiled_target);
      close(c[`${phase}_relative_deviation`], c[`${phase}_deviation`]/c.compiled_target);
    }
    const h=c.supported_households,p=c.unweighted_people_in_band,m=c.maximum_band_count_in_a_household;
    require(h <= g.scope.households && h <= p && p <= g.scope.persons && m <= p);
    require(h === 0 ? p === 0 && m === 0 : m >= 1 && m+h-1 <= p && p <= h*m);
    equal(c.support_status,h ? "supported" : "zero_support");
    if (!h) { equal(c.initial_estimate,0); equal(c.final_estimate,0); }
  });
  equal(a.cells.reduce((sum,c) => sum+c.unweighted_people_in_band,0),g.scope.persons);
  for (const [key,rows] of [["all_cells",a.cells],["supported_cells",a.cells.filter(c => c.supported_households > 0)]] as const) {
    const s=a.error_summary[key]; equal(s.denominator,rows.length); equal(s.excluded_cells,18-rows.length);
    const max=rows.length ? Math.max(...rows.map(c => Math.abs(c.final_relative_deviation))) : null;
    if (max === null) equal(s.maximum_absolute_relative_deviation,null); else { require(s.maximum_absolute_relative_deviation !== null); close(s.maximum_absolute_relative_deviation,max); }
  }
  for (const w of Object.values(a.weights)) reconcileWeights(w,g.scope.households);
  for (const c of Object.values(a.caps)) require(c.realized <= c.max_weight_ratio*(1+2e-6));
  const {summary:s,values,kind}=a.trajectory;
  require(s.epochs_recorded > 0 && s.epochs_recorded <= a.solver.epochs && s.argmin_epoch < s.epochs_recorded);
  equal(s.total_steps,s.epochs_recorded-1); require(s.monotone_nonincreasing_steps <= s.total_steps);
  equal(s.monotone_nonincreasing,s.monotone_nonincreasing_steps === s.total_steps);
  require(s.minimum <= s.first && s.minimum <= s.last);
  if (kind === "recorded_summary") equal(values,null);
  else {
    require(values !== null); equal(values.length,a.solver.epochs); equal(values.length,s.epochs_recorded);
    close(s.first,values[0]); close(s.last,values.at(-1)!); close(s.minimum,Math.min(...values)); equal(s.argmin_epoch,values.indexOf(Math.min(...values)));
    equal(s.monotone_nonincreasing_steps,values.slice(1).filter((v,i) => v <= values[i]).length);
    const tail=values.slice(-10); const change=tail[0] === 0 ? null : (tail.at(-1)!-tail[0])/Math.abs(tail[0]);
    if (change === null) equal(s.last10_relative_change,null); else { require(s.last10_relative_change !== null); close(s.last10_relative_change,change); }
  }
  // API final loss is a separate recorded diagnostic; do not equate it with
  // the final trajectory sample or infer a convergence decision from either.
  const attribution = [
    {columns:["published_value","published_se","compiled_target"],source_role:"calibration_replay_receipt"},
    {columns:["initial_estimate","final_estimate","trajectory"],source_role:"diagnostics"},
    {columns:["supported_households","unweighted_people_in_band","maximum_band_count_in_a_household","weights"],source_role:"aggregate_verification"},
  ];
  equal(a.column_provenance,attribution.map(p => ({...p,source_sha256:g.provenance[`${p.source_role}_sha256`]})));
}
function reconcileWeights(w:AgeWeights,households:number) {
  equal(w.records,households); equal(w.positive_records+w.zero_records,households);
  require(w.total > 0 && w.minimum <= w.maximum && w.maximum <= w.total);
  require(w.zero_records > 0 ? w.minimum === 0 : w.minimum > 0);
  require(w.minimum*households <= w.total*(1+2e-6) && w.maximum*w.positive_records >= w.total*(1-2e-6));
  close(w.maximum_weight_share,w.maximum/w.total);
  require(w.effective_sample_size > 0 && w.effective_sample_size <= w.positive_records+1e-7);
  close(w.effective_sample_size_fraction,w.effective_sample_size/households);
  equal(w.top_1pct_count,Math.max(1,Math.ceil(.01*households)));
  require(w.maximum_weight_share <= w.top_1pct_weight_share && w.top_1pct_weight_share <= 1);
  require(w.top_1pct_weight_share <= w.top_1pct_count*w.maximum_weight_share+1e-7);
}

export function normalizeCombinedAgeAttachment(raw:unknown, manifest:CandidateQualityManifest, manifestSha:string, rawBuild:unknown,
  shared:{node:Check;implementation:Check}):{projection:ReceiptProjection;checks:BindingCheck[]} {
  const common = {profile:literal(COMBINED_AGE_PROFILE),genuine:bool,invented_sources:bool,country:literal("us"),candidate_release_id:id,run_id:id,provenance,execution_status:literal("completed"),release_eligibility:eligibility};
  const g=shape(raw,{schema_version:literal("microcosm.graph_receipts.v1"),...common,population_sha256:digest,period:literal("2024"),entity:literal("household"),period_basis:literal("target_year"),period_reason:text,computation_content_key:digest,scope,composition,quality,age_calibration:age,implementation_set:shared.implementation,
    executions:array(v => shape(v,{mode:id,label:text,description:text,execution_manifest_sha256:digest,computation_content_key:digest,kernel_calls:count,source_preparation_calls:count,computed_count:count,cache_hit_count:count,failed_node_ids:array(id),blocked_node_ids:array(id),gate_exception_node_ids:array(id),nodes:array(shared.node,11,9),cache_origin:id,source_composition_receipt_sha256:digest}),4,4)});
  const b=shape(rawBuild,{schema_version:literal("microcosm.graph_build_summary.v1"),...common,graph_receipts_sha256:digest,checks:v => shape(v,fields(BUILD_CHECKS,literal(true)))});
  for (const k of Object.keys(common)) equal(g[k],b[k]);
  equal(g.genuine,!g.invented_sources);
  for (const k of ["country","candidate_release_id","run_id","provenance","execution_status","release_eligibility"]) equal(g[k],manifest[k as keyof CandidateQualityManifest]);
  equal(manifest.population,{sha256:g.population_sha256,period:g.period,entity:g.entity});
  require(/observation dates.*not harmonized|observation dates.*unharmonized/i.test(g.period_reason));
  const descriptor=manifest.attachments.graph_receipts, buildDescriptor=manifest.attachments.build_manifest;
  require(descriptor?.status === "available" && descriptor.scope === "population" && buildDescriptor?.status === "available" && buildDescriptor.scope === "run");
  digest(descriptor.sha256); digest(buildDescriptor.sha256); equal(b.graph_receipts_sha256,descriptor.sha256);
  require(g.population_sha256 !== g.provenance.calibrated_weights_sha256 && g.population_sha256 !== g.composition.checkpoint_sha256);
  equal(g.composition.run_receipt_sha256,g.provenance.composition_run_sha256); equal(g.composition.acceptance_sha256,g.provenance.composition_acceptance_sha256);
  equal(Object.keys(g.implementation_set.by_node).sort(),[...COMBINED_AGE_NODES].sort());
  equal(g.executions.map((e:Obj) => e.mode),COMBINED_AGE_MODES); unique(g.executions.map((e:Obj) => e.execution_manifest_sha256));
  const contracts=new Map<string,string>();
  const executions:ProjectionExecution[]=g.executions.map((e:Obj,index:number) => {
    const ids=COMBINED_AGE_NODES.slice(0,index < 2 ? 9 : 11);
    equal(e.nodes.map((n:Obj) => n.id),ids);
    equal(e.execution_manifest_sha256,g.provenance[`${e.mode}_manifest_sha256`]);
    equal(e.source_composition_receipt_sha256,g.composition.run_receipt_sha256);
    equal(e.computation_content_key,index < 2 ? g.composition.computation_content_key : g.computation_content_key);
    require(e.execution_manifest_sha256 !== e.computation_content_key);
    equal(e.cache_origin,["empty_composition_store","same_composition_store","mirror_of_accepted_composition_store","same_calibration_store"][index]);
    equal(e.source_preparation_calls,index === 0 ? 1 : 0);
    equal(e.kernel_calls,[9,0,2,0][index]); equal(e.computed_count,e.kernel_calls); equal(e.cache_hit_count,ids.length-e.kernel_calls);
    const result={...e,manifest_sha256:e.execution_manifest_sha256,content_key:e.computation_content_key} as ProjectionExecution;
    verifyExecutionStates(result);
    equal(e.failed_node_ids,e.nodes.filter((n:Obj) => n.failed).map((n:Obj) => n.id));
    for (const n of e.nodes as ProjectionNode[]) {
      equal(n.cache,index === 0 || index === 2 && COMBINED_AGE_NODES.indexOf(n.id as any) >= 9 ? "computed" : "hit");
      require(n.receipt_present && !n.blocked && n.node_key !== null);
      require(!n.failed && !n.gate_exception || n.id === "assign_us_puma_ladder.gate" && n.failed);
      equal(n.failed,n.receipt_outcome === "fail");
      if (n.id === "assign_us_puma_ladder.gate") {
        require(n.gate !== null && ["pass","fail"].includes(n.receipt_outcome!));
        equal(n.gate.outcome,n.receipt_outcome); equal(n.gate.passed,!n.failed);
      }
      equal(n.kernel_ref,g.implementation_set.by_node[n.id].kernel_ref); equal(n.kernel_impl_hash,g.implementation_set.by_node[n.id].kernel_impl_hash);
      equal(n.source_pins,[]);
      // Cache/wall-time describe the execution; all remaining fields belong to
      // the inherited computation. A changed node key or output is not reuse.
      const {cache:_cache,wall_time_seconds:_time,...contract}=n;
      const serialized=canonical(contract), previous=contracts.get(n.id);
      if (previous !== undefined) equal(serialized,previous); else contracts.set(n.id,serialized);
      for (const input of n.typed_inputs) {
        const producer=e.nodes.find((p:Obj) => p.id === input.producer) as ProjectionNode | undefined;
        require(producer && producer.id !== n.id && ids.indexOf(producer.id as any) < ids.indexOf(n.id as any));
        equal(input.producer_key,producer.node_key);
        const output=producer.typed_outputs.filter(o => o.artifact === input.artifact); require(output.length === 1);
        const {name:_name,producer:_producer,producer_key:_key,...identity}=input;
        const {name:_outputName,...outputIdentity}=output[0]; equal(identity,outputIdentity);
        require(input.artifact_key !== null && input.type !== null && input.type_version !== null);
      }
    }
    return result;
  });
  require(g.composition.computation_content_key !== g.computation_content_key);
  reconcileAge(g);
  const reading:CombinedAgeProfile={id:COMBINED_AGE_PROFILE,genuine:g.genuine,period_reason:g.period_reason,scope:g.scope,composition:g.composition,quality:g.quality,age_calibration:g.age_calibration,executions:g.executions.map((e:Obj) => ({mode:e.mode,cache_origin:e.cache_origin,source_composition_receipt_sha256:e.source_composition_receipt_sha256})),identities:Object.entries(g.provenance).map(([key,sha256]) => ({key,sha256:sha256 as string}))};
  const checks:BindingCheck[]=[{label:"Candidate and aggregate attachments",detail:"Selected manifest, calibrated checkpoint file identity, graph bytes and run-scoped build summary agree. Composition checkpoint and calibrated weights retain separate identities."},
    {label:"Recorded composition and calibration ancestry",detail:"Four execution manifests bind nine inherited composition nodes and two added calibration nodes. Typed producer references, implementations, cache origins and recorded gate failures were checked across passes. Materialization is provenance only."},
    {label:"National age evidence",detail:"All 18 age cells, source-arm counts, errors, support, weight diagnostics, cap anchors and recorded trajectory were reconciled. No acceptance tolerance or convergence decision is available."}];
  return {projection:{schema_version:"microcosm.graph_receipts.v1",projection_version:1,is_publisher_attachment:true,basis:"authenticated_attachment",implementation_set:g.implementation_set as ImplementationSet,
    provenance_note:"Aggregate receipts from accepted composition, age calibration and cache-only checkpoint materialization. The dashboard reads no population or raw source payloads.",label_basis:"Labels describe the fixed declared profile; links use only recorded typed producer references.",coverage:{basis:"typed_artifact_receipts",complete:false,reason:"The diagram includes recorded typed artifact dependencies; it does not infer unrecorded column or population relationships."},
    country:g.country,candidate_release_id:g.candidate_release_id,candidate_manifest_sha256:manifestSha,run_id:g.run_id,population_sha256:g.population_sha256,build_evidence_sha256:buildDescriptor.sha256!,kernel_impl_hash:null,computation_content_key:g.computation_content_key,
    content_key_note:"Composition and calibration have distinct computation content keys. Replay keeps each phase's content key; execution-manifest byte digests remain separate.",combined_age_profile:reading,executions},checks};
}
