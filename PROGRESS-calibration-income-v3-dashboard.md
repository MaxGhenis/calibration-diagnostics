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
- [ ] Extend the reader with an explicit, strictly validated profile union
- [ ] Carry the profile through the adapter into the drawn payload
- [ ] Draw the five-node evidence profile in the existing graph viewer
- [ ] Reader and UI tests: old compatibility, new fixture, corruption, cross-profile
- [ ] `bun test`, `bun run lint`, `bun run build`
- [ ] Real WebKit desktop and mobile checks against this lane's own server
- [ ] Write the report to R

## What is being read, and what is not

Read: the author report, the accepted root output review, the exporter source and
its invented fixtures, the existing dashboard reader, adapter, types and viewer.

Not read, not run: original source files, capture files, checkpoints, opaque model
arrays. No model is run, no policy calculated, no dependency added, no replacement
graph engine introduced.

## Journal

- 2026-09-06 01:0x — branched at 4e769bd, installed dependencies, journal started.
