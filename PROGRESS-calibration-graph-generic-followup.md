# Generic adapter prose and a committed production selection harness

Branch `calibration-graph-generic-followup-20260905`, base
`334b8261d99d2dffca9cef14dc282bf9d2bc8dd7` — the combined head an independent
Fable 5.1 review approved as a single-candidate viewer
(`architecture-reviews/microcosm-20260904/calibration-graph-combined-final-fable51.md`).
That review's approval covers `334b8261` and nothing on this branch.

This branch takes two of that review's three non-blocking follow-ups. The third,
about the producer's gate semantics at `adapter.ts:242-243`, is root's and
`verifyGate` is not touched here.

Nothing is pushed. No deploy, no dataset build, no calibration, no launch. The
frozen worktree at `_worktrees/calibration-candidate-receipt-final-composition-20260905`
and the servers already listening on 4397 and 4485 are not touched.

## State

Starting. Base verified: `git fetch origin` then `git merge-base --is-ancestor
origin/main 334b8261` succeeds, and `origin/main` (`210f8a3f`) is the merge base,
so `334b8261` is 60 commits ahead of `origin/main` and contains it. The base
worktree was clean at `334b8261` before this worktree was created from that
explicit commit.

Baseline in this worktree before any change: `bun test` in `frontend/` reports
617 pass / 0 fail / 2121 expect() calls across 58 files.

## Scope

1. **Derive the generic adapter prose from verified data.** `adapter.ts` states,
   under "What was checked", several facts that are true only of the one
   projection registered today: four household tolerance columns, a completed
   and excluded candidate, two executions computing four kernel calls and none,
   one gate record. Derive each from the data already verified, and make sure
   the prose never claims evidence that a candidate did not publish.
2. **Commit the production WebKit selection regression harness.** The harness
   that found and then confirmed the navigation fix lives outside the repo with
   absolute paths and a hardcoded candidate. Parameterize and commit it so the
   production check is reproducible, and run it against a production server this
   lane owns.

## Done

Nothing yet.

## Next

Scout the prose inventory, the evidence surface, the test conventions and the
harness constraints, then implement each follow-up red-then-green.
