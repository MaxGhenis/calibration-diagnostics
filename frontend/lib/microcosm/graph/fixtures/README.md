# Receipt graph fixtures

`us-graph-launch-quality/` holds unmodified publisher bytes; see its own README.

`us-graph-launch-quality-tampered/` is the same candidate manifest with its
release eligibility flipped from `excluded` to `eligible`, kept at the filename
the untampered bytes content-address. It exists so a test can watch the reader
refuse bytes that do not hash to the digest the request asked for, instead of
serving a claim nobody published. Nothing here should ever be read as evidence:
the candidate it describes is an uncalibrated development assembly excluded from
release, and this copy says the opposite on purpose.
