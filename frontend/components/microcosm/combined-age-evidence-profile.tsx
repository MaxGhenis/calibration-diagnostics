"use client";

import { useState } from "react";
import type { CombinedAgeProfile, AgeWeights } from "@/lib/microcosm/graph/combined-age-types";
import type { ReceiptGraphNode } from "@/lib/microcosm/graph/types";

const number = (value:number, digits=0) => value.toLocaleString("en-US",{maximumFractionDigits:digits});
const percent = (value:number, signed=false) => `${signed && value > 0 ? "+" : ""}${number(value*100,2)}%`;
const decimal = (value:number) => value.toLocaleString("en-US",{maximumSignificantDigits:5});
const SERIES = [
  {key:"published_value",label:"Published population",color:"var(--chart-3)",mark:"━"},
  {key:"initial_estimate",label:"Initial importance weights",color:"var(--chart-2)",mark:"┄"},
  {key:"final_estimate",label:"Calibrated weights",color:"var(--chart-1)",mark:"●"},
] as const;
const sectionClass="border-t border-border py-6";
const headingClass="text-base font-semibold tracking-tight text-foreground";
const noteClass="text-xs leading-relaxed text-muted-foreground";
const cellClass="whitespace-nowrap px-3 py-2 tabular-nums";
const weightCellClass="px-2 py-2 text-right align-top tabular-nums";
const anchorLabel=(anchor:string) => anchor === "original_design" ? "Original design weights" : "Incoming importance weights";
const originLabels:Record<string,string>={empty_composition_store:"Empty composition store",same_composition_store:"Same composition store",mirror_of_accepted_composition_store:"Mirror of the accepted composition store",same_calibration_store:"Same calibration store"};

/** Main evidence comes before graph inspection. Every numerical value is from
 * the closed aggregate profile; SVGs only locate those recorded values. */
