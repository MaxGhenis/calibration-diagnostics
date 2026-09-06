# income-v3 dashboard contract alignment — progress

Lane: align the local calibration dashboard reader, types, fixtures, tests and
surface with the **corrected** income-v3 exporter contract at
`microcosm-us-income-v3-export-review-fixes-20260906` head `5c276925`,
`graph_evidence_income_v3.py` sha256 `0259cbc6…`.

Local code, invented fixtures and browser checks only. This lane does not
export, does not install any genuine candidate, and writes no approval.

## State

- Worktree `/Users/maxghenis/PolicyEngine/_worktrees/calibration-income-v3-contract-alignment-20260906`
- Branch `calibration-income-v3-contract-alignment-20260906`, created from
  `upstream/main` = `210f8a3f5cfe9cdee888f99820dfe13bad7223ea`, then
  fast-forwarded to the reviewed dependent `5167b662…`
- Author worktree `calibration-income-v3-dashboard-20260906` preserved at
  `5167b662…`, clean, untouched

## Done

- [x] Inspected instructions, both worktrees' heads and clean status, remotes
- [x] Verified exporter worktree at exactly `5c276925…` and
      `graph_evidence_income_v3.py` at exactly `0259cbc6…`
- [x] Read `R/calibration-income-v3-dashboard-REPORT.md` (stale blocker + price
      assumption), `R/us-income-v3-graph-export-review-fixes-REPORT.md`/`.json`
- [x] Read root's separate export pins and operator declaration; confirmed the
      provisional export is REJECTED and must never be installed
- [x] Created the sibling worktree and fast-forwarded it

## Next

- [ ] Generate the corrected exported JSON from the real exporter's own fixture
      helper, with the real 28 accounting column names
- [ ] Fix `INCOME_V3.missing` (drop `prior_wages`; keep it in `not_claimed`)
- [ ] Replace the `price_target` basis field with the three published price
      fields; align types, reader, fixtures, tests, humane UI label
- [ ] Enforce the node producer roster reader-side
- [ ] Closed schema-column-name roster so `person_id` validates as a column name
- [ ] Mutation tests reaching each intended check
- [ ] Full bun lint / test / build, WebKit desktop 1440 + mobile 390
- [ ] Report to `R/calibration-income-v3-contract-alignment-REPORT.md`/`.json`

## Findings so far

- **Upstream fetch is broken in the shared git dir.** `git fetch upstream` exits
  128 with "pack has 90 unresolved deltas". `git fsck --connectivity-only`
  reports `missing commit 54a0b3326c7f8445003a2b9dcdc4cd70f325a412`, broken link
  from `2d7f8a1896914e2a5704fc2036d125ca44cdfc74`, which is an ancestor of both
  `upstream/main` and `5167b662`. Pre-existing; not this lane's to fix. The
  cached `upstream/main` was independently verified current against GitHub
  (`gh api repos/PolicyEngine/calibration-diagnostics/commits/main` →
  `210f8a3f…`, 2026-08-30), so branching from it is branching from latest.
- The shared git directory is `/private/tmp/us-genuine-graph-evidence-author-20260905-O0IgKV/dashboard.git`.
  Pre-existing; preserved, not relocated. Commits here are only as durable as
  `/private/tmp`.
- The real 28 accounting column names computed from production
  `us_runtime/graph_asec_income.py` (`COORDINATES + RESULT_COLUMNS +
  EVIDENCE_COLUMNS`) match, in order, the roster independently recorded in
  `R/us-income-v3-505hh-identity-probe.json` under
  `sides/{I,K}/contracts/ACCOUNTING_COLUMNS`. First name is `person_id`.
- The exporter's own test fixture renames the 19 evidence columns to
  `EVIDENCE_0…18`, which hides the dotted real names. This lane uses the real
  roster instead.

## Ground truth established (this session)

The corrected exporter was run through its own fixture helper with the real
production 28-column roster substituted, by
`R/calibration-income-v3-contract-alignment-generate-export.py`. Re-run this
session: the two artifacts reproduce **byte-identically**
(`graph-receipts.json` `44f09ca7…`, `build-summary.json` `7a33f6df…`), so the
shape below is read off real exporter output, not hand-maintained.

| contract point | exporter output |
|---|---|
| `reported_income.basis` | `price_basis=census_ccpiu_annual_2024`, `price_target_year="2024"`, `price_basis_resource_sha256=88cec207…`; **no `price_target`** |
| `quality.missing` | 9 items, **no `prior_wages`** |
| `reported_income.not_claimed` | 5 items, **includes `prior_wages`** |
| `scope.note` | "Fifteen sampled households from three source cohorts. This small engineering sample does not establish population accuracy." |
| `accounting_columns[0]` | `{name: "person_id", dtype: "<i8", sha256: …}` — 28 entries, `name`/`dtype`/`sha256` only |
| producer roster | `INPUT_PRODUCERS`: accounting may consume `create` + `select_households`, **never** `engine_current_money` |

The 28 names were computed from production `graph_asec_income.py`
(`COORDINATES + RESULT_COLUMNS + EVIDENCE_COLUMNS`) and match, in order, the
roster independently recorded in `R/us-income-v3-505hh-identity-probe.json`
under `sides/{I,K}/contracts/ACCOUNTING_COLUMNS`. Row width 91 = 8x9 + 19.

Zero-origin bound: the exporter requires `sum(signed classes) == 52` per result
column but sets **no** bound on zero-origin class counts. The reader's
`bounded(0, 52)` is legitimate — the classes are a per-person-per-year
classification and the exporter's contract accounts exactly 52 people. Per-cohort
*person* counts are not published, so the bound stays 52 and is not narrowed.

`upstream/main` re-verified current this session against GitHub
(`210f8a3f…`, 2026-08-30). `git fetch upstream` still fails with the pre-existing
"pack has 90 unresolved deltas"; the cached ref is unchanged and correct.
