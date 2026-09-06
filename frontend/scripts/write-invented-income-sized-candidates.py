"""Regenerate the committed sized income-v3 fixtures by running the exporter.

INVENTED AGGREGATE EVIDENCE ONLY. Nothing here reads source data, a model, an
engine, a checkpoint or a genuine run, and no genuine sized export exists. The
bytes this writes describe no population and may not be cited as evidence about
the United States.

The point of these fixtures is that this side did not write them. A hand-written
fixture agrees with whatever the reader expects, because the same person writes
both; that is how the income-v3 profile once came to pin a price series the
exporter never converted with. So the exporter writes them: this script runs the
sized exporter's own invented-fixture helper at two shapes, substituting the real
production 28-column accounting roster (parsed out of the producer's source
rather than retyped) for the helper's renamed ``EVIDENCE_j`` stand-ins, and
copies the resulting output roots into the fixture directory.

It also writes ``generated.json`` beside them, which records every input digest
this run depended on -- including its own -- so the provenance in the README can
be checked rather than believed.

    python frontend/scripts/write-invented-income-sized-candidates.py \
      --microcosm /path/to/microcosm --out frontend/lib/microcosm/graph/fixtures/income-sized-exporter-written
"""

from __future__ import annotations

import argparse
import ast
import copy
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

# The reviewed profile the successor imports must be the accepted bytes. If this
# moves, the fixtures are describing a different contract and the check below
# stops the run rather than quietly recording the new digest.
EXPECTED_REVIEWED_SHA = "0259cbc64af1c860beeab5f73f4ccb10618854133a6d78df0a1aa511241f7a71"
EXPECTED_BASE_SHA = "970d95541f9f6d66f4d7adea3f7583d373bcc9b24c51fcc4324c2bf003cb055d"
ROSTER_SOURCE = "graph_asec_income source tuples, parsed without executing the module"
ROSTER_NAMES = ("COORDINATES", "RESULT_COLUMNS", "EVIDENCE_COLUMNS", "ACCOUNTING_DTYPES")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical(value) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()


def production_roster(producer: Path):
    """The producer's own 28 column names and dtypes, read without importing it."""
    tree = ast.parse(producer.read_text())
    namespace: dict = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        name = getattr(node.targets[0], "id", None)
        if name in {*ROSTER_NAMES, "CONTRIBUTING_FIELDS", "ACCOUNTING_COLUMNS"}:
            namespace[name] = eval(  # noqa: S307 - literal tuples from a pinned source
                compile(ast.Expression(node.value), "<roster>", "eval"), {}, namespace
            )
    names = [
        *namespace["COORDINATES"],
        *namespace["RESULT_COLUMNS"],
        *namespace["EVIDENCE_COLUMNS"],
    ]
    dtypes = list(namespace["ACCOUNTING_DTYPES"])
    assert len(names) == len(dtypes) == 28, (len(names), len(dtypes))
    # The real first column is `person_id` -- the exact name the reader's
    # publisher-text check refuses as prose and admits by name as a column. A
    # roster that lost it would make the fixtures weaker than the real thing.
    assert names[0] == "person_id", names[0]
    return names, dtypes


def real_columns(sized, names, dtypes, persons: int) -> list[dict]:
    """The real roster laid out contiguously over this shape's person count."""
    columns, offset = [], 0
    for name, dtype in zip(names, dtypes, strict=True):
        span = sized.ACCOUNTING_DTYPE_BYTES[dtype] * persons
        columns.append(
            {
                "bytes": span,
                "dtype": dtype,
                "name": name,
                "offset": offset,
                "sha256": hashlib.sha256(
                    f"invented-column:{name}:{persons}".encode()
                ).hexdigest(),
            }
        )
        offset += span
    assert offset == sized.ACCOUNTING_ROW_BYTES * persons
    return columns


def write_index(shape_root: Path, manifest: dict, manifest_sha: str) -> None:
    """The one file here the exporter does not write.

    The exporter deliberately writes no candidate index; the app needs one to
    list a candidate. It adds no claim -- every value is copied from the
    manifest the exporter did write.
    """
    index = {
        "candidates": [
            {
                "candidate_release_id": manifest["candidate_release_id"],
                "execution_status": manifest["execution_status"],
                "manifest": {
                    "path": f"manifests/{manifest_sha}.json",
                    "sha256": manifest_sha,
                },
                "release_eligibility": manifest["release_eligibility"],
                "run_id": manifest["run_id"],
                "updated_at": manifest["created_at"],
            }
        ],
        "country": manifest["country"],
        "schema_version": "microcosm.candidate_quality_index.v1",
        "updated_at": manifest["created_at"],
    }
    (shape_root / "index.json").write_text(json.dumps(index, indent=2, sort_keys=True) + "\n")


