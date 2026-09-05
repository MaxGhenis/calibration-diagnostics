# Candidate quality fixture for the receipt graph route

Unmodified publisher bytes, copied out of the configured US quality directory
for the `us-graph-launch-20260905` build. Every file is content-addressed by its
own SHA-256, and the reader under test verifies that digest before parsing, so
editing any byte here fails the test rather than changing what it asserts.

| File | What it is |
| --- | --- |
| `manifests/ff2f231b….json` | The immutable candidate manifest for `us-graph-f001-geography-20260905-v1`. Its `build_manifest` attachment is what binds the run receipts to this candidate. |
| `artifacts/1d3b94d8….json` | That attachment: the published run-scoped build evidence, naming the population digest, the implementation hash, the per-mode content keys and kernel-call counts, and the source digests. |
| `manifests/e6b41503….json` | The immutable candidate manifest for `us-graph-f001-assembly-20260905-v1`, a real build that failed before population construction. The dashboard ships no receipts for it, so it is the case where the answer has to be "unavailable" rather than another candidate's run. |

The candidate this describes is an uncalibrated development assembly that is
excluded from release. Nothing here is a scientific result, and no aggregate in
it was evaluated against a reference, a target or a heldout cell.

These are aggregate build records: content digests, row and weight totals,
enumerated states and authored reasons. They contain no person record, no
individual identifier and no filesystem path outside the artifact directory.
