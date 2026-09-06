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
| eligible households per cohort | 300 / 300 / 300 | 1,400 / 1,400 / 1,300 |
| sampling fraction | 0.01 | 0.01 |
| producer schema | `income_v3_first_genuine` | `income_v3_measured_505hh` |
| entity structure recorded | no | yes |
| population digest | `13973c961ea39995ac7085b2f92160485cf83abc5852685c968a34e96f1629f0` | `41c38ba897e673ae6d8de157b609f7b44e6577620157ff2fca0c14c08cd9ca83` |

The two population digests differ on purpose. Both shapes previously carried one
invented checkpoint, so the manifest's population binding was only ever exercised
at a single value — the same blind spot a profile with its size baked in has.

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

The generator and its receipt live in this repository now. They used to sit in a
review directory outside it, which made every line of this table unverifiable
from a checkout — the one thing a provenance table exists to prevent.

| | |
|---|---|
| Generator | [`frontend/scripts/write-invented-income-sized-candidates.py`](../../../../../scripts/write-invented-income-sized-candidates.py) |
| Generator receipt | [`generated.json`](generated.json), beside these files |
| Generator sha256 | `325a1934e8e2623ffae7289fc683dcfa573a3ac8940e1636067d544c75233a48` |
| `graph_evidence_income_sized.py` | sha256 `b781734a6ce959c65e54f82fc1ccf292043559114ad201e509afc305602d77a7` |
| Its test helper | `test_graph_evidence_income_sized.py`, sha256 `57604c11673b37cdce648b308cf6a79b0c2e2befd3634b3cb3918bc8ed0a33b6` |
| Reviewed profile it imports | `graph_evidence_income_v3.py`, sha256 `0259cbc64af1c860beeab5f73f4ccb10618854133a6d78df0a1aa511241f7a71` |
| Base exporter beneath both | `graph_evidence.py`, sha256 `970d95541f9f6d66f4d7adea3f7583d373bcc9b24c51fcc4324c2bf003cb055d` |
| Producer roster read from | `us_runtime/graph_asec_income.py`, sha256 `4d2a95348310eccf0f0d52bb68faa17ff12ae28267f9c7c6bea0ac3204bd0e66` |

`generated.json` records all of the above plus, per shape, the candidate and
artifact digests, the population digest, the published sampling operands and the
recorded count locations. Every digest in the table is written by the run that
wrote the bytes, so the table can be checked rather than believed.

The generator calls the sized exporter's own `export_fixture` helper from
`packages/microcosm-build/tests/test_graph_evidence_income_sized.py`,
substituting the production accounting roster (`COORDINATES + RESULT_COLUMNS +
EVIDENCE_COLUMNS`, parsed from the producer's source rather than retyped) for
the helper's renamed `EVIDENCE_j` stand-ins. That substitution is the point:
the helper's stand-in names hide the real ones, and the real first column is
`person_id` — the exact name the reader's publisher-text check refuses, and
which the closed column roster admits by name instead.

It refuses to run at all unless `graph_evidence_income_v3.py` and
`graph_evidence.py` still hash to the accepted heads, so a fixture set cannot be
regenerated against a quietly changed reviewed profile.

Every file is named by its own sha256 and is self-addressed. All three files
reproduce byte for byte across runs from unchanged exporter bytes: the writer
takes `created_at` from the metadata the exporter passes it, which is the
declaration's fixed timestamp, not a wall clock. So the digests move when — and
only when — something the exporter writes into them moves, which includes the
exporter's own `exporter_sha256`. When they do move, the digests recorded in
`attachment-income-sized-contract.test.ts` and in the table above have to be
updated with them; the generator rewrites each `index.json` and `generated.json`
itself.

    python frontend/scripts/write-invented-income-sized-candidates.py \
      --microcosm /path/to/microcosm \
      --out frontend/lib/microcosm/graph/fixtures/income-sized-exporter-written

## `index.json` is written here, not by the exporter

The exporter deliberately writes no candidate index. The app needs one to list a
candidate, so each shape's `index.json` is generated on this side from that
shape's manifest and is the only file here the exporter did not write. It adds
no claim: every value in it is copied from the manifest.

## Serving one

    MICROCOSM_QUALITY_US_DIR=<this directory>/wide PORT=<free port> HOSTNAME=127.0.0.1 \
      node .next/standalone/server.js

then open

    /calibration/dashboard/microcosm/pipeline?country=us&candidate=us-income-sized-invented-wide-v1&manifest_sha256=b139714da64353e169f0c2d3affcbbf7f3efa788f6148eebf262f69151b07b0e
