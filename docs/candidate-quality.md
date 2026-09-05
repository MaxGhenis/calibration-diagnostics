# Candidate quality evidence

The dashboard can inspect an unpublished population through an immutable candidate manifest. This is a separate evidence channel: registration does not promote a dataset, update release or staging pointers, or change the exact-k runner's `--no-staging` guard.

## Local configuration

Set exactly one source for each country used:

- `MICROCOSM_QUALITY_US_DIR`: an absolute directory containing `index.json`, `manifests/` and aggregate attachments.
- `MICROCOSM_QUALITY_US_BASE_URL`: a server-configured HTTP(S) directory with the same layout. Redirects, embedded credentials, query strings and fragments are refused.

Use the corresponding registered country code for other countries. These are server settings, never browser query parameters. Local reads enforce the configured directory after resolving symlinks. Attachment paths must be safe relative paths; individual JSON artifacts are limited to 64 MiB. Do not place population microdata in this directory.

Configure the ordinary Cross-dataset source separately when inspecting its historical/default view, following [the existing configuration contract](cross-dataset-api.md#configure-the-application). Candidate Cross-dataset evidence uses its bound attachment and never falls back to that default source.

With genuine evidence already registered, start the local app from `frontend/`:

```sh
MICROCOSM_QUALITY_US_DIR=/absolute/path/to/candidate-quality bun run dev
```

The dev runner prints the selected port. The default mount is `/calibration/dashboard`. Open `/calibration/dashboard/microcosm/quality?country=us&candidate=<existing-release-id>&manifest_sha256=<64-character-sha256>`. Direct links work without a discovery index. The dashboard never automatically chooses the newest candidate; excluded diagnostic references require explicit selection.

## Manifest and identity contract

The TypeScript contracts live in [`types.ts`](../frontend/lib/microcosm/quality/types.ts); validation lives in [`artifact.ts`](../frontend/lib/microcosm/quality/artifact.ts).

An immutable `microcosm.candidate_quality.v1` manifest lives at `manifests/<sha256>.json`, where the digest identifies its exact UTF-8 bytes. It contains:

| Field | Meaning |
| --- | --- |
| `country` | Registered lowercase country code. |
| `candidate_release_id` | Existing producer release identifier; this transport does not assign a competing identity. |
| `run_id`, `created_at` | Population build/graph run and timestamp, including timezone. |
| `execution_status` | `pending`, `running`, `completed`, `failed` or `cancelled`. |
| `release_eligibility` | `{status, reason}`; status is `not_evaluated`, `eligible`, `ineligible` or `excluded`. This is a producer attestation, separate from execution progress. |
| `population` | `{sha256, period, entity}`; period is a string and the digest identifies the actual population artifact. It may be null only for pending/failed/cancelled pre-population builds. |
| `provenance` | Known string-valued build/model/target identities, such as `microcosm_commit`, `model_package`, `model_version`, `model_commit`, `target_surface_sha256`, `chronicle_snapshot_id`. Unknown values are omitted. |
| `geography` | Optional `{levels, vintage}` metadata. Do not invent a boundary vintage. |
| `attachments` | Named evidence descriptors, below. |

An `eligible` attestation requires a completed build and an actual population identity. Neither low calibration error nor a completed run changes eligibility in the consumer. The digest authenticates bytes and their supplied association; it does not independently establish scientific validity.

Every available attachment contains `status: "available"`, `scope`, safe relative `path`, lowercase `sha256`, and `identity`:

- `population`: exact `candidate_release_id` and `population_sha256`; supplied model/target identities must also agree with the manifest's corresponding provenance when present.
- `model`: actual `model_package` and `model_version`, optionally its commit. This evidence cannot claim a population or candidate identity. A model coverage inventory does not establish population reach.
- `run`: exact `candidate_release_id` and build `run_id`, without a population digest. This supports honest error/build evidence before a population exists.

Unavailable attachments contain `status: "pending" | "missing" | "failed"` and a nonempty `reason`. Omitted expected families appear as missing; they never become zero metrics.

Initial families are `calibration_diagnostics`, `support`, `distributions`, `cross_dataset`, `validation_reach`, `reform_validation`, `build_manifest`, `release_manifest` and `demographics`. The consumer preserves existing calibration and Cross-dataset schemas. The expected descriptor list is broader than the currently rendered evidence views: build/release/demographics feed calibration provenance, and reform validation remains owned by the scorecard.

Population attachments with embedded `release_id`, `candidate_release_id` or population digests must match their binding. Every embedded identity field also present in its descriptor must agree. Validation reach additionally checks nested `source.version` and `source.commit` against its declared model identity. Only population-scoped optional build/release/demographics artifacts enter legacy calibration shaping, which derives population-specific coverage, target status and loss semantics from them. Run/model artifacts remain declared in the quality manifest without supplying those metrics.

### Cross-dataset bundles

Point `cross_dataset` to the existing `cross_dataset.frontend_bundle.v1` manifest. Its population-scoped descriptor names `run_id`, `snapshot_id` and candidate `source_id`, alongside the candidate/population binding. The evaluation run and snapshot are independent evidence identities; the evaluation run need not equal the population build run.

Copy the whole bundle without changing its original relative partition layout, typically under `artifacts/<bundle-manifest-sha256>/manifest.json`. The existing Cross-dataset reader still checks run, snapshot, jurisdiction, source and partition hashes. Registering only the manifest without its partitions produces unavailable evidence.

### Discovery

`index.json` uses `microcosm.candidate_quality_index.v1`, with `country`, `updated_at` and `candidates[]`. Each entry includes candidate ID, run ID, execution status, eligibility, `updated_at`, and `manifest: {path, sha256}`. Candidate IDs are unique in the index. Keep older immutable manifests addressable when replacing an entry.

Publish attachment bytes first, then the content-addressed manifest, then optionally the discovery index. The discovery feed is marked stale after 24 hours; this does not turn a completed immutable run into a stalled run. A timestamp over five minutes in the future has unknown freshness.

## Population aggregates

[`aggregates.ts`](../frontend/lib/microcosm/quality/aggregates.ts) defines and validates the first distribution/support contracts. Producers compute these using canonical typed-weight Frame reducers. The dashboard checks and displays their results; it does not reconstruct weights from microdata or infer metrics from gate messages.

All aggregates contain `candidate_release_id`, `population_sha256` and string `period`. Each geographic cell has `{level, id, label, vintage?}`. Machine IDs and labels remain separate. Comparisons require the same vintage, and congressional-district comparisons require a known vintage on both sides.

`microcosm.population_support.v1` contains `entity`, `weight_entity`, `weight_basis` and `rows[]`:

- `geography`, `record_count`, `positive_weight_count`, `weight_sum`;
- `effective_sample_size` and `max_weight_share` (null for zero total weight).

Counts must be nonnegative integers. Positive counts and total weight must agree. Effective sample size lies between one and the positive-weight count when weight exists; largest-weight share lies in `(0, 1]`. These statistics describe concentration, not independent source coverage.

`microcosm.population_distributions.v1` contains `series[]`, each with:

- `variable`, `label`, `entity`, `unit`, `weight_basis`, `bin_definition_id`, `geography`;
- ordered contiguous `bins[]`, each `{label, lower, upper, weight, share}`;
- `missing_weight`, `total_weight`.

Bounds are `[lower, upper)`, with the final upper bound included. Null bounds denote negative/positive infinity. Bin mass plus missing mass must account for total weight. Shares use total weight **including missing values**; they are null at zero total weight. These invariants catch malformed artifacts; they are not science thresholds.

Candidate/incumbent distributions overlay only when period, variable, entity, units, weight basis, bin definition, exact bounds and geographic identity/vintage match. Support comparisons also require identical record and weight definitions. A published incumbent without these aggregate attachments stays explicitly incomparable; supply its real evidence as an immutable candidate transport reference to enable the comparison.

## Selection and existing views

URL context consists of `country`, `candidate`, `manifest_sha256`, `release` and `incumbent`. Incumbent accepts an existing published release ID or `candidate:<existing-id>:<sha256>`. Changing country clears repository-specific identities. Changing population clears local fact/target selections; internal navigation preserves population context. External links do not export it.

Calibration uses the existing `buildCalibration` adapter with `candidate:<id>:<digest>` as a transport token. Target tables, target trees and version comparisons keep their existing identity and compatibility rules. Target inspection links come from actual calibration metadata. Structured geography work in dashboard #180 / core #855 remains the authority for those readers.

When a candidate is selected, staging displays that candidate's bound quality evidence. Without one, the legacy telemetry view has an explicitly separate run selection. Candidate variable lookup remains unavailable until candidate totals are supported; it never executes a calculation against a different published population. Legacy validation reach is labeled historical when there is no bound candidate attachment.

## Verification

Run from `frontend/`:

```sh
bun test
bun run lint
bun run build
```

Quality tests cover mixed identities, tampered hashes, missing evidence, independent evaluation runs and corrupted partitions, stale discovery, direct remote references, path/symlink/redirect confinement, model identity and URL selection. Browser QA must use genuine local producer outputs; test fixtures are excluded from discovery and are not shipped as real evidence.
