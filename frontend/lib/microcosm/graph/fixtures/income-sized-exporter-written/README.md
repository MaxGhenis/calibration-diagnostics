# Bytes the sized exporter actually wrote, at two shapes

**INVENTED. These bytes describe no population, no ASEC data, no model output
and no genuine run.** They may not be cited as evidence about the United
States. The nine- and forty-one-household samples here are fixtures; no genuine
sized export exists yet. When one does, root writes it to its own namespace and
it is not this.

## Why two shapes

A profile that has only ever been read at one size still has its size baked in
somewhere — that is exactly what the fifteen-household profile turned out to be.
So the exporter wrote two:

| | `small/` | `wide/` |
|---|---|---|
| households | 9 | 41 |
| people | 31 | 107 |
| tax units | 14 | 55 |
| cohorts | 3 / 3 / 3 | **14 / 14 / 13** |
| producer schema | `income_v3_first_genuine` | `income_v3_measured_505hh` |
| entity structure recorded | no | yes |

`wide/` has deliberately unequal cohorts. That is the structural shape the
reviewed fifteen-household profile cannot express at all: its cohort table is a
literal `{2022: 5, 2023: 5, 2024: 5}` compared for whole-dict equality, so a
run whose cohorts differ from each other is refused before its size is even
looked at.

## Why these files are in the repository

The reader's other income fixture, `invented-income-v3.ts`, is written by hand.
Hand-written fixtures agree with whatever the reader expects, because the same
person writes both — so a reader and a fixture can drift together, away from the
publisher, and every test still passes. That is how this profile once came to
pin a price series the exporter never converted with.

These files were written by the exporter itself. Reading them end to end is the
check the hand-written fixture cannot be: the shape is not this dashboard's
opinion of the contract, it is the contract.

## Provenance

| | |
|---|---|
| Exporter worktree | `microcosm-us-income-sized-export-20260906` |
| Exporter head | `981b9b175f868ec3236cdcc7164fd6a7d0f5b17a` |
| `graph_evidence_income_sized.py` | sha256 `ac947bf761b062ee5560640618fbbd848fa8fae238ac5333602ea321ddae0268` |
| Reviewed profile it imports | `graph_evidence_income_v3.py`, sha256 `0259cbc64af1c860beeab5f73f4ccb10618854133a6d78df0a1aa511241f7a71` |
| Producer roster read from | `us_runtime/graph_asec_income.py`, sha256 `4d2a95348310eccf0f0d52bb68faa17ff12ae28267f9c7c6bea0ac3204bd0e66` |
| Generator | `R/us-income-sized-export-generate-fixtures.py` |
| Generator receipt | `R/us-income-sized-export-generated-fixtures.json` |

The generator calls the sized exporter's own `export_fixture` helper from
`packages/microcosm-build/tests/test_graph_evidence_income_sized.py`,
substituting the production accounting roster (`COORDINATES + RESULT_COLUMNS +
EVIDENCE_COLUMNS`, parsed from the producer's source rather than retyped) for
the helper's renamed `EVIDENCE_j` stand-ins. That substitution is the point:
the helper's stand-in names hide the real ones, and the real first column is
`person_id` — the exact name the reader's publisher-text check refuses, and
which the closed column roster admits by name instead.

Every file is named by its own sha256 and is self-addressed. The two artifacts
reproduce byte for byte across runs; the manifest does not, because the writer
stamps a wall-clock `created_at`. Regenerating therefore requires updating the
manifest name, each `index.json` and the digests recorded in
`attachment-income-sized-contract.test.ts`.

## `index.json` is written here, not by the exporter

The exporter deliberately writes no candidate index. The app needs one to list a
candidate, so each shape's `index.json` is generated on this side from that
shape's manifest and is the only file here the exporter did not write. It adds
no claim: every value in it is copied from the manifest.

## Serving one

    MICROCOSM_QUALITY_US_DIR=<this directory>/wide PORT=<free port> HOSTNAME=127.0.0.1 \
      node .next/standalone/server.js

then open

    /calibration/dashboard/microcosm/pipeline?country=us&candidate=us-asec-income-sized-invented-wide-unequal-cohorts-v1&manifest_sha256=31e4cff839d4e4cd1068b791bb555c1b9f05d9f313f2585281d7430e90bb1101
