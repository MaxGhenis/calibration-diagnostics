# Receipt-backed graph view for a selected candidate run

Branch `candidate-receipt-graph-20260905`, base
`6dda4e7af2dd432ff7aa88b3f07abf16e0a33a72` (reviewed dashboard head). Nothing
is pushed; no cloud, deploy or dataset mutation is in scope. Only this worktree
is touched.

Continued on the dependent branch `candidate-receipt-graph-review-20260905`,
base `ce1a559f07b70ce681e6a94d83702adbcf28610d`, which carries the fixes for the
four findings of the independent review at
`architecture-reviews/microcosm-20260904/calibration-receipt-graph-fable51.md`.
The original branch's record below is kept as written except where a statement
turned out to be wrong; those are corrected in place with the correction marked,
not deleted.

Goal: a bounded, receipt-backed graph/list/inspector for the actual immutable
candidate `us-graph-f001-geography-20260905-v1`, integrated into the Pipeline
view, drawing only recorded typed-artifact dependencies and keeping execution,
cache, gate and mapping state on separate axes.

## State

Original build complete and frozen at `ce1a559`. Review fixes in progress on the
dependent branch; see the review-fix section below.

## Review fixes (branch `candidate-receipt-graph-review-20260905`)

### State

All four findings and every smaller note addressed, red-then-green. Frozen
clean. Nothing pushed. Ports 4397 and 4398 were left running throughout; the
browser pass used 4483.

### Done

Baseline on the new branch first reproduced the original figures: `bun test`
507 pass / 0 fail / 1851 assertions.

Fifteen assertions and two unloadable modules were committed failing at
`25e042d` before any fix, and pass at `0691785`:

- **Finding 4, precedence.** Two independent sources in the projection can name
  the same node: the run-level `known_failures` list, and the executor's own
  per-node `receipt.execution.state`. `executionState` now reads the executor's
  `blocked` before the run-level `failed`, so a node the executor recorded as
  unreached reads "Never reached" rather than "Failed". A gate exception is
  still a failure, because that too is the executor's per-node record. Both
  shipped manifests record an empty `known_failures`, so nothing here is
  triggered by this candidate; the case is built in a test.

  *Not verified this session:* the review attributed the collision to
  `known_failures` sweeping in gates whose outcome is `unreached`, citing
  `manifest.py:583-595`. That file was not found in any repository reachable
  from here, and the derivation of `known_failures` is not defined in this
  repository — the generator carries the list through as recorded. The fix
  therefore rests on the narrower premise that a per-node record from the
  executor is more direct than a run-level list, which is true whatever
  populates the list. Comments and tests were rewritten to claim only that.
- **Finding 4, `not_applicable`.** A gate outcome of `not_applicable` had been
  folded into the passing state. It is its own `GateState` now, worded "Gate not
  applicable", neutral tone, and it withholds nothing — it certified nothing and
  refused nothing.
- **Finding 2, outputs.** `outputs_usable` was a boolean, so a receipt that
  recorded no typed or opaque artifact was told to the reader in the same
  warning words as one whose outputs were withheld. Two of the six receipts on
  the only shipped candidate are the first kind, one of them after recording 248
  per-column artifacts. There is a third `OutputState` now,
  `no_typed_artifact`, rendered neutrally, and its sentence says what the
  receipt did record. Failure, blocking and absence still outrank all of it.
- **Finding 3, incomplete selection.** A URL carrying a candidate and no usable
  manifest digest left the query disabled and `isPending` true forever, so the
  view read "Reading the candidate's build receipts…" and never stopped. One
  pure function, `graphSelectionReadiness`, now decides both whether the query
  runs and what the view says when it does not, and that state reads
  "Incomplete candidate selection".
- **Finding 1, scope.** See the correction below. The limits now name the
  compiled structural declaration as unpinned rather than as nonexistent.
- **Note, what the publisher binds.** The two run-manifest byte digests that
  tell the executions apart are pinned by nothing the publisher attached, unlike
  the population, implementation, content-key and source digests. The payload's
  `execution_note` says so and is now rendered directly under the content-key
  note in the comparison card, not only in the folded limits.
- **Note, canvas accessibility.** `role="img"` hid a subtree that still held the
  three zoom buttons and the attribution link. The container is a labelled
  `role="group"` now, so those controls stay addressable and named.
- **Note, the absent-state fallback.** It omitted `frame_key` and `weight_key`
  and compiled only because the value it stood in for is typed non-nullable. It
  is an annotated constant now; deleting either field is a compile error
  (verified by deleting them and reading TS2739, then restoring).
