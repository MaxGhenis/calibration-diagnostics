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

Re-verified afterwards at head, which turned up seven further defects — one in
the original build and six introduced or left standing by these fixes. All seven
are fixed, each red before green, and each is recorded below in its own section
rather than folded into the four findings. The corrections that contradict what
this record said earlier are marked in place; nothing was deleted.

### Done

Baseline on the new branch first reproduced the original figures: `bun test`
507 pass / 0 fail / 1851 assertions.

Thirteen assertions and two unloadable test modules were committed failing at
`25e042d` before any fix, and pass at `0691785`. `bun test` reports that as
"15 fail, 2 errors" — the two modules that could not load are counted inside the
fifteen, not alongside it, so the number of failing assertions is thirteen.
(Corrected here: this line previously said "fifteen assertions", which read
bun's total as if it were all assertions. The full-suite figure at `25e042d` is
480 pass / 15 fail / 2 errors / 495 run across 58 files; the two unloadable
modules are why 495 ran there and 534 run at head.)

The same red was re-demonstrated at head: with the eight implementation files
reverted to `ce1a559` and every test left at `5627aac`, the suite reports 480
pass / 16 fail / 2 errors — fourteen failing assertions, plus
`navigation.test.ts` and `presentation.test.ts` unable to load at all
(`Export named 'graphSelectionReadiness' not found`, `Export named
'selectionNotice' not found`). One assertion more than at `25e042d`, because
`5627aac` rewrote what the precedence test claims about the producer. The files
were restored in the same command and the tree verified clean afterwards.

What each fix is, and what it is red against:

- **Finding 4, precedence.** Two independent sources in the projection can name
  the same node: the run-level `known_failures` list, and the executor's own
  per-node `receipt.execution.state`. `executionState` now reads the executor's
  `blocked` before the run-level `failed`, so a node the executor recorded as
  unreached reads "Never reached" rather than "Failed". A gate exception is
  still a failure, because that too is the executor's per-node record. Both
  shipped manifests record an empty `known_failures`, so nothing here is
  triggered by this candidate; the case is built in a test.

  *Verified, after this record twice said otherwise:* the review attributed the
  collision to `known_failures` sweeping in gates whose outcome is `unreached`,
  citing `manifest.py:583-595`. An earlier commit on this branch said that file
  "was not found in any repository reachable from here" and narrowed every
  comment accordingly. That was wrong. It is
  `packages/microcosm-graph/src/microcosm/graph/manifest.py` on `origin/main` of
  the local microcosm clone at `/Users/maxghenis/PolicyEngine/microcosm`, and
  read there this session, `Manifest.known_failures` collects every gate node
  whose outcome is outside `_CERTIFYING_GATE_OUTCOMES = {"pass",
  "not_applicable"}`, plus any node explicitly rejected. `unreached` is outside
  that set, so an unreached gate does land in the list, exactly as the review
  said. The comments say that now, with the file named.

  Two things are still not established and are not claimed: the line numbers
  there are 526–539, not 583–595, so the revision read is not the one the review
  read; and which revision produced the two shipped manifests was not
  determined. The comment states what that file defines today, not what the run
  did. The behaviour is unchanged either way — the per-node record is read
  first — but the reason given for it is now the true one.
- **Finding 4, `not_applicable`.** A gate outcome of `not_applicable` had been
  folded into the passing state. It is its own `GateState` now, worded "Gate not
  applicable", neutral tone, and it withholds nothing — it certified nothing and
  refused nothing.

  *Corrected later in the session, twice.* "It certified nothing" is wrong: the
  producer's `_CERTIFYING_GATE_OUTCOMES` is `{"pass", "not_applicable"}`, so it
  counts this outcome as certifying alongside a pass. The accurate statement is
  that it is not a failure and it attested nothing about the step, which is why
  it is still not shown as a pass. The neutral tone also silently removed the
  canvas card's gate marker. Both are in "four defects in the fixes themselves"
  below.
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

  *Corrected later in the session.* The first wording drew the conclusion too
  wide — "that separation is asserted by this projection" — when the build
  evidence carries a check block for each mode, one recording four kernel calls
  and one none. That there were two executions is published; only the pairing of
  bytes to mode is this projection's. See "two places the record understates the
  evidence" below.
- **Note, canvas accessibility.** `role="img"` hid a subtree that still held the
  three zoom buttons and the attribution link. The container is a labelled
  `role="group"` now, so those controls stay addressable and named.

  *Extended later in the session.* A group also exposes what it contains, so the
  six cards were read a second time as loose text. The cards are `aria-hidden`
  now; the label, the controls and the list are unchanged.
