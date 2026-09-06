# Bytes the corrected exporter actually wrote

**INVENTED. These bytes describe no population, no ASEC data, no model output
and no genuine run.** They may not be cited as evidence about the United
States, and nothing here is a genuine export. The genuine income-v3 export does
not exist yet; when it does, root writes it to its own namespace and it is not
this.

## Why these files are in the repository

The reader's other income-v3 fixture, `invented-income-v3.ts`, is written by
hand. Hand-written fixtures agree with whatever the reader expects, because the
same person writes both — so a reader and a fixture can drift together, away
from the publisher, and every test still passes. That is precisely how this
profile came to pin `cpi_u_rs_2024_price_target_year`, a price series the
exporter never converted with.

These four files were written by the exporter itself. Reading them end to end
is the check the hand-written fixture cannot be: the shape is not this
dashboard's opinion of the contract, it is the contract.

## Provenance

| | |
|---|---|
| Exporter worktree | `microcosm-us-income-v3-export-review-fixes-20260906` |
| Exporter head | `5c276925c723e17af175709b5602ee7ace32d530` |
| `graph_evidence_income_v3.py` | sha256 `0259cbc64af1c860beeab5f73f4ccb10618854133a6d78df0a1aa511241f7a71` |
| Producer roster read from | `us_runtime/graph_asec_income.py`, sha256 `4d2a95348310eccf0f0d52bb68faa17ff12ae28267f9c7c6bea0ac3204bd0e66` |
| Generator | `R/calibration-income-v3-contract-alignment-generate-export.py` |

The generator calls the exporter's own `export_fixture` helper from
`packages/microcosm-build/tests/test_graph_evidence_income_v3.py`, substituting
the production accounting roster (`COORDINATES + RESULT_COLUMNS +
EVIDENCE_COLUMNS`, parsed from the producer's source rather than retyped) for
the helper's renamed `EVIDENCE_j` stand-ins. That substitution is the point:
the helper's own stand-in names hide the real ones, and the real first column is
`person_id` — the exact name the reader's publisher-text check refuses.

Every file is named by its own sha256 and is self-addressed.

| file | sha256 |
|---|---|
| `artifacts/44f09ca7….json` — graph receipts | `44f09ca7d226913b443d1dbe7a10424d82fdd01f2dbec0050f31d646e1b404c7` |
| `artifacts/7a33f6df….json` — build summary | `7a33f6dfb627ece3cf06aba0757b8998d8919447777accd85aa068e395cadf07` |
| `manifests/c9ec679f….json` — candidate manifest | `c9ec679f93cc0f30953edf78d0915f4c7c945dfd58a0c1072c669f83030a22b7` |

The two artifacts reproduce byte for byte across runs. The manifest does not:
the writer stamps a wall-clock `created_at`, so a regeneration produces a
different manifest digest and a different manifest filename. Regenerating
therefore requires updating the manifest name, the index below and the digests
recorded in the conformance test.

## `index.json` is written here, not by the exporter

The exporter deliberately writes no candidate index — its own test is named
`test_invented_five_node_export_reads_with_unchanged_writer_and_no_index`. The
app needs one to list a candidate, so `index.json` is generated on this side
from the manifest's own fields and is the only file here the exporter did not
write. It adds no claim: every value in it is copied from the manifest.

## Serving it

    MICROCOSM_QUALITY_US_DIR=<this directory> PORT=<free port> HOSTNAME=127.0.0.1 \
      node .next/standalone/server.js

then open

    /calibration/dashboard/microcosm/pipeline?country=us&candidate=us-asec-income-v3-15hh-invented-v1&manifest_sha256=c9ec679f93cc0f30953edf78d0915f4c7c945dfd58a0c1072c669f83030a22b7