- **Note, release status grammar.** "{status} from release" read oddly for
  anything but `excluded`. `releaseEligibilityReading` words the two statuses
  this evidence uses and names any other as a status.

Generator, adapter, presentation, types and tests were checked against each
other. No model status was invented: `not_applicable` is already a declared
outcome in the generator's `GATE_OUTCOMES`, and the generator's comment now
says why its `known_failures` is not the last word. The checked-in projection is
byte-unchanged and still regenerates to
`c28f3a88b16ad01bd7ae64e1c6a73de88a0cd4660333168c50a3ef0730c8c3f2`; nothing
under `_buildo-runtime` was written to.

### Correction: the compiled structural declaration is unpinned, not absent

The original author report said the compiled structural declaration "was never
serialised" and that "no amount of work here closes that". That is wrong, and
this record repeats the mistake by omission. `graph.json`
(`7d4e1502a89475726f3bc87f47f310e855e850343b6cd8da73c174a842ab94ac`) sits beside
the preserved run evidence and holds the full declaration: bases, populations,
column inputs and outputs, sources and artifact producers. It names two
relationships the run manifests cannot support and this viewer therefore does
not draw — `assign_us_puma_ladder.boundary` has `base:
assemble_stacked_spine`, and `assign_us_puma_ladder.gate` has `population:
assign_us_puma_ladder.boundary`.

Not drawing from it remains correct: no publisher attachment pins its bytes, so
nothing re-verifies that it belongs to this candidate. The accurate statement is
"unpinned, so unused", not "does not exist", and that is what the limits say
now. No edge was added, and the immutable candidate was not touched.

### Verified

| Command | Result |
| --- | --- |
| `bun test` (frontend) | 534 pass, 0 fail, 1953 assertions, 58 files |
| `bun run lint` (`tsc --noEmit`) | clean |
| `bun run build` | compiled, 21/21 pages |
| WebKit, playwright-core 1.58.0, port 4483 | 43/43 |

The browser pass ran real WebKit through `playwright-core`, never Chrome and
never CDP, against `bun run dev` with `MICROCOSM_QUALITY_US_DIR` on the real
quality directory.

### Found while testing, not fixed here

With a candidate and no usable manifest digest, `useQualityManifest` still
issues `/api/microcosm/quality?view=manifest&…&manifest_sha256=` and the route
answers 503. That hook and that route are byte-identical to the base commit, and
the same request 503s for any unresolvable candidate, so it predates this branch
and is outside the paths this work owns. The receipt-graph route answers 400 for
the same input and never errors during the browser pass. Reported rather than
touched.

### Next

Nothing outstanding on this branch. Root's independent review of the frozen
commit.

## Done (original build, branch `candidate-receipt-graph-20260905`)

### Evidence verified first-hand (not taken from the assessment)

Byte digests recomputed with `shasum -a 256` in this session:

| File | SHA-256 |
| --- | --- |
| `quality/manifests/ff2f231b….json` (candidate manifest) | `ff2f231bbe96267bbb230264cece5131314edab449d9cdd03b85aa452535b885` |
| `f001-geography-v1/quality-aggregates/public-build-evidence.json` | `1d3b94d8720b07cb1be22fe65efd88eba31787742c090b411d28938e40abbf6b` |
| `f001-geography-v1/cold/graph-manifest.json` | `3467a00d64cd786f4351f298fe6d41ef2d144fc6f3cd41a1e30e824df2330070` |
| `f001-geography-v1/resume/graph-manifest.json` | `20c963e2cb6989ad1df396a03f8494fb566a47e3a6d8055fe20d85035b91161b` |

All four match the assessment. The configured quality directory is
`/Users/maxghenis/PolicyEngine/_buildo-runtime/out/us-graph-launch-20260905/quality`
(`index.json`, `manifests/`, `artifacts/`); the preserved run evidence is
`/Users/maxghenis/PolicyEngine/_buildo-runtime/out/us-graph-launch-20260905/f001-geography-v1`.

### The association chain that has to hold before anything is drawn

- The candidate manifest binds `build_manifest` at
  `artifacts/1d3b94d8….json`, scope `run`, identity
  `{candidate_release_id, run_id}` — those bytes are the public build evidence.
  This is a real publisher attachment, read through the existing verified
  reader.
- `provenance.source_implementation_sha256` =
  `18e1570b739557c70f3133988542747149c6a5977f7cb75ef492f7b4dba658d0`
  = build evidence `implementation_sha256` for every mode
  = `kernel_impl_hash` on all six node receipts.
- `population.sha256` = `9d648…` = build evidence `population_sha256`
  for `direct`, `cold` and `resume`.