- **Note, the absent-state fallback.** It omitted `frame_key` and `weight_key`
  and compiled only because the value it stood in for is typed non-nullable. It
  is an annotated constant now; deleting either field is a compile error
  (verified by deleting them and reading TS2739, then restoring).
- **Note, release status grammar.** "{status} from release" read oddly for
  anything but `excluded`. `releaseEligibilityReading` words the two statuses
  this evidence uses and names any other as a status.

  *Corrected later in the session.* "The two statuses this evidence uses" is
  wrong on both counts: `EligibilityStatus` declares four, and this evidence
  carries only `excluded`, in all three candidate manifests in the quality
  directory. All four are worded now.

Generator, adapter, presentation, types and tests were checked against each
other. No model status was invented: the generator's `GATE_OUTCOMES` is
character-for-character `microcosm.graph.decl.GATE_OUTCOMES`
(`("pass", "fail", "evidence_absent", "not_applicable", "unreached")`, read on
`origin/main` of the local microcosm clone), so `not_applicable` is the
producer's word, not this dashboard's. The generator's comment now says why its
`known_failures` is not the last word, and names the file that derives it. The checked-in projection is
byte-unchanged and still regenerates to
`c28f3a88b16ad01bd7ae64e1c6a73de88a0cd4660333168c50a3ef0730c8c3f2`; nothing
under `_buildo-runtime` was written to.

### Correction: the compiled structural declaration is unpinned, not absent

The original author report said the compiled structural declaration "was never
serialised" and that "no amount of work here closes that". That is wrong, and
this record repeats the mistake by omission. `graph.json`
(`7d4e1502a89475726f3bc87f47f310e855e850343b6cd8da73c174a842ab94ac`) sits beside
the preserved run evidence and holds the full declaration: bases, populations,
column inputs and outputs, sources and artifact producers.

It declares five base or population relationships across the same six nodes,
enumerated from the file itself:

| From | To | Kind | Drawn here |
| --- | --- | --- | --- |
| `assemble_stacked_spine.prepare` | `assemble_stacked_spine` | base | already an artifact edge |
| `assemble_stacked_spine` | `assign_us_puma_ladder.lookup` | population | no |
| `assemble_stacked_spine` | `assign_us_puma_ladder.boundary` | base | no |
| `assign_us_puma_ladder.boundary` | `assign_us_puma_ladder` | population | no |
| `assign_us_puma_ladder.boundary` | `assign_us_puma_ladder.gate` | population | no |

*Corrected again, later in this session:* this section first said the
declaration "names two relationships" the viewer does not draw, naming the two
that touch the two unconnected receipts. That was the review's phrasing and it
is an undercount. Four of the five would add a link the canvas does not have,
and with them every one of the six receipts is connected — the declaration is
the difference between the "4 of 6 connected" this view states and a complete
graph, not a detail at its edges. It also attaches sources to two nodes
(`asec_raw_stage` and `acs_native` on the spine preparation,
`us_puma_ladder_2020` and `us_cd_crosswalk_117_119` on the lookup), which is a
source edge family this view has no evidence for at all.

Saying that plainly is the point: the gap is large, and it is still not closed
here. No publisher attachment pins `graph.json`'s bytes, so nothing re-verifies
that this file belongs to this candidate, and an edge drawn from it would be an
edge the reader cannot check. The accurate statement is "unpinned, so unused",
not "does not exist", and that is what the limits say now. No edge was added,
the edge count is still three, nothing reads `graph.json` at runtime or in a
test, and the immutable candidate was not touched.

### Verified

Every row below was run at the head this record describes, not at an earlier
commit and then carried forward. The red row is the older head, `5627aac`;
later commits added tests of their own, each red before its fix and named in
the sections above.

| Command | Result |
| --- | --- |
| `bun test` (frontend) | 546 pass, 0 fail, 2007 assertions, 58 files |
| `bun run lint` (`tsc --noEmit`) | clean, exit 0 |
| `bun run build` | compiled, 21/21 static pages, exit 0 |
| WebKit, playwright-core 1.58.0, port 4483 | 48/48 |
| red at `ce1a559`'s implementation with head's tests | 480 pass, 16 fail, 2 errors |
| projection regenerated from the preserved evidence | byte-identical to the checked-in file |

The browser pass ran real WebKit through `playwright-core`, never Chrome and
never CDP, against `bun run dev` with `MICROCOSM_QUALITY_US_DIR` on the real
quality directory. The version is read at runtime from the harness's own
`playwright-core/package.json`, which resolves to 1.58.0, matching the 1.58.0
its `bun.lock` pins; the script prints the resolved version with its results
rather than naming one.

