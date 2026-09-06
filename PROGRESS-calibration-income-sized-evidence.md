# Sample-size-aware income evidence reader — progress

Child worktree of the accepted contract-alignment head. Scope: teach the
calibration dashboard's reader, types, fixtures, tests and surface to read the
**successor** sized export profile, whose semantics are fixed but whose cohort
size is carried by the payload — so a real 505-household run can be assessed
visually — while the existing strict 15-household profile keeps rendering
byte-identically.

Local code, invented fixtures and browser checks only. This lane exported
nothing, installed no candidate, and wrote no approval.

## State

- Worktree: `_worktrees/calibration-income-sized-evidence-20260906`
- Branch: `calibration-income-sized-evidence-20260906`
- Base (accepted parent): `18f79b3a73282acc790a31b3f4173f5092d1d089`
- Parent worktree `calibration-income-v3-contract-alignment-20260906`
  preserved, clean, untouched at that commit
- `upstream/main` = `210f8a3f5cfe9cdee888f99820dfe13bad7223ea`, 0 behind
- Started and completed: 2026-09-06

## Done

- [x] Created the child worktree from the accepted parent head. Reused the
      parent's installed `frontend/node_modules` — first by symlink, which
      Turbopack refuses because it resolves outside the project root, then by
      APFS clone. Identical package roster; nothing added, removed or upgraded.
- [x] `INCOME_SIZED_PROFILE` alongside `INCOME_V3_PROFILE`, with every dispatch
      site asking `isIncomeProfile` rather than naming one. The reviewed
      profile's checks are untouched.
- [x] `sizedScope` / `sizedReported` under a measured size policy;
      `incomeScope` / `incomeReported` unchanged under the pinned one. Both are
      named function expressions, because the contract tests read refusal frame
      names off the stack.
- [x] Cross-checked the build summary's own household, person and tax-unit
      counts against the graph scope, for **both** profiles — they were
      validated as bare counts and never compared to anything.
- [x] `EvidenceProfileScope` extended with the four sized-only fields, optional
      rather than nullable because the reviewed profile's bytes do not contain
      them and the reader counts keys exactly.
- [x] Committed the sized exporter's own bytes at two shapes under
      `fixtures/income-sized-exporter-written/`, with the real production
      28-column roster.
- [x] Drew the measurement evidence: each fact, its count, how many places
      recorded it and which. A measured size a reader cannot audit is just a
      different constant.
- [x] 957 tests pass, 0 fail, 3,361 assertions, 67 files. `tsc` clean,
      `next build` exit 0, dev-port 0 fail.
- [x] Real WebKit 26.0, desktop 1440 and mobile 390, **both shapes**: 69 checks
      each, 0 failures, 0 page errors.

**Lane complete.** Nothing exported, installed, pushed, merged or approved.

## Findings

- **A mobile defect this lane introduced and fixed.** The measurement table's
  three columns could not wrap the long recording-source tokens and pushed the
  card past a 390px viewport. Replaced with a definition list, which carries the
  same structure and wraps. The profile region now measures clean at 390 with
  every disclosure open, at both shapes.
- **Pre-existing, outside this lane.** The pipeline page's candidate picker
  draws the candidate id in a label that does not wrap, so a long id widens that
  page's own chrome at 390px. An A/B on one build showed the 15-household
  fixture fitting only because its id is shorter. Worked around by shortening
  the invented ids; the picker is not this lane's file.
- **A stale parent-scope assumption.** The parent lane recorded that the
  exporter sets no bound on zero-origin class counts, so this reader caps each
  class at 52. True of the reviewed profile — but both genuine runs partition
  the person rows exactly, and the sized exporter now requires that. The sized
  reader enforces the partition; the reviewed profile's cap is untouched.

## Standing note

The shared git directory has a pre-existing missing ancestor
(`54a0b3326c7f8445003a2b9dcdc4cd70f325a412`) and still lives under
`/private/tmp`. `HEAD` reads fine and normal child worktree creation succeeded.
Nothing here repaired, pruned, relocated or reset it. Root's durable backups
`R/calibration-dashboard-git-local-backup-18f79b3a` and
`R/calibration-dashboard-tree-18f79b3a.tar` are unchanged.