- Build evidence `checks.cold.manifest_sha256` =
  `checks.resume.manifest_sha256` = `73639eb8…`, which is the `key` field
  inside **both** graph manifests. That is the computation content key, not a
  run-instance identifier; the two executions are distinguished by their
  manifest **byte** digests above.
- Build evidence `checks.cold.kernel_calls` = 4 and `checks.resume.kernel_calls`
  = 0, matching 4 computed / 2 cache hits in the cold manifest and 6 cache hits
  in the replay manifest.
- The `assign_us_puma_ladder.lookup` receipt pins
  `crosswalk_sha256 = c7cb040b…` and `ladder_sha256 = 39a2ab2a…`, equal to the
  build evidence `source_sha256.congressional_district_vintage_crosswalk` and
  `source_sha256.puma_ladder`.

### Recorded dependencies (the only edges that may be drawn)

From `typed_artifacts.inputs`, identical in both executions, with each
`producer_key` equal to the named producer's own node key:

- `assemble_stacked_spine.prepare` → `assemble_stacked_spine`
  (`frame_context`, `preparation`)
- `assemble_stacked_spine` → `assign_us_puma_ladder` (`frame_context`)
- `assign_us_puma_ladder.lookup` → `assign_us_puma_ladder`
  (`crosswalk`, `ladder`)

`assign_us_puma_ladder.boundary` and `assign_us_puma_ladder.gate` record no
typed inputs or outputs at all, so the saved manifests cannot support any edge
to or from them. Coverage is partial and has to say so.

> Corrected on the review branch: the compiled structural declaration does
> exist, in `graph.json` beside the run evidence, and it does name relationships
> for both of these receipts. It is unpinned by any publisher attachment, which
> is why nothing here is drawn from it. See "Correction: the compiled structural
> declaration is unpinned, not absent" above.

### Things the evidence does not support and that must stay unavailable

- Calibration diagnostics, cross-dataset, demographics, model coverage,
  release manifest, reform validation and validation reach are all `missing`
  on this candidate, each with the producer's own reason.
- No target binding, Chronicle fact mapping or concept alignment exists here.
- `release_eligibility` is `excluded`; `execution_status` is `completed`.
  Those are separate axes and both are shown.
- The manifests carry `host` (`MacBook-Pro-10.local`) and per-column artifact
  keys for 248 columns. Neither leaves the server.

### Built

- `lib/microcosm/graph/types.ts` — the browser-facing contract. Execution,
  cache, gate and mapping are four separate enumerations; artifact dependency,
  documentary citation and semantic alignment are three separate edge families.
- `lib/microcosm/graph/adapter.ts` — re-checks every identity the projection
  claims against the candidate manifest and the publisher's build evidence
  before a node is drawn, then derives edges from declared typed artifacts only.
- `lib/microcosm/graph/projections.ts` — lookup by (country, candidate,
  manifest digest) over imported modules. A request carries no path.
- `lib/microcosm/graph/presentation.ts` — wording per axis, Dagre layout,
  one-hop neighbours.
- `lib/microcosm/graph/navigation.ts` — URL selection and keyboard movement as
  pure functions, so both are testable without a browser.
- `app/api/microcosm/graph/route.ts` — immutable candidate in, allowlisted
  payload or an explicit `available: false` out.
- `components/microcosm/receipt-graph-{view,canvas}.tsx` — output-first list,
  ReactFlow 11 canvas, inspector; the list is the keyboard path.
- `components/microcosm/microcosm-pipeline-view.tsx` — receipts first, July
  overview folded away and dated, `acs_rent` marked as under revision.

Per-execution frame and weight keys are kept unmerged, so two executions that
recorded different frames would show two values rather than the first one.

### Tested

`bun test` — 507 pass, 0 fail across 58 files. `bun run lint` (`tsc --noEmit`)
clean. `bun run build` succeeds; `/api/microcosm/graph` is served dynamically
and `/microcosm/pipeline` prerenders.

The route and adapter tests read the actual publisher bytes, checked in under
`lib/microcosm/graph/fixtures/` and content-addressed by their own digests, so
editing a fixture fails the test rather than changing what it claims:

- the immutable candidate manifest `ff2f231b…`,
- the run-scoped build evidence `1d3b94d8…` it attaches,
- the manifest of `us-graph-f001-assembly-20260905-v1`, a real build that failed
  before population construction and that this dashboard ships no receipts for,
- a deliberately tampered copy of the first, kept at the filename the untampered
  bytes content-address, so the reader has a real hash mismatch to refuse.

