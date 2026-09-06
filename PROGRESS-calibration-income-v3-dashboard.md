# Income-v3 dashboard evidence profile — progress

Local-only lane. No push, no merge, no deploy, no index promotion, no candidate
published. The exporter is under separate review and the genuine candidate export
arrives later from root; nothing here fabricates one.

## Where this is

- Worktree `/Users/maxghenis/PolicyEngine/_worktrees/calibration-income-v3-dashboard-20260906`
- Branch `calibration-income-v3-dashboard-20260906`, a fresh dependent child of
  `4e769bd6cacd80f968d46e0b8d1b61459e0629dd`
- Base worktree `calibration-graph-mobile-evidence-20260905` was inspected before
  branching: clean at that head apart from untracked `frontend/node_modules`,
  `git fetch origin` ran, and it is not modified by this lane. Its dev server on
  port 4521 keeps running. Every other worktree, dirty or reference, is untouched.
- This lane's own dev server uses a new free port, never 4521, 4530 or 4531.

## State

- [x] Inspected base worktree status, fetched, recorded head and base
- [x] Created the dependent child worktree and installed frontend dependencies
- [x] Read the author report, the root output review, the exporter and its shapes
- [x] Read `attachment.ts`, `adapter.ts`, `types.ts` and the graph viewer
- [x] Extend the reader with an explicit, strictly validated profile union
- [x] Carry the profile through the adapter into the drawn payload
- [x] Draw the five-node evidence profile in the existing graph viewer
- [x] Reader and UI tests: old compatibility, new fixture, corruption, cross-profile
- [x] `bun test` 853, `bun run lint`, `bun run build`, `bun run test:dev-port`
- [x] Real WebKit desktop and mobile checks against this lane's own server on 4544
- [x] Write the report to R

## What is being read, and what is not

Read: the author report, the accepted root output review, the exporter source and
its invented fixtures, the existing dashboard reader, adapter, types and viewer.

Not read, not run: original source files, capture files, checkpoints, opaque model
arrays. No model is run, no policy calculated, no dependency added, no replacement
graph engine introduced.

## What is still missing, for root

The accepted root output review exists and accepts the run, but it is not in the
shape `freeze_income_v3_pins` requires, so no genuine export can be produced yet.
Running that validator against the accepted file refuses with `Missing or unknown
receipt fields`; six required fields are absent and six extra fields are present.
The exact list is in the report. Nothing here forged an approval, and the visual
checks below are invented-fixture checks, reported as such.

## Journal

- 2026-09-06 01:0x — branched at 4e769bd, installed dependencies, journal started.
- 2026-09-06 01:1x — reader profile union, then the invented fixture and 73 reader
  tests. The four-node payload stayed byte-identical, which its own F001 guard
  caught the first time round: the profile key is absent, not null.
- 2026-09-06 01:2x — the viewer sections, 28 UI tests, and a production build.
- 2026-09-06 01:3x — real WebKit on 4544 found a genuine 390px overflow in the
  accounting column roster and a pre-existing one in the pipeline page's own
  historical-overview diagram. The first is fixed; the second is recorded, not
  touched. 51 browser checks pass on desktop and mobile.
- 2026-09-06 01:4x — report written to R.
