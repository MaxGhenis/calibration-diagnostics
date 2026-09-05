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

Started. Baseline on the new branch reproduces the original figures: `bun test`
507 pass / 0 fail / 1851 assertions.

### Next

1. Red tests for the four review findings and the smaller notes.
2. Fixes, then green.
3. `tsc --noEmit`, `next build`, WebKit checks on a free local port.
4. Detail receipt and JSON receipt in the review directory; frozen commit.

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

WebKit (Playwright 1.56, `p.webkit`), against `bun run dev` on port 4471 with
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

## Next

1. Author report and patch.
