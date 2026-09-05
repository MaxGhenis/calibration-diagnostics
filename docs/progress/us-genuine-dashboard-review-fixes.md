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

All six bounded fixes are implemented, committed and tested at
`genuine-dashboard-review-fixes-20260905`. Every check below was run at this
branch's own head, not inherited from 4d27a58. Nothing is pushed, merged or
deployed, and no code approval is claimed here.

## Done

### Scope read

- Read `R/us-genuine-graph-evidence-independent-review.md` in full (Opus static
  APPROVE with five recorded verification limits: no shell/git, no recomputed
  SHA-256, nothing executed, browser/build/HTTP not run, one disclosed recursive
  search scope slip). Its eleven findings are all non-blocking; F1-F5 are the
  ones this assignment implements, F6-F11 are explicitly out of scope here and
  were not implemented speculatively.
- Read `R/us-genuine-dashboard-root-adversarial.ts` and `.json`. Root's three
  invented probes were accepted by the frozen head: a cyclic `a->b->c->a` typed
  dependency (rendered with three edges, no hang), a numeric mismatch between a
  consumed input and its named producer output, and removal of node `b`'s typed
  input in the second execution only (`identity_differs` stayed false and the
  inspector showed the first execution's inputs).
- Read `R/us-genuine-dashboard-root-browser-review.md` / `.json`: at 4d27a58
  root recorded build PASS, 19 HTTP cases / 98 assertions, and 143 WebKit checks
  with zero failures, plus two retained failed harness versions. That proof
  belongs to 4d27a58; this branch re-ran its own, below.
- Confirmed the genuine G attachment shape the fixes must not break, by reading
  the frozen artifact only: four nodes, a real DAG (create -> select,
  create -> cps, select -> cps, cps -> engine), `numeric: "platform_bitwise"`
  and `tolerance: null` on every typed input and output, byte-identical typed
  inputs per node across cold and warm, and `source_pins: []` on all four nodes.
- Confirmed the F001 legacy projection carries no `basis` key, so allowing an
  absent basis keeps the byte-exact legacy compatibility test intact.

### The six fixes

1. `4f056f6` -- `route.ts` reads the `build_manifest` descriptor explicitly in
   the graph_receipts branch. Missing, pending, failed or absent is answered
   `unavailable` with the sanitized publisher reason, or an authored sentence
   when the descriptor is absent entirely. No legacy registry lookup happens.
   An available build summary that cannot actually be read still returns the
   reader's sanitized 503.
2. `d4df742` -- `attachment.ts` settles the union of typed dependencies across
   executions and refuses a cycle. Directed acyclic shapes, receipts declaring
   no typed input, disconnected nodes and failed/unreached readings are all
   retained, each with a test.
3. `f91ef58` -- a consumed typed input must agree with its named producer's
   output on `numeric` and `tolerance`, in addition to artifact key, type and
   type version. Both fields stay nullable, so two nulls agree.
4. `2a41dda` -- receipts sharing a node key must declare the same typed inputs,
   compared canonically per local slot (producer, producer key, artifact
   identity, type, type version, numeric, tolerance). Nothing else is required
   to agree; cache, execution state, wall time and gate readings still differ
   freely, and receipt-absent, key-absent and different-key nodes are compared
   with nothing.
5. `2dddb25` -- publisher text markers are folded before matching, as the
   exporter's `safe_text` matches `value.lower()`; the published text itself is
   still rendered verbatim. The per-execution binding sentence now carries the
   source-pin count, and at zero says there is no per-node pin while still
   naming that the two artifacts' source maps were compared.
6. `6e68811` -- `verifyProjectionBinding` refuses a stored projection declaring
   `basis: "authenticated_attachment"`. Absent and `local_projection` are both
   still accepted.

### Checks at this branch's head

- Focused suite, the same six files the author journal reported at 266/819:
  `bun test lib/microcosm/graph/ app/api/microcosm/graph/` -- **291 pass, 0
  fail, 871 assertions across 6 files**.
- Full suite `bun test` -- **752 pass, 0 fail, 2660 assertions across 62
  files**. This sandbox permits localhost binding, so the three HTTP source
  tests the earlier author sandbox could not run pass here:
  `lib/microcosm/quality/source.test.ts` is 19 pass / 98 assertions on its own.
  752 reconciles exactly as 719 previously passing + those 3 + 30 new tests.
- `bun x tsc --noEmit` -- exit 0, no output.
- Every new refusal test was confirmed red with its fix disabled and green with
  it: 2 cycle, 2 numeric/tolerance, 5 cross-execution, 4 text/pin-count and 1
  basis test. The retention tests pass either way, which is what makes them
  guards against over-strictness rather than restatements of the fix.
- Root's own adversarial script, retargeted at this worktree and otherwise
  unmodified, now refuses all three probes:
  `review-fixes-artifacts/root-adversarial-newhead.json`.
- The frozen genuine G candidate still serves through the real route at this
  head: 200, available, `authenticated_attachment`, 4 nodes, the 4 real DAG
  edges in both modes, `identity_differs` false on all four, calibration
  `missing`, release `excluded`, cold 4 computed / warm 4 hits. Recorded in
  `review-fixes-artifacts/genuine-g-route-probe.json`. Read-only: the G
  directory's file sizes and mtimes are unchanged.
- Production build `bun run build --webpack` -- **exit 0**. Fonts resolved in
  this session, unlike the earlier author sandbox.
- Browser: root's `production-webkit-v3.mjs` copied unmodified except for its
  config path and output filenames, run against a fresh server on
  **127.0.0.1:4518** reading the existing TEST-only-quality-source read-only --
  **143 checks, 0 failures, 0 page errors, 0 request failures** at 390 and 1280.
  Root's 4397, 4488, 4509, 4403 and 4404 were left running and untouched; 4518
  was stopped afterwards.
- Its four screenshots are **byte-identical to root's four frozen ones** (same
  SHA-256). That is because the "What was checked before any of this was drawn"
  disclosure is a `<details>` with no `open` attribute and the v3 harness never
  expands it, so the one sentence this work changes is not in those pixels.
