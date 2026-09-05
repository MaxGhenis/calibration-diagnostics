# Resolved-population identity guard (D1)

September 5 follow-up: the narrative below records the frozen `266e2674` work.
Independent Fable review requested two further fixes: published identity must
use its resolved storage address, and Latest must resolve on the incumbent side
too. The local `candidate-quality-pointer-symmetry-20260905` successor applies
both, with 390 tests, typecheck and production build passing. WebKit reproduces
the original alias mismatch and verifies the corrected shared explanation and
empty incumbent. Actual development-candidate national/CD views and mobile
focus checks pass; independent successor review is pending. Nothing is pushed
or deployed. This supersedes the earlier completion wording for review status.

Branch `candidate-quality-resolved-identity-20260905`, branch base
`14552168cad50f963c3064a4cb73adfcc605231e`, predecessor head
`e868a320257d187f122ac8d1fa4c201ee4c6cf60` (branch
`candidate-quality-review-fixes-20260905`, left frozen and clean).

Finding D1 of
`/Users/maxghenis/architecture-reviews/microcosm-20260904/dashboard-review-fixes-independent-review.md`:
the self-comparison guard added at e868 compares literal transport strings, so
two spellings of one population still compared against themselves.

## Done

- Worktree inspected before editing: clean at e868a32, no upstream configured,
  nothing pushed. `frontend/node_modules` was absent and was installed from the
  checked-in `bun.lock` with `--frozen-lockfile`; no dependency was upgraded.
- `frontend/lib/microcosm/quality/identity.ts`: the shared resolution. A
  candidate names its population by the digest its immutable manifest binds,
  read with that population's period and entity and the country; a published
  release names one by the concrete id the pointer resolves to. Same key is one
  population; different keys under the same kind of name is a comparison; a
  candidate digest against a published release id, a build with no population,
  or one digest declared under two periods leaves the question open and is
  labelled rather than claimed.
- `loadComparison` refuses a resolved self-comparison with `SelfComparisonError`,
  which `classifyApiError` answers 400, so `/api/microcosm/compare` cannot be
  used to bypass the views. `buildComparison` is untouched, so the staging diff
  keeps building on its own terms.
- One client hook, `useResolvedComparison`, drives the population strip, the
  compare page and the quality overview: a refused incumbent empties the
  control, the A selection, the incumbent overlay and the Incumbent ESS column
  together, and the authored sentence explains it.
- `resolvedReleaseId` maps a hand-authored `?release=latest` and the empty
  default onto the same release.
- Regression tests: `identity.test.ts` (the pure rules and the whole client
  decision) and `resolved-identity.test.ts` (both demonstrated aliases and two
  genuinely different populations through the actual loader and the compare
  route, on synthetic fixtures with every published fetch stubbed).
- Visible focus ring on the `<main>` landmark.
- `docs/candidate-quality.md` records what settles an incumbent.
- Verified: `bun test` 385 pass / 0 fail, `bun run lint` (tsc --noEmit) clean,
  `bun run build` succeeds with the route table identical to the e868 build.
  Logs in the review directory.

## Next

- Nothing outstanding for D1. Receipt at
  `/Users/maxghenis/architecture-reviews/microcosm-20260904/dashboard-resolved-identity-author-receipt.md`,
  including the limitations that remain.
