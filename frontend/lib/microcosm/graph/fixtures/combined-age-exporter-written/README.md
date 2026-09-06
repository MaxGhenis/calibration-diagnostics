# Invented combined age exporter fixtures

These immutable candidate attachments were produced by the independently authored
`microcosm.build.graph_evidence_combined_age` exporter over invented aggregate
receipts at 20 and 200 households. They contain no genuine population/source data.
The sources are the sealed `exporter-fixtures-v3` contract drop in the local
architecture review workspace. Each `export-reference.json` records the exact
candidate manifest and attachment digests; tests verify the bytes still hash to
those names. `candidate/` deliberately contains no discovery index.

Both fixtures have 18 age bands, a zero-support band, and a failed geography gate
without an executor exception. The four executions preserve that distinction.
The frontend does not rewrite these bytes to make its reader pass. The earlier
hand-built contract sketch is not a reader fixture.
