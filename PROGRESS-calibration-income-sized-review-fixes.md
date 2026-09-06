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

- Nothing yet beyond lane setup.

## Next

- Trace each finding against the reader, then correct it with a focused test.
