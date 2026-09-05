# Genuine dashboard attachment review fixes — author progress

Separate journal for the bounded review-fix assignment. It does not replace
`PROGRESS.md` (root) or `PROGRESS-us-genuine-graph-evidence-author.md` (the
frozen author journal); neither file is edited by this work.

## Exact heads and worktree

- Frozen original dashboard: `/private/tmp/us-genuine-graph-evidence-author-20260905-O0IgKV/dashboard`
  at `4d27a588ffb6d4243f13996babd04da135863327`, branch
  `genuine-graph-evidence-author-20260905`, working tree clean at the start of
  this assignment. It is not modified here.
- New dependent worktree for this assignment:
  `/private/tmp/us-genuine-graph-evidence-author-20260905-O0IgKV/dashboard-review-fixes`,
  branch `genuine-dashboard-review-fixes-20260905`, created from exactly
  `4d27a588ffb6d4243f13996babd04da135863327`.
- Dependencies: no install and no version change. The existing
  `dashboard/frontend/node_modules` tree is reached through a single symlink at
  `.../O0IgKV/node_modules`, which is outside both worktrees, so neither git
  status is affected. Node's parent-directory resolution finds it.
- Exporter `a819bef7a9452bb364dca6c5ba4f025b064109cb` and the frozen genuine G
  artifacts are read-only inputs here. No Python file is changed, no export is
  re-run, no PolicyEngine or numpy execution occurs.

## State

Scope read and confirmed against source; new worktree created and verified to
run the existing suite. Implementation of the six bounded fixes is next.

## Done

- Read `R/us-genuine-graph-evidence-independent-review.md` in full (Opus static
  APPROVE with five recorded verification limits: no shell/git, no recomputed
  SHA-256, nothing executed, browser/build/HTTP not run, one disclosed recursive
  search scope slip). Its eleven findings are all non-blocking; F1-F5 are the
  ones this assignment implements, F6-F11 are explicitly out of scope here.
- Read `R/us-genuine-dashboard-root-adversarial.ts` and `.json`. Root's three
  invented probes were accepted by the frozen head: a cyclic `a->b->c->a` typed
  dependency (rendered with three edges, no hang), a numeric mismatch between a
  consumed input and its named producer output, and removal of node `b`'s typed
  input in the second execution only (`identity_differs` stayed false and the
  inspector showed the first execution's inputs).
- Read `R/us-genuine-dashboard-root-browser-review.md` / `.json`: at
  4d27a58 root recorded build PASS, 19 HTTP cases / 98 assertions, and 143 WebKit
  checks with zero failures, plus two retained failed harness versions. That
  proof belongs to 4d27a58. This branch's new head does not inherit it.
- Confirmed the genuine G attachment shape that the fixes must not break, by
  reading the frozen artifact only: four nodes, a real DAG (create -> select,
  create -> cps, select -> cps, cps -> engine), `numeric: "platform_bitwise"`
  and `tolerance: null` on every typed input and output, byte-identical typed
  inputs per node across cold and warm, and `source_pins: []` on all four nodes.
- Confirmed the F001 legacy projection carries no `basis` key, so allowing an
  absent basis keeps the byte-exact legacy compatibility test intact.
- Smoke-ran the existing `lib/microcosm/graph/attachment.test.ts` in the new
  worktree: 14 pass, 0 fail, 79 assertions.

## Next

1. `build_manifest` unavailability handled explicitly in the graph_receipts
   route branch.
2. Typed dependency cycle refusal in the attachment normalizer.
3. Consumed-artifact `numeric`/`tolerance` agreement with the named producer.
4. Cross-execution typed input contract agreement for equal node keys.
5. Case-folded publisher-text marker denylist and a counted source-pin sentence.
6. `verifyProjectionBinding` refuses a legacy projection claiming
   `authenticated_attachment`.
Then: focused attachment/route/adapter/presentation suites, `tsc --noEmit`,
formatting/diff check, and an honest report of whatever the sandbox refuses.

## Failure history

None yet.
