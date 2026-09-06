# Aggregate graph receipt attachments

An immutable candidate can publish `graph_receipts` with schema `microcosm.graph_receipts.v1`, using a population-scoped descriptor. Its run-scoped `build_manifest` has schema `microcosm.graph_build_summary.v1` and names the exact graph attachment digest. Neither serialized attachment contains a candidate manifest digest; the selected digest enters only the verified in-memory graph view.

The graph route reads the selected manifest first. A present graph key selects only the attachment path, including publisher-declared pending, missing and failed states. Present unsupported, malformed, unsafe or tampered evidence is refused. Only an absent key can select the exact existing local projection registry entry. The unchanged quality reader continues to authenticate artifact bytes and embedded identities. Unreadable manifests retain its sanitized503 response, while invalid immutable request tokens return400.

The attachment entry point in `frontend/lib/microcosm/graph/attachment.ts` validates closed field vocabularies, finite aggregate values, exact lowercase hashes, bounded labels/reasons and list counts. The route wraps the unchanged reader's byte source with a4MiB limit for each graph/build attachment, including whitespace; the normalizer also caps serialized data at4MiB and nesting at16. The base quality reader's general64MiB transport limit is unchanged. No source files, binary arrays or raw execution manifests are opened by this path.

Every execution uses the existing `ProjectionExecution` and `ProjectionNode` vocabulary. The only wire identity renaming is explicit: `execution_manifest_sha256` becomes the existing in-memory `manifest_sha256`, and `computation_content_key` becomes `content_key`. Both are checked against distinct build-summary fields. Raw-manifest digests are publisher-authenticated pointers, not proof the browser independently interpreted the raw manifests.

The implementation set maps every node to its own kernel reference and implementation hash. Its digest is SHA-256 of ASCII-sorted node IDs, a tab, lowercase64hex implementation hash and newline per entry. Kernel references are checked separately. Repeated implementation hashes across different nodes are valid. The aggregate view uses a nullable single implementation hash and an explicitly labelled set digest; node inspectors retain individual hashes.

The shared state, gate, edge and renderer functions are reused. Failed, absent, unreached and gate-exception states retain their distinct readings. Only matching typed producer/input references form edges. Source preparation is a recorded counter. Runner parity and cache equality never create a scientific gate. This engineering evidence remains excluded from release and does not supply calibration, support, holdout, distribution or policy-impact validation.

`projection.basis` exhaustively distinguishes `local_projection` from `authenticated_attachment`. The F001 source and projection fixtures remain unchanged; a full response snapshot asserts every legacy response field is unchanged after removing only `projection.basis` and `binding.implementation_set`.

Tests use invented aggregate fixtures and private ephemeral evidence directories with direct immutable URLs. They do not publish a discovery index or register a real run. Production browser checks and output-only real-run integration are recorded separately in the author receipt.

The combined ASEC+ACS national age profile has its own closed attachment reader
and evidence panel. See [Combined survey national age evidence](combined-age-evidence-profile.md)
for its four-pass ancestry, calibrated checkpoint identity, support and solver
diagnostics, and explicit development scope.
