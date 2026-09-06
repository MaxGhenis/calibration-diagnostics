# Sample-size-aware income evidence reader — progress

Child worktree of the accepted contract-alignment head. Scope: teach the
calibration dashboard's reader, types, fixtures, tests and surface to read the
**successor** sized export profile, whose semantics are fixed but whose cohort
size is carried by the payload — so a real 505-household run can be assessed
visually — while the existing strict 15-household profile keeps rendering
byte-identically.

Local code, invented fixtures and browser checks only. This lane does not
export, does not install any genuine candidate, and writes no approval.

## State

- Worktree: `_worktrees/calibration-income-sized-evidence-20260906`
- Branch: `calibration-income-sized-evidence-20260906`
- Base (accepted parent): `18f79b3a73282acc790a31b3f4173f5092d1d089`
- Parent worktree `calibration-income-v3-contract-alignment-20260906`
  preserved, clean, untouched
- `upstream/main` = `210f8a3f5cfe9cdee888f99820dfe13bad7223ea`, 0 behind
- Started: 2026-09-06

## Done

1. Created the child worktree from the accepted parent head. Reused the parent's
   installed `frontend/node_modules` by symlink; no package was added, removed or
   upgraded.

## Next

- Establish the pre-change baseline, then follow the exporter's published sized
  contract.

## Standing note

The shared git directory has a pre-existing missing ancestor
(`54a0b3326c7f8445003a2b9dcdc4cd70f325a412`); `HEAD` reads fine and normal child
worktree creation succeeded. Nothing here repairs, prunes or resets it. Root's
durable backups are `R/calibration-dashboard-git-local-backup-18f79b3a` and
`R/calibration-dashboard-tree-18f79b3a.tar`.
