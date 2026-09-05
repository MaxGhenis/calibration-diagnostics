# Generic adapter prose and a committed production selection harness

Branch `calibration-graph-generic-followup-20260905`, base
`334b8261d99d2dffca9cef14dc282bf9d2bc8dd7` — the combined head an independent
Fable 5.1 review approved as a single-candidate viewer
(`architecture-reviews/microcosm-20260904/calibration-graph-combined-final-fable51.md`).
That review's approval covers `334b8261` and nothing on this branch. Nothing on
this branch has been reviewed by anyone.

This branch takes two of that review's three non-blocking follow-ups. The third,
about the producer's gate semantics at `adapter.ts:242-243`, is root's, and
`verifyGate` is not touched here.

Nothing is pushed. No deploy, no dataset build, no calibration, no launch, and
no claim that any dataset is calibrated or launched. The frozen worktree at
`_worktrees/calibration-candidate-receipt-final-composition-20260905` and the
servers already listening on 4397 and 4485 were not touched.

## State

Both follow-ups complete and frozen at `e3a3a5b0`, working tree clean.

Base verified before branching: `git fetch origin`, then `git merge-base
--is-ancestor origin/main 334b8261` succeeds and `origin/main` (`210f8a3f`) is
the merge base, so `334b8261` contains `origin/main` and is 60 commits ahead of
it. The base worktree was clean at `334b8261`; this worktree was created from
that explicit commit, not from a branch name.

| | Before | After |
| --- | --- | --- |
| `bun test` (frontend) | 617 pass / 0 fail / 2121 assertions / 58 files | 635 pass / 0 fail / 2183 assertions / 58 files |
| `bun run lint` (`tsc --noEmit`) | clean | clean |
| `bun run build` | clean | clean |
| production WebKit selection harness | not in the repo | 12 passed / 0 failed / 0 page errors / 0 failed requests |

## Done

### 1. The authored prose is read out of the run

Six shipped sentences stated facts that were true only of the one projection
registered today. Each now derives from evidence the binding already verified.

- The column-ownership limit counts the columns the published gate capabilities
  name a writer for, and names their entity only when every column shares one
  plain identifier. This is the only one that needed data `buildReceiptGraph`
  did not have: `tolerance_writers` lives at
  `checks.<mode>.gate.capabilities.tolerance_writers` in the build evidence and
  has no counterpart in the projection, so the already-verified `buildEvidence`
  is now its third argument. Nothing structural is read from it and no edge is
  drawn from it.
- The release limit reads `manifest.execution_status` and
  `manifest.release_eligibility.status`, both closed vocabularies the reader
  validates before the adapter sees them.
- Both execution sentences count the executions and their published kernel
  calls. After a successful binding those are the publisher's own figures:
  every published graph execution must be projected, every projected execution
  must have a published check, and `check.kernel_calls` must equal the receipts
  that record a computation. Their closing clause names source digests only
  where a receipt actually declared a source pin.
- The gate note counts gate records and is keyed off that count. It was keyed
  off the declared scopes, so a gate that recorded an outcome without one
  produced `records: 1` beside the sentence "No gate record in this run" — the
  payload contradicting itself.
- The comparison card's heading moved into the payload as `comparison.title`,
  because the component stated "Same computation, two executions" independently
  of the payload; the same card's "Identical across both executions" is now
  "Identical across every recorded execution". Deriving the adapter and leaving
  those would have put a false count directly above corrected body text.

Where evidence is absent the sentence says so rather than pointing at a slice
that is not there: a run whose gate capabilities name no writer for any column
gets "the build evidence records no writer for any column inside a gate's
declared tolerance scope" instead of the published-slice sentence. An absent,
empty or unreadable writer record all yield the same nothing. That path does not
refuse: this is a count for a sentence, not an identity the run is bound by, and
a candidate whose gate capabilities cannot be parsed is still a candidate whose
receipts were verified. A column entity is pasted into the sentence only when it
matches `^[a-z][a-z0-9_]*$`, so a publisher string cannot put a path or a host
into a response body.

Prose for the shipped candidate is byte-identical to `334b8261` apart from the
new release sentence and "that scope" for "that gate's scope".

No validation was loosened, no edge was invented, `verifyGate` was not touched,
and no projection was registered.

Red then green, both committed:

- `2dce3c3` — fifteen assertions failing, with the plumbing in place so the
  failures land on the prose rather than on a module that cannot load:
  620 pass / 15 fail / 2159 assertions, `tsc` clean.
- `b96cf7f` — 635 pass / 0 fail / 2183 assertions, `tsc` clean, build clean.

### 2. The alternate fixture

