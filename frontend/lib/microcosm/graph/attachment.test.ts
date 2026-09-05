import {describe,expect,test} from "bun:test";
import {buildReceiptGraph,ReceiptGraphUnavailableError} from "./adapter";
import {implementationSetDigest,normalizeGraphAttachment,safePublisherReason} from "./attachment";
import {inventedGraph,h} from "./fixtures/invented-graph";
function verified(input = inventedGraph()) { return normalizeGraphAttachment(input.graph,input.manifest,input.manifestSha,input.build); }
function refusal(change:(input:ReturnType<typeof inventedGraph>)=>void) {const x=inventedGraph();change(x);expect(()=>verified(x)).toThrow(ReceiptGraphUnavailableError);}
describe("invented graph attachment contract",()=>{
 test("uses canonical ASCII id TAB hash LF bytes independent of insertion order",()=>{
  const a={kernel_ref:"test.a@1",kernel_impl_hash:h("1")}, b={kernel_ref:"test.b@1",kernel_impl_hash:h("2")};
  expect(implementationSetDigest({a,b})).toBe("9973c87a16e71a92d98c70278c07a46a3d224e103e643b2bc359e476dfc31fb9");
  expect(implementationSetDigest({b,a})).toBe(implementationSetDigest({a,b}));
  for(const by_node of [{},{"a b":a},{"é":a},{a:{...a,kernel_impl_hash:h("A")}}]) expect(()=>implementationSetDigest(by_node)).toThrow();
 });
 test("normalizes two implementations and actual typed edges with separate preparation",()=>{
  const x=inventedGraph(),v=verified(x),p=buildReceiptGraph(v.projection,x.manifest,x.build,v.checks);
  expect(p.nodes).toHaveLength(3);expect(p.edges.map(e=>[e.from,e.to])).toEqual([["a","b"],["b","c"]]);
  expect(p.binding.kernel_impl_hash).toBeNull();expect(p.binding.implementation_set).toEqual(x.graph.implementation_set);
  expect(p.projection.basis).toBe("authenticated_attachment");expect(p.executions[0]).toMatchObject({kernel_calls:1,computed_count:1,cache_hit_count:2});
  expect(p.gates.records).toBe(0);expect(p.nodes[0].tolerance).toBe(0);expect(p.nodes[0].states[0].wall_time_seconds).toBe(0);
  expect(p.limits.join(" ")).toContain("aggregate");expect(p.comparison.execution_note).not.toContain("does not pin");
 });
 test("rejects missing extra swapped hashes or refs and duplicate nodes",()=>{
  refusal(x=>{delete (x.graph.implementation_set.by_node as any).a});
  refusal(x=>{x.graph.implementation_set.by_node.extra=x.graph.implementation_set.by_node.a});
  refusal(x=>{x.graph.executions[0].nodes[0].kernel_impl_hash=h("2")});
  refusal(x=>{x.graph.executions[0].nodes[0].kernel_ref="test.c@1"});
  refusal(x=>{x.graph.executions[0].nodes.push(x.graph.executions[0].nodes[0])});
 });
 test("binds distinct manifest bytes separately from matching computation keys",()=>{
  expect(verified().projection.executions.map(e=>e.manifest_sha256)).toEqual([h("a"),h("b")]);
  refusal(x=>{x.graph.executions[0].execution_manifest_sha256=h("c")});
  refusal(x=>{x.graph.executions[0].computation_content_key=h("a")});
  refusal(x=>{x.graph.executions[1].execution_manifest_sha256=h("a")});
 });
 test("rejects candidate run population declaration and frozen-provenance disagreements",()=>{
  for(const field of ["candidate_release_id","run_id","population_sha256","period","entity","run_head","runner_sha256","roster_sha256","approval_sha256","exporter_sha256","operator_declaration_sha256"])
   refusal(x=>{(x.graph as any)[field]="wrong"});
  refusal(x=>{delete (x.graph as any).operator_declaration_sha256});
  refusal(x=>{x.manifest.provenance.source_implementation_sha256=h("1")});
  refusal(x=>{x.manifest.release_eligibility.status="eligible"});
  refusal(x=>{x.manifest.execution_status="failed"});
 });
 test("rejects unknown fields, unsafe text, bounds and candidate digest at any depth",()=>{
  refusal(x=>{(x.graph as any).host="private-host"});
  refusal(x=>{(x.build.checks.direct as any).candidate_manifest_sha256=h("a")});
  for(const label of ["/Users/private", "host.local", "MacBook", "unsafe\\path", "bad\nlabel", "x".repeat(161)]) refusal(x=>{x.graph.executions[0].nodes[0].label=label});
  refusal(x=>{x.graph.executions[0].nodes[0].measures=Array(65).fill({key:"v",label:"Value",value:1})});
  refusal(x=>{x.graph.executions[0].nodes[0].wall_time_seconds=NaN});
  for(const reason of ["x".repeat(2049),"host.local","unsafe/path","line\nbreak"]) expect(()=>safePublisherReason(reason)).toThrow();
  expect(safePublisherReason("Publisher evidence pending.")).toBe("Publisher evidence pending.");
 });
 test("rejects absent duplicate or contradictory typed producer references",()=>{
  refusal(x=>{x.graph.executions[0].nodes[1].typed_inputs[0].producer="missing"});
  refusal(x=>{x.graph.executions[0].nodes[1].typed_inputs[0].producer_key=h("9")});
  refusal(x=>{x.graph.executions[0].nodes[1].typed_inputs[0].type_version=2});
  refusal(x=>{x.graph.executions[0].nodes[0].typed_outputs.push(x.graph.executions[0].nodes[0].typed_outputs[0])});
 });
 test("refuses false parity, counts, source pins and one-way graph binding disagreements",()=>{
  refusal(x=>{(x.build.checks as any).cold.direct_real_engine_array_parity=false});
  refusal(x=>{x.graph.executions[0].kernel_calls=2});
  refusal(x=>{x.graph.executions[0].source_preparation_calls=0});
  refusal(x=>{x.graph.executions[0].nodes[0].source_pins[0].sha256=h("9")});
  refusal(x=>{x.build.graph_receipts_sha256=h("9")});
 });
});