The regeneration wrote to `/tmp`, not into the evidence tree, and produced
`c28f3a88b16ad01bd7ae64e1c6a73de88a0cd4660333168c50a3ef0730c8c3f2` — `cmp`
against `lib/microcosm/graph/receipts/us-graph-f001-geography-20260905-v1.json`
reports no difference. The only change `5627aac` made to the generator is a
comment, so this is a check that the comment change altered nothing, and that
the projection at head still derives from the bytes it names.

`graph.json` beside the run evidence was re-hashed in this pass and is
`7d4e1502a89475726f3bc87f47f310e855e850343b6cd8da73c174a842ab94ac`, the digest
recorded in the correction below. Nothing reads it at runtime or in a test.

### Found while verifying, and fixed: four defects in the fixes themselves

Red at `0a9d4eb`, green at `e28c0f8`. None of these was in the review.

- **The gate marker vanished for a gate that did not apply.** The canvas card
  shows "· gate" when the gate reading's tone is not neutral. Giving
  `not_applicable` a neutral tone therefore took the marker away, so on the
  canvas that receipt looked exactly like one that recorded no gate at all —
  the confusion the separate gate axis exists to prevent. `gateRecorded` decides
  it now, which is a question about the record rather than about the tone.
- **"It certified nothing" contradicted the producer.**
  `_CERTIFYING_GATE_OUTCOMES` is `{"pass", "not_applicable"}`, so the producer
  groups the two. The help text now says the producer counts it alongside a
  pass, so it is not a failure, and that it attested nothing about the step,
  which is why it is still not shown as a pass. Keeping it distinct from a pass
  was the review's point and is unchanged.
- **`releaseEligibilityReading` worded two of four statuses**, and its comment
  called them "the two statuses this evidence uses". `EligibilityStatus`
  declares `not_evaluated`, `eligible`, `ineligible` and `excluded`; this
  evidence carries only `excluded`, in all three candidate manifests in the
  quality directory. All four are worded now and the comment says which one is
  actually present.
- **Both readings ended in a `default` branch**, which is precisely how
  `not_applicable` came to be read as a pass: the next member added is absorbed
  in silence. Each is exhaustive now over an `unread(state: never)` guard.
  Verified by adding a member to `GateState` and reading
  `TS2345 ... not assignable to parameter of type 'never'` at
  `presentation.ts:141`, then restoring it.

The canvas is also decorative on its cards now. `role="group"` fixed the
review's note — the zoom controls are no longer buried in a `role="img"`
subtree — but a group exposes what it contains, so a screen reader read the six
receipts a second time as loose text, without the relationships that are the
only reason to draw them. The cards carry `aria-hidden`, the group keeps its
one-sentence label, and the controls stay real controls. `nodesFocusable` and
`edgesFocusable` were already off, so the list remains the only keyboard path.

### Found while verifying, and fixed: adapter.ts read as a binary file

Not in the review. `adapter.ts` carried one raw NUL byte, at `ce1a559` and at
every commit after it: the separator joining a producer id to a consumer id in
the edge map was typed as the character rather than written as an escape. It is
correct at runtime and wrong on disk. `file` reports the module as `data`,
`grep -I` skips it without saying so, and `git` only missed it because its
binary sniff reads the first 8000 bytes and the NUL is at 18709. A grep for
`gateState` across this repository returned nothing from the one file that
defines it, which is how this was found.

The separator is now `PAIR_SEPARATOR`, an escape building the same
one-character string, so the edges are unchanged. Red at `51fb320`, green at
`8e357d6`. Two tests: every module in `lib/microcosm/graph` is free of NUL
bytes, and no node id contains the separator, so the thirty-six possible
producer/consumer pairs still produce thirty-six distinct keys.

This is a hygiene fix inside a file this branch already owns, not a feature
change. It is called out here because it was not requested.

### Left as written: the original author report

`architecture-reviews/microcosm-20260904/calibration-receipt-graph-author-report.md`
still contains the "was never serialised" sentence the review flagged. That file
is the frozen record of the original build at `ce1a559` and is not rewritten
here; the correction lives in this record and in the review receipt for these
fixes, which is where a reader is pointed.

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

Two things are named here rather than acted on, because both are outside what
this branch owns:

1. The compiled structural declaration would connect all six receipts and is
   pinned by nothing. Closing that is a publishing change on the producer's
   side — attaching `graph.json`, or its digest, to the candidate — not a
   dashboard change. Until then this view stays partial and says so.
2. `useQualityManifest` still issues a manifest request with an empty digest for
   an incomplete selection and takes a 503. That hook and that route are
   byte-identical to `6dda4e7`, and the same request 503s for any unresolvable
   candidate.

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
