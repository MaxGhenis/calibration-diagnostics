# Resolved-population identity guard (D1)

Branch `candidate-quality-resolved-identity-20260905`, base
`14552168cad50f963c3064a4cb73adfcc605231e`, starting head
`e868a320257d187f122ac8d1fa4c201ee4c6cf60`.

Finding D1 of
`/Users/maxghenis/architecture-reviews/microcosm-20260904/dashboard-review-fixes-independent-review.md`:
the self-comparison guard added at e868 compares literal transport strings, so
two spellings of one population still compare against themselves.

## State

- Worktree inspected: clean at e868a32, no upstream configured, nothing pushed.
- `frontend/node_modules` absent in this worktree; installing from the checked-in
  `bun.lock` with `--frozen-lockfile` (no dependency upgrade).

## Done

- (nothing yet)

## Next

1. Pure `lib/microcosm/quality/identity.ts`: population identity per side
   (candidate population digest + period/entity/country, or resolved published
   release id) and a three-way comparison verdict with authored explanations.
2. Server: `buildComparison` carries the verdict; `loadComparison` refuses a
   resolved self-comparison so `/api/microcosm/compare` cannot be bypassed.
3. Client: one shared `useResolvedComparison()` hook feeding the strip, the
   compare view and the quality overview.
4. Regression tests for both demonstrated aliases and for true different
   populations (reused candidate id, different population digest).
5. Visible focus ring on the main landmark.
6. Full frontend tests, `tsc --noEmit`, production build; logs to the review
   directory; receipt at
   `/Users/maxghenis/architecture-reviews/microcosm-20260904/dashboard-resolved-identity-author-receipt.md`.