def generate(helper, sized, names, dtypes, size, label: str, out: Path) -> dict:
    columns = real_columns(sized, names, dtypes, size.persons)

    def use_real_columns(root, run, declaration, binding):
        helper.mutate_json(
            root,
            "direct-receipt.json",
            lambda v: v["result"].__setitem__(
                "reported_income_columns", copy.deepcopy(columns)
            ),
        )

    temporary = Path(tempfile.mkdtemp(prefix=f"income-sized-fixture-{label}-"))
    try:
        reference = helper.export_fixture(
            temporary, size, mutate=use_real_columns, output="quality"
        )
        written = temporary / "quality"
        manifest_sha = reference["sha256"]
        manifest_raw = (written / "manifests" / f"{manifest_sha}.json").read_bytes()
        assert hashlib.sha256(manifest_raw).hexdigest() == manifest_sha
        manifest = json.loads(manifest_raw)
        graph_raw = (written / manifest["attachments"]["graph_receipts"]["path"]).read_bytes()
        summary_raw = (written / manifest["attachments"]["build_manifest"]["path"]).read_bytes()
        graph = json.loads(graph_raw)
        assert [c["name"] for c in graph["reported_income"]["accounting_columns"]] == names
        assert graph["scope"]["households"] == size.households
        assert graph["scope"]["persons"] == size.persons
        shape_root = out / label
        if shape_root.exists():
            shutil.rmtree(shape_root)
        shutil.copytree(written, shape_root)
        write_index(shape_root, manifest, manifest_sha)
        return {
            "label": label,
            "candidate_release_id": manifest["candidate_release_id"],
            "run_id": manifest["run_id"],
            "profile": graph["profile"],
            "producer_schema": graph["scope"]["producer_schema"],
            "households": size.households,
            "persons": size.persons,
            "tax_units": size.tax_units,
            "cohorts": [
                c["households"] for c in graph["scope"]["households_by_source_cohort"]
            ],
            "eligible_households_by_cohort": [
                c["eligible_households"]
                for c in graph["scope"]["households_by_source_cohort"]
            ],
            "sampling_fraction": graph["scope"]["measurement"]["sampling_fraction"],
            "selection_rule": graph["scope"]["measurement"]["selection_rule"],
            "selection_rule_scope": graph["scope"]["measurement"]["selection_rule_scope"],
            "population_sha256": graph["population_sha256"],
            "candidate_manifest_sha256": manifest_sha,
            "graph_receipts_sha256": hashlib.sha256(graph_raw).hexdigest(),
            "build_summary_sha256": hashlib.sha256(summary_raw).hexdigest(),
            "graph_receipts_bytes": len(graph_raw),
            "build_summary_bytes": len(summary_raw),
            "scope_note": graph["scope"]["note"],
            "recorded_count_locations": [
                {
                    "fact": entry["fact"],
                    "count": entry["count"],
                    "locations": entry["locations"],
                    "phase_restatements": entry["phase_restatements"],
                }
                for entry in graph["scope"]["measurement"]["recorded_count_locations"]
            ],
            "files": sorted(
                str(path.relative_to(shape_root))
                for path in shape_root.rglob("*")
                if path.is_file()
            ),
        }
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--microcosm", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    build = args.microcosm / "packages/microcosm-build/src/microcosm/build"
    tests = args.microcosm / "packages/microcosm-build/tests"
    reviewed, base = build / "graph_evidence_income_v3.py", build / "graph_evidence.py"
    if sha256_file(reviewed) != EXPECTED_REVIEWED_SHA:
        raise SystemExit(f"reviewed profile sha mismatch: {sha256_file(reviewed)}")
    if sha256_file(base) != EXPECTED_BASE_SHA:
        raise SystemExit(f"base exporter sha mismatch: {sha256_file(base)}")

    sys.path.insert(0, str(tests))
    import test_graph_evidence_income_sized as helper  # noqa: E402

    sized = helper.sized
    producer = build / "us_runtime/graph_asec_income.py"
    names, dtypes = production_roster(producer)
    assert list(names[3:9]) == list(sized.RESULT_COLUMNS)

    args.out.mkdir(parents=True, exist_ok=True)
    shapes = [
        generate(helper, sized, names, dtypes, helper.SMALL, "small", args.out),
        generate(helper, sized, names, dtypes, helper.WIDE, "wide", args.out),
    ]
    assert len({shape["population_sha256"] for shape in shapes}) == len(shapes)
    receipt = {
        "schema": "microcosm.income_sized_generated_export_fixtures.v2",
        "what": (
            "Invented sized income-v3 exports produced by the sized exporter's own "
            "invented-fixture helper at two shapes, with the real production "
            "28-column accounting roster substituted for the helper's renamed "
            "EVIDENCE_j stand-ins."
        ),
        "evidence": (
            "INVENTED FIXTURES ONLY - these describe no population, no ASEC data, "
            "no model output and no genuine run"
        ),
        "generator": "frontend/scripts/write-invented-income-sized-candidates.py",
        "generator_sha256": sha256_file(Path(__file__)),
        "sized_exporter_sha256": sha256_file(build / "graph_evidence_income_sized.py"),
        "sized_exporter_tests_sha256": sha256_file(
            tests / "test_graph_evidence_income_sized.py"
        ),
        "reviewed_exporter_sha256": sha256_file(reviewed),
        "base_exporter_sha256": sha256_file(base),
        "producer_sha256": sha256_file(producer),
        "roster_source": ROSTER_SOURCE,
        "accounting_columns": names,
        "accounting_dtypes": dtypes,
        "accounting_row_bytes": sized.ACCOUNTING_ROW_BYTES,
        "profile": sized.PROFILE,
        "shapes": shapes,
    }
    (args.out / "generated.json").write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n"
    )
    print(json.dumps({k: v for k, v in receipt.items() if k != "accounting_columns"}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
