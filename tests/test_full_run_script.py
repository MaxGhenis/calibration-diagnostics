import hashlib
from pathlib import Path

import pytest

from evaluation_harness.adapters.microcosm import MicrocosmRelease
from scripts import run_full_chronicle_evaluation
from scripts.run_full_chronicle_evaluation import authenticate_microcosm_inputs


def release_for(dataset: bytes, diagnostics: bytes) -> MicrocosmRelease:
    return MicrocosmRelease(
        release_id="fixture-release",
        dataset_filename="fixture.h5",
        dataset_sha256=hashlib.sha256(dataset).hexdigest(),
        model_version="1.0",
        calibration_diagnostics_filename="calibration_diagnostics.json",
        calibration_diagnostics_sha256=hashlib.sha256(diagnostics).hexdigest(),
    )


def test_full_run_authenticates_both_caller_supplied_microcosm_inputs(
    tmp_path: Path,
) -> None:
    dataset_payload = b"pinned dataset"
    diagnostics_payload = b'{"targets": []}'
    dataset = tmp_path / "candidate.h5"
    diagnostics = tmp_path / "candidate.json"
    dataset.write_bytes(dataset_payload)
    diagnostics.write_bytes(diagnostics_payload)

    authenticated = authenticate_microcosm_inputs(
        dataset,
        diagnostics,
        release=release_for(dataset_payload, diagnostics_payload),
    )

    assert authenticated.dataset_path == dataset
    assert authenticated.calibration_diagnostics_path == diagnostics
    assert authenticated.dataset_sha256 == hashlib.sha256(dataset_payload).hexdigest()
    assert authenticated.calibration_diagnostics_sha256 == hashlib.sha256(
        diagnostics_payload
    ).hexdigest()


def test_full_run_rejects_a_mismatched_caller_supplied_microcosm_input(
    tmp_path: Path,
) -> None:
    dataset = tmp_path / "candidate.h5"
    diagnostics = tmp_path / "candidate.json"
    dataset.write_bytes(b"wrong dataset")
    diagnostics.write_bytes(b'{"targets": []}')
    release = release_for(b"pinned dataset", diagnostics.read_bytes())

    with pytest.raises(ValueError, match="dataset checksum"):
        authenticate_microcosm_inputs(dataset, diagnostics, release=release)


def test_default_dispatch_preserves_the_us_runner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected = {"path": "us"}
    received: tuple | None = None

    def fake_us(*arguments):
        nonlocal received
        received = arguments
        return expected

    monkeypatch.setattr(run_full_chronicle_evaluation, "_run_us", fake_us)
    paths = tuple(Path(name) for name in ("snapshot", "dataset", "acs", "output"))

    actual = run_full_chronicle_evaluation.run(*paths)

    assert actual is expected
    assert received == (*paths, None, None)