Covered: the four-computed/two-hit versus six-hit pair; identical output pins
under a shared content key with differing manifest bytes; eighteen adversarial
binding refusals; dropped edges for absent and mismatched producers; failure,
gate exception, blocking and absence outranking a recorded output; a passing
gate not completing anything else; partial coverage; retained URL selection and
keyboard movement; and the absence of hosts, paths, payload bytes and individual
identifiers from both the route body and the rendered markup.

Quality's "Build provenance" attachment row now links to the Pipeline page
through `QualityLink`, so the candidate travels with the reader.

### Exercised in a real browser

WebKit (playwright-core 1.58.0, `p.webkit`; corrected on the review branch from
the 1.56 written here — the harness's `bun.lock` pins `playwright-core@1.58.0`,
its `node_modules` copy was installed before this pass, and a run today reports
1.58.0 at runtime), against `bun run dev` on port 4471 with
`MICROCOSM_QUALITY_US_DIR` pointed at the real quality directory. Ports 4397 and
4398 were left alone. 26 of 26 checks pass: six receipts listed and six cards
drawn with three edges; partial coverage stated; Enter, ArrowUp/Down, Home/End,
Escape and focus restoration; the candidate surviving every move; the execution
toggle; the folded, dated July overview and its ACS rent notice; reduced motion;
390px with no horizontal overflow, no desktop-only blocker and the inspector
stacked above the canvas; and an unsupported candidate reading unavailable
without showing this one. No console or page errors.

That pass found one real defect, now fixed: `graphSelectionUrl` returned a bare
pathname, and the router prepends the app's base path, so selecting a step
navigated to a doubled path and a 404. It returns an absolute URL now, the same
shape `selectionUrl` already returned for the candidate selector.

## Next (original build, completed)

1. Author report and patch.

## Receipt consistency correction — 2026-09-05

- State: bounded correction on dependent base `5627aac7d8f68662c1dc85eb5e31cc879648559c`; underlying work is not root-approved.
- Done: read repository guidance, native and ROOT successor probes, adapter/types, publisher fixture and generator. Confirmed clean requested branch/base; artifacts and existing servers preserved.
- Next: commit failing regression tests, fix verification and typed-edge consistency, run graph/quality/route tests, TypeScript and one green full suite; freeze commits and write review receipts.

- State: red regression step recorded before adapter edits.
- Done: unchanged baseline 62/62 passes; expanded adapter tests 68 pass / 42 fail, covering summary/identity/execution/gate refusals, declared typed-output matching, state precedence and the retained unpinned-byte limit. Logs: `/private/tmp/calibration-receipt-consistency-20260905/{baseline-adapter,red-adapter}.log`.
- Next: implement bounded checks. Read-only generator audit confirms explicit field selection and no actual path leak in shipped evidence; the source-like detail probe mutates projection content only.

- State: adapter correction green for graph/route/view; review tightened ambiguous typed-input slots (supplemental red: 111 pass / 1 fail).
- Done: enforce execution/receipt uniqueness, content-key and published summary consistency, required receipt implementation/source pins, full published gate evidence agreement and typed producer declarations. Preserve generator cache-count semantics independently of failed/blocked states, prior labels/mobile behavior and projection-asserted execution byte digests. No generator/artifact/type/presentation/dependency changes.
- Validation: TypeScript passed. Broader relevant run: 245 pass / 3 local-HTTP setup failures; sandbox denies socket binds (`Operation not permitted`), preventing private-port WebKit too. Next: final review, one full suite, frozen hashes and reports with explicit environment limits.

- State: follow-up consistency review complete.
- Done: refuse contradictory known-failure lists, blocked/gate-exception summaries and executor flags without deriving producer failures; keep explicit rejection and blocked-over-failure semantics. Dropped typed inputs cannot leave coverage marked complete. Red state/coverage tests: 115 pass / 18 fail; green: 133/133 pass.
- Next: final checks and freeze. Requested review-directory writes also return `Operation not permitted`; reports will be staged in the temporary log directory for collection. Subfleet owns the final author-report capture.

- State: code frozen after independent bounded review; validation limits remain explicit.
- Done: final adapter 133/133; relevant tests in final suite 268 pass / 3 sandbox local-server setup failures; full suite run once, 602 pass / 3 setup failures across 58 files; final TypeScript clean (Bun 1.3.12, TypeScript 5.9.3). Native probe baseline observation equals ROOT's reproduction; contradictory claims refused or typed evidence omitted with reasons.
- Next: collect staged details/receipt/patch/logs from `/private/tmp/calibration-receipt-consistency-20260905`. Managed permissions block requested review-directory writes and all private-port binds, so remote-source tests and actual WebKit remain unverified here. No interface change required a build. Existing 4397/4398/4402 listeners remain untouched; no push/deploy, candidate/fixture/generator/dependency changes or original-source/microdata reads.