- A supplementary harness therefore expands that disclosure:
  `review-fixes-disclosure-webkit.mjs` -- **16 checks, 0 failures, 0 page
  errors, 0 request failures**. It confirms in the real production page that G
  now reads "These receipts declare no per-node source pin; the aggregate source
  map this attachment carries is the one the build summary carries.", that the
  unconditional "Source pins agree..." sentence is gone from both candidates,
  and that F001's own counted legacy sentence is unchanged. Root inspected the
  G 390 and 1280 captures visually; both remain readable and neither overflows.
- `git diff --check` from 4d27a58 to HEAD is clean, and no added line carries a
  tab or trailing whitespace. The repository has no prettier or eslint config;
  CI is `bun test`, `bun run lint` (tsc) and `bun run build`, all three of which
  pass here.

### Preservation

- Original dashboard worktree: clean, still `4d27a58`.
- Microcosm exporter worktree: clean, still `a819bef`. No Python file was read
  for anything but the `safe_text` marker list, none was changed, no export was
  re-run and no PolicyEngine or numpy execution occurred.
- Frozen G artifacts under `quality-genuine/`: unchanged sizes and mtimes.
- No install and no version change; `frontend/node_modules` is reached through a
  symlink outside both worktrees.
- Next's standalone file tracing wrote `frontend/dashboard/` (27 traced files,
  208K) into this worktree during the build. It is build output, not source; it
  was removed and never committed, and it contained no symlink.

## Next

- Root arranges the independent code review of this branch. Plan approval and a
  passing suite are not code approval, and none is claimed here.
- Non-blocking review findings F6-F11 remain unimplemented on purpose; the
  frozen G scope stays excluded.
- Scientific source acceptance, calibration, fit, holdout and release
  eligibility remain outside this engineering change.

## Failure history

1. **Source-pin count test expectation was wrong.** The first version of
   "counts the source pins each execution actually recorded" expected one pin
   per execution; the invented fixture pins the one invented source on all
   three receipts, so the sentence read "All 3". The test was corrected to
   assert 3, 2 and 1 by removing pins, not the product code. Retained here
   rather than silently fixed.
2. **Supplementary browser harness v1 timed out on F001.** Its wait predicate
   was `document.body.innerText.includes('source map')`, a clause only the
   attachment branch's sentence contains, so the legacy candidate never
   satisfied it. The G checks had already passed. v2 waits on "served from
   cache", which both branches word identically. The failed script, its log and
   its receipt are retained as
   `review-fixes-disclosure-webkit-v1-failed.{mjs,json}` and
   `disclosure-run-v1-failed.log`. This was a harness predicate, not a product
   failure, and no product change was made from it.

## Artifact paths

All under
`/private/tmp/us-genuine-graph-evidence-author-20260905-O0IgKV/review-fixes-artifacts/`:
`root-adversarial-newhead.ts` / `.json`, `genuine-g-route-probe.ts` / `.json`,
`build.log`, `server-4518.log`, `review-fixes-webkit.mjs`,
`review-fixes-webkit-config.json`, `review-fixes-webkit.json`,
`webkit-run.log`, the four `us-genuine-dashboard-review-fixes-*.png`,
`review-fixes-disclosure-webkit.mjs` / `.json`, `disclosure-run.log`, the four
`review-fixes-checked-*.png`, and the retained v1 failure set.