export function CombinedAgeEvidenceProfile({profile,nodes}:{profile:CombinedAgeProfile;nodes:ReceiptGraphNode[]}) {
  const [showTable,setShowTable]=useState(true);
  const {scope,age_calibration:age}=profile;
  const maxEstimate=Math.max(...age.cells.flatMap(c=>SERIES.map(s=>c[s.key])));
  const zeroSupport=age.cells.filter(c=>c.support_status === "zero_support").length;
  const failedGates=nodes.filter(n=>n.states.some(s=>s.gate === "fail"));
  const trajectory=age.trajectory;
  const losses=trajectory.values;
  const lossMax=losses ? Math.max(...losses) : 0;
  const lossMin=losses ? Math.min(...losses) : 0;
  const lossRange=lossMax-lossMin || 1;
  const points=losses?.map((value,i)=>`${20+i/Math.max(1,losses.length-1)*560},${130-(value-lossMin)/lossRange*100}`).join(" ");
  const weightRows:{label:string;key:keyof AgeWeights;format:(v:number)=>string}[]=[
    {label:"Effective sample size (ESS)",key:"effective_sample_size",format:v=>number(v,2)},
    {label:"ESS as share of households",key:"effective_sample_size_fraction",format:v=>percent(v)},
    {label:"Largest household weight share",key:"maximum_weight_share",format:v=>percent(v)},
    {label:"Top 1% household weight share",key:"top_1pct_weight_share",format:v=>percent(v)},
    {label:"Positive household weights",key:"positive_records",format:v=>number(v)},
    {label:"Zero household weights",key:"zero_records",format:v=>number(v)},
    {label:"Total household weight",key:"total",format:v=>number(v,2)},
    {label:"Minimum household weight",key:"minimum",format:v=>number(v,2)},
    {label:"Maximum household weight",key:"maximum",format:v=>number(v,2)},
  ];
  return (
    <article data-evidence-profile={profile.id} className="min-w-0 text-sm" aria-label="Combined survey national age evidence">
      <div className="border-t border-border pt-5">
        {!profile.genuine ? <p className="mb-3 text-xs font-medium text-muted-foreground">Invented fixture · these values demonstrate the evidence view and do not describe a genuine population.</p> : null}
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 className="text-xl font-semibold tracking-tight">Combined survey · national ages</h2>
          <span className="pill-warn text-xs">Age-only development · launch ineligible</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">2024 published age targets compared with this candidate’s recorded household weights. Quality remains incomplete; no score or acceptance tolerance is defined.</p>
        <div className="mt-5 flex flex-wrap gap-x-10 gap-y-3 tabular-nums" aria-label="Measured sample">
          <p><strong className="mr-2 text-2xl font-semibold text-foreground">{number(scope.households)}</strong>households</p>
          <p><strong className="mr-2 text-2xl font-semibold text-foreground">{number(scope.persons)}</strong>people</p>
        </div>
        <div className="mt-4 flex h-2 overflow-hidden rounded-sm" aria-hidden="true">
          {scope.source_arms.map((arm,i)=><span key={arm.id} style={{width:`${arm.households/scope.households*100}%`,backgroundColor:`var(--chart-${i+1})`}} />)}
        </div>
        <ul className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2" aria-label="Recorded source arms">
          {scope.source_arms.map((arm,i)=><li key={arm.id} className="flex gap-2.5">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-sm" style={{backgroundColor:`var(--chart-${i+1})`}} aria-hidden="true" />
            <div><strong className="font-medium">{arm.label}</strong> · {number(arm.households)} households · {number(arm.persons)} people
              <p className={noteClass}>Recorded source vintages: {arm.source_vintages.join(", ")}</p></div>
          </li>)}
        </ul>
        <p className={`mt-4 ${noteClass}`}>{profile.period_reason}</p>
        {failedGates.length ? <p className="mt-4 border-l-2 border-[var(--warn)] pl-3 text-sm" role="note"><strong>Recorded geography gate failure.</strong> {failedGates.map(n=>n.label).join(", ")} failed in the recorded evidence. Its gate verdict remains visible in every pass below; completed execution does not mean all gates passed.</p> : null}
      </div>

      <section className={`mt-6 ${sectionClass}`} aria-labelledby="age-estimates-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="age-estimates-heading" className={headingClass}>Population by age band</h3>
          <span className={noteClass}>All 18 bands · {zeroSupport} with zero sample support</span>
        </div>
        <div className="my-4 flex flex-wrap gap-x-6 gap-y-2 text-xs" aria-label="Age estimate legend">
          {SERIES.map(s=><span key={s.key} className="flex items-center gap-2"><span aria-hidden="true" className="font-mono text-lg leading-none" style={{color:s.color}}>{s.mark}</span>{s.label}</span>)}
        </div>
        <figure aria-label="Age estimates compared on a common population scale; exact values and errors are in the table below.">
          <div className="ml-16 flex justify-between pb-1 text-[11px] tabular-nums text-muted-foreground" aria-hidden="true"><span>0</span><span>{number(maxEstimate/2)} people</span><span>{number(maxEstimate)}</span></div>
          <div className="divide-y divide-border/50">
            {age.cells.map(c=><div key={c.cell} data-age-band={c.cell} data-support={c.support_status} className={`grid grid-cols-[4rem_minmax(0,1fr)] items-center py-1 ${c.support_status === "zero_support" ? "bg-muted/40" : ""}`}>
              <span className="text-xs tabular-nums">{c.maximum_age === null ? "85+" : `${c.minimum_age}–${c.maximum_age}`}{c.support_status === "zero_support" ? <span className="ml-1" aria-label="Zero sample support">†</span> : null}</span>
              <svg viewBox="0 0 1000 26" preserveAspectRatio="none" className="h-6 w-full" aria-hidden="true">
                {[0,500,998].map(x=><line key={x} x1={x} x2={x} y1="0" y2="26" stroke="var(--border)" strokeWidth="1"/>)}
                {SERIES.map((s,i)=><line key={s.key} x1="0" x2={c[s.key]/maxEstimate*990} y1={5+i*8} y2={5+i*8} stroke={s.color} strokeWidth="3" strokeDasharray={i===1 ? "6 3" : undefined}/>)}
                <circle cx={c.final_estimate/maxEstimate*990} cy="21" r="3" fill="var(--chart-1)"/>
              </svg>
            </div>)}
          </div>
          <figcaption className={`mt-3 ${noteClass}`}>† Zero support means no sampled household contains a person in that band. Its estimates remain zero and its recorded error stays in the comparison.</figcaption>
        </figure>
        <p className={`mt-3 ${noteClass}`}>Published standard errors describe source uncertainty. This solver did not consume them. Relative error is (estimate − published population) ÷ published population; no tolerance verdict is available.</p>
        <button type="button" onClick={()=>setShowTable(v=>!v)} aria-expanded={showTable} aria-controls="age-estimates-table" className="mt-4 rounded-sm text-xs font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{showTable ? "Hide" : "Show"} exact estimates, errors and support</button>
        <div id="age-estimates-table" hidden={!showTable} className="mt-3 overflow-x-auto rounded-sm border-y border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" tabIndex={showTable ? 0 : -1} role="region" aria-label="Scrollable age estimate table">
          <table className="w-full text-xs">
            <caption className="sr-only">All 18 age bands including zero support; published standard error, initial importance and calibrated estimates, their relative errors, and unweighted support.</caption>
            <thead className="bg-muted/30"><tr>
              {["Age","Published population","Published SE","Initial importance weights","Initial error (people)","Initial error (%)","Calibrated weights","Calibrated error (people)","Calibrated error (%)","Supporting households","Unweighted people"].map((h,i)=><th key={h} scope="col" className={`${cellClass} font-medium ${i===0 ? "text-left" : "text-right"}`}>{h}</th>)}
            </tr></thead>
            <tbody>{age.cells.map(c=><tr key={c.cell} className={`border-t border-border/60 ${c.support_status === "zero_support" ? "bg-muted/40" : ""}`}>
              <th scope="row" className={`${cellClass} text-left font-medium`}>{c.label}{c.support_status === "zero_support" ? " · zero support" : ""}</th>
              {[number(c.published_value,2),number(c.published_se,2),number(c.initial_estimate,2),number(c.initial_deviation,2),percent(c.initial_relative_deviation,true),number(c.final_estimate,2),number(c.final_deviation,2),percent(c.final_relative_deviation,true),number(c.supported_households),number(c.unweighted_people_in_band)].map((v,i)=><td key={i} className={`${cellClass} text-right`}>{v}</td>)}
            </tr>)}</tbody>
          </table>
        </div>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          {([['all_cells','All age cells'],['supported_cells','Supported age cells']] as const).map(([key,label])=>{const s=age.error_summary[key];return <div key={key}><dt className="font-medium">{label} · {s.denominator} of 18 · {s.excluded_cells} excluded</dt><dd className="mt-1 text-muted-foreground">Maximum absolute calibrated relative error: <span className="font-mono text-foreground">{s.maximum_absolute_relative_deviation === null ? "Unavailable" : percent(s.maximum_absolute_relative_deviation)}</span></dd></div>;})}
        </dl>
      </section>

      <section className={sectionClass} aria-labelledby="age-weights-heading">
        <h3 id="age-weights-heading" className={headingClass}>Weight concentration and effective sample size</h3>
        <p className={`mt-2 ${noteClass}`}>ESS describes the concentration of household weights. It is a diagnostic, not a measure of representativeness or a launch pass.</p>
        <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable household weight diagnostics">
          <table className="w-full table-fixed text-xs"><caption className="sr-only">Initial and calibrated household weight diagnostics</caption><thead><tr><th scope="col" className="w-[46%] px-2 py-2 text-left align-top">Diagnostic</th><th scope="col" className={weightCellClass}>Initial importance weights</th><th scope="col" className={weightCellClass}>Calibrated weights</th></tr></thead>
            <tbody>{weightRows.map(row=><tr className="border-t border-border/60" key={row.key}><th scope="row" className="px-2 py-2 text-left align-top font-normal">{row.label}</th>{(["initial_importance","calibrated"] as const).map(role=><td key={role} className={weightCellClass}>{row.format(age.weights[role][row.key] as number)}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <p className={`mt-3 ${noteClass}`}>The top 1% includes {age.weights.calibrated.top_1pct_count} household{age.weights.calibrated.top_1pct_count===1 ? "" : "s"}: 1% of all household rows, rounded up, with at least one row.</p>
        <dl className="mt-4 grid gap-4 text-xs sm:grid-cols-2">{(["executor","solver"] as const).map(role=><div key={role}><dt className="font-medium">{role === "executor" ? "Executor" : "Solver"} weight cap · {anchorLabel(age.caps[role].anchor)}</dt><dd className="mt-1 text-muted-foreground">Allowed ratio {decimal(age.caps[role].max_weight_ratio)}× · realized {decimal(age.caps[role].realized)}×, relative to this anchor.</dd></div>)}</dl>
      </section>

      <section className={sectionClass} aria-labelledby="age-loss-heading">
        <h3 id="age-loss-heading" className={headingClass}>Recorded solver loss</h3>
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-xs tabular-nums"><span>API initial loss <strong>{decimal(age.solver.initial_loss)}</strong></span><span>API final loss <strong>{decimal(age.solver.final_loss)}</strong></span><span>Convergence decision: unavailable</span></div>
        {losses ? <figure className="mt-4" aria-label={`Complete recorded loss trajectory: ${losses.length} epochs. First ${decimal(trajectory.summary.first)}, last ${decimal(trajectory.summary.last)}, minimum ${decimal(trajectory.summary.minimum)} at epoch ${trajectory.summary.argmin_epoch}.`}>
          <svg viewBox="0 0 600 155" className="h-40 w-full" role="img" aria-label="Recorded loss, without interpolation or smoothing">
            <line x1="20" x2="580" y1="130" y2="130" stroke="var(--border)"/>
            <polyline points={points} fill="none" stroke="var(--chart-1)" strokeWidth="2"/>
            {losses.length<=24 ? losses.map((loss,i)=><circle key={i} cx={20+i/Math.max(1,losses.length-1)*560} cy={130-(loss-lossMin)/lossRange*100} r="3" fill="var(--chart-1)"/>) : null}
            <text x="20" y="151" fill="var(--muted-foreground)" fontSize="11">Epoch 0</text><text x="580" y="151" textAnchor="end" fill="var(--muted-foreground)" fontSize="11">Epoch {losses.length-1}</text>
            <text x="20" y="18" fill="var(--muted-foreground)" fontSize="11">Loss range {decimal(lossMin)}–{decimal(lossMax)}</text>
          </svg>
          <figcaption className={noteClass}>{losses.length} recorded epochs. Straight segments connect recorded values; no missing epochs are generated. API final loss is separate from the last trajectory item.</figcaption>
        </figure> : <p className={`mt-4 ${noteClass}`}>Only a trajectory summary was recorded. No curve is drawn and no epochs are interpolated.</p>}
        <p className={`mt-3 ${noteClass}`}>Trajectory: first {decimal(trajectory.summary.first)} · last {decimal(trajectory.summary.last)} · minimum {decimal(trajectory.summary.minimum)} at epoch {trajectory.summary.argmin_epoch} (zero based).</p>
        <details className="mt-4 text-xs"><summary className="cursor-pointer font-medium">Solver configuration and recorded values</summary>
          <p className={`mt-2 ${noteClass}`}>{age.solver.method} · {age.solver.epochs} epochs · learning rate {age.solver.learning_rate} · seed {age.solver.seed} · mass {age.solver.mass}</p>
          {losses ? <div className="mt-2 max-h-48 overflow-auto" tabIndex={0} role="region" aria-label="Recorded loss values"><table className="w-full text-xs"><thead><tr><th scope="col" className={`${cellClass} text-left`}>Epoch (zero based)</th><th scope="col" className={`${cellClass} text-right`}>Recorded loss</th></tr></thead><tbody>{losses.map((loss,i)=><tr key={i}><th scope="row" className={`${cellClass} text-left font-normal`}>{i}</th><td className={`${cellClass} text-right`}>{decimal(loss)}</td></tr>)}</tbody></table></div> : null}
          {age.solver.diagnostic_warnings.length ? <ul className="mt-2 list-disc pl-5">{age.solver.diagnostic_warnings.map(w=><li key={w}>{w}</li>)}</ul> : <p className={`mt-2 ${noteClass}`}>No diagnostic warnings were recorded.</p>}
        </details>
      </section>

      <section className={sectionClass} aria-labelledby="age-scope-heading">
        <h3 id="age-scope-heading" className={headingClass}>Scope of this development experiment</h3>
        <p className={`mt-2 ${noteClass}`}>{profile.quality.note}</p>
        <p className={`mt-2 ${noteClass}`}>Unresolved: {profile.quality.missing.join("; ")}. These age estimates do not establish national or congressional-district launch readiness.</p>
        <details className="mt-4 text-xs"><summary className="cursor-pointer font-medium">Execution origins and evidence identifiers</summary>
          <ul className="mt-3 space-y-2">{profile.executions.map(e=><li key={e.mode}><strong className="font-medium">{e.mode.replaceAll("_"," ")}</strong> · {originLabels[e.cache_origin]}</li>)}</ul>
          <p className={`mt-3 ${noteClass}`}>The extension reuses nine composition results and computes two calibration nodes. Replay reuses all eleven. Cache-only checkpoint materialization is an evidence identity below, not a fifth public execution.</p>
          <dl className="mt-3 space-y-2">{[{key:"composition_checkpoint_sha256",sha256:profile.composition.checkpoint_sha256},...profile.identities].map(item=><div key={item.key}><dt className="text-muted-foreground">{item.key.replaceAll("_"," ")}</dt><dd className="mt-0.5 break-all font-mono text-[11px]">{item.sha256}</dd></div>)}</dl>
          <p className={`mt-3 ${noteClass}`}>The selected candidate’s population identity is its calibrated checkpoint file digest, shown in the graph’s identity inspector. The composition checkpoint and calibrated weight digest remain separate.</p>
          <dl className="mt-3 space-y-2">{age.column_provenance.map(p=><div key={p.source_role}><dt className="font-medium">{p.columns.join(", ")}</dt><dd className="text-muted-foreground">{p.source_role.replaceAll("_"," ")}<span className="mt-0.5 block break-all font-mono text-[11px]">{p.source_sha256}</span></dd></div>)}</dl>
        </details>
      </section>
    </article>
  );
}