A hand-built alternate candidate lives in `adapter.test.ts` as typed literals:
one execution rather than two, one kernel call rather than four and none, one
cache hit rather than two, a gate that declared itself `not_applicable` rather
than one that passed, two `person.` columns in its tolerance scope rather than
four `household.` ones, and a build still `running` and `not_evaluated` for
release. It passes `verifyProjectionBinding` on its own terms — digests,
uniqueness, execution-state flags, the kernel-call equality, its source pin and
its gate all agree — and it draws one recorded edge.

It is deliberately not registered in `projections.ts`, so no request can reach
it, and it is not a directory under `fixtures/`, because that directory holds
unmodified publisher bytes. Its whole purpose is that the sentences can be read
against evidence that is not this dashboard's one candidate: its limits state
one execution, one kernel call, two person columns, a running execution and an
eligibility that is not evaluated, and none of the shipped candidate's figures
appear anywhere in them.

### 3. The production selection harness

`frontend/scripts/calibration-graph-generic-followup/selection-regression.mjs`,
with `README.md` and a fixture beside it, and
`bun run verify:graph-selection` in `package.json`.

Twelve checks in one real WebKit page against a real production build with
prefetch left on: list click, inspector change, replay, identity and fragment
survival, reload, arrow key with focus, Escape, canvas click, history length,
Back, Forward, and no page errors. Page errors and failed requests are recorded
on every phase whether or not they are asserted on.

Parameterized: base URL (which carries the mount path, so the identity check
derives its expected pathname from the same value rather than a second literal),
fixture path, output directory, `playwright-core` location, settle and timeout —
each a flag with an environment-variable equivalent. No host path is written
into the file. `playwright-core` is not added to this app's dependencies and is
not resolvable from the repo; the operator supplies its location and the run
prints and records the resolved version and directory rather than naming one.

Not wired into `make test` or GitHub CI. Both run without a server or a browser
and neither should start one.

**It catches the defect it exists for.** Reverting
`receipt-graph-view.tsx` to `router.replace` and rebuilding leaves `bun test`
green — 43 assertions across `receipt-graph-view.test.tsx` and
`navigation.test.ts`, all passing — and the harness fails on its first check,
`list click changes the actual production URL`. The fix was restored, rebuilt
and re-run at 12/12.

## Verification

Run in this worktree, at `e3a3a5b0` unless stated:

| Command | Result |
| --- | --- |
| `bun test` (frontend) | 635 pass / 0 fail / 2183 assertions / 58 files |
| `bun run lint` | clean |
| `bun run build` | compiled successfully, 21 static pages |
| `bun run test:dev-port` | pass |
| `bun run verify:graph-selection` against 127.0.0.1:4487 | 12 passed / 0 failed / 0 page errors / 0 failed requests |
| same harness, `router.replace` reverted in | 0 passed / 1 failed on the first check |
| `bun test` with `router.replace` reverted in | 43 pass / 0 fail across the two navigation-facing files |

The server was this lane's own: `MICROCOSM_QUALITY_US_DIR` on the real quality
directory `_buildo-runtime/out/us-graph-launch-20260905/quality`, `bun run start
--hostname 127.0.0.1 --port 4487`, serving the production build from this
worktree. Ports 4397 and 4485, and every other agent's server, were left alone.
`next start` prints its existing `output: standalone` advisory and serves the
production build anyway, as earlier lanes also recorded.

## Not done, and why

Found while deriving the sentences above, all outside the four derivations this
lane was asked for, none changed:

- `adapter.ts:895-928` hardcodes `state: "missing"` for the calibration and
  cross-dataset mapping axes without reading `attachments[name].status`, and an
  available attachment carries no `reason`, so the fallback would print "The
  selected candidate publishes no evidence of this kind." about evidence the
  candidate did publish. This is a behaviour change to what the page reports,
  not a wording fix.
- `adapter.ts:940` restates `projection.label_basis`, which the same panel
  already renders from the projection two fields above.
- `adapter.ts:943` says the numeric-reproducibility platform tag is "not
  carried into this view", while `receipt-graph-view.tsx:359` renders the same
  `platform_bitwise` vocabulary from the node-level `numeric` field.
- `adapter.ts:938` asserts "No publisher attachment pins its bytes" without
  consulting the attachment map. Nothing in the schema names such an attachment,
  so there is nothing to derive it from today, and `adapter.test.ts` pins the
  clause.
- `adapter.ts:907/914/921/995/1003` assert absences the projection has no field
  to observe. The honest wording is already used at `938` — absent here, not
  absent from the run.
- `receipt-graph-view.tsx:650-654` labels a Field "Kernel calls" while rendering
  `computed_count`. Harmless — the binding forces them equal — but not
  self-evident.

## Next

Nothing outstanding on this branch. It is frozen and unpushed.
