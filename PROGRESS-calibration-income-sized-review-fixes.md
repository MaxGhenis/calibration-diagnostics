# calibration income-sized evidence reader — review fixes

Successor lane to `PROGRESS-calibration-income-sized-evidence.md`. It closes the
five should-address findings (A1–A5) raised against the sized evidence reader
and surface at 5ba046e996cfd9ad603127481ea7138f58faeab9, in step with the
exporter lane that closes S1–S6.

## State

Branch `calibration-income-sized-review-fixes-20260906`, cut fresh from a newly
fetched `origin/main` (210f8a3f5cfe9cdee888f99820dfe13bad7223ea) and
fast-forwarded to the reviewed parent 5ba046e996cfd9ad603127481ea7138f58faeab9.

## Findings this lane closes

- A1 the scope note is read as free prose and is never reconciled with scope.
- A2 nesting rows are never compared with entity rows.
- A3 the recorded fact set is open, so undeclared facts render.
- A4 sized refusal tests accept any throw and name no reached check.
- A5 the selection rule is drawn without the operands it ranges over.

## Done

All five are closed, each with a focused regression.

- A1 `sizedScope` rebuilds the exporter's lede from the validated counts and
  compares it, last, so a wrong size refuses at the size.
- A2 each nesting row is compared with the entity row it restates, and the
  household and the person are refused as nested entities.
- A3 the recorded-count listing is closed in both directions.
- A4 every sized refusal case asserts `ReceiptGraphUnavailableError` and the
  chain of named checks it travelled through, with the raising line pinned by
  text. Three `reportedTotals` totals moved behind named single-line helpers so
  their frames are distinguishable.
- A5 the selection rule is drawn with its operands: the fraction in words, the
  realised count against the eligible count, and the eligible households per
  cohort beside the realised ones.

Also, in step with the exporter lane: `recorded_count_locations` replaces
`independent_recordings` with cold/warm restatements counted apart;
`reviewed_exporter_sha256` is read as sized-profile provenance and bound across
all three artifacts; the producer adapter is labelled an adapter; the three
headline entities draw first; the fixtures are regenerated from the corrected
exporter with a generator and receipt now committed beside them.

Sized contract 72 passed, sized surface 19 passed, and with the unchanged v3 and
base neighbours 524 passed, 0 failed, 0.32 s across 10 files. `bun run lint`
(tsc --noEmit) clean; `bun run build` exit 0 in 17.2 s.

## Next

- Render both fixtures at 390px and desktop, then report.
