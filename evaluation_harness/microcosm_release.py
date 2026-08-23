"""Resolve the small manifest surface of a published Microcosm release."""

from __future__ import annotations

import hashlib
import json
import os
import urllib.request
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path, PurePosixPath
from typing import Callable


BELGIUM_MICROCOSM_REPOSITORY = "policyengine/populace-be-private"
REQUIRED_RELEASE_PATHS = (
    "build_manifest",
    "release_manifest",
    "calibration_diagnostics",
)

ArtifactReader = Callable[[str], bytes]


@dataclass(frozen=True)
class ReleaseEvaluationSurfaceRow:
    """Authoritative target/validation row published with Microcosm-BE."""

    row_key: str
    role: str
    concept: str
    chronicle_record_ids: tuple[str, ...]
    period: str
    benchmark_value: Decimal


@dataclass(frozen=True)
class ResolvedMicrocosmRelease:
    """Authenticated-in-place JSON documents selected by ``latest.json``."""

    release_id: str
    latest: dict
    build_manifest: dict
    release_manifest: dict
    calibration_diagnostics: dict
    artifact_paths: dict[str, str]
    artifact_sha256: dict[str, str]
    provenance: str

    @property
    def calibration_target_record_ids(self) -> frozenset[str]:
        """Return every explicit Chronicle record used by a calibration target."""

        record_ids: set[str] = set()
        targets = self.calibration_diagnostics.get("targets")
        if not isinstance(targets, list):
            raise ValueError("Microcosm calibration diagnostics must contain targets")
        for index, target in enumerate(targets):
            if not isinstance(target, dict):
                raise ValueError(
                    f"Microcosm calibration target {index} must be an object"
                )
            metadata = target.get("metadata", {})
            if not isinstance(metadata, dict):
                raise ValueError(
                    f"Microcosm calibration target {index} metadata must be an object"
                )
            values = metadata.get("chronicle_record_ids", ())
            if not isinstance(values, list) or not values or any(
                not isinstance(value, str) or not value for value in values
            ):
                raise ValueError(
                    "Microcosm target chronicle_record_ids must be non-empty strings"
                )
            record_ids.update(values)
        return frozenset(record_ids)

    @property
    def evaluation_surface(self) -> dict[str, ReleaseEvaluationSurfaceRow]:
        """Return calibration targets plus the EUROMOD validation input list."""

        targets = self.calibration_diagnostics.get("targets")
        if not isinstance(targets, list):
            raise ValueError("Microcosm calibration diagnostics must contain targets")
        external_validations = self.release_manifest.get("external_validations")
        if not isinstance(external_validations, dict):
            raise ValueError(
                "Microcosm release manifest must contain external_validations"
            )
        euromod = external_validations.get("euromod")
        if not isinstance(euromod, dict):
            raise ValueError(
                "Microcosm release manifest must contain external_validations.euromod"
            )
        validations = euromod.get("validation_surface")
        if not isinstance(validations, list):
            raise ValueError(
                "Microcosm release manifest must contain the EUROMOD validation_surface"
            )

        rows: dict[str, ReleaseEvaluationSurfaceRow] = {}

        def add_row(
            payload: object,
            *,
            index: int,
            role: str,
            row_key_field: str,
            period_field: str,
            value_field: str,
            metadata_wrapped: bool,
        ) -> None:
            context = f"Microcosm {role} surface row {index}"
            if not isinstance(payload, dict):
                raise ValueError(f"{context} must be an object")
            row_key = payload.get(row_key_field)
            period = payload.get(period_field)
            raw_value = payload.get(value_field)
            metadata = payload.get("metadata") if metadata_wrapped else payload
            if not isinstance(metadata, dict):
                raise ValueError(f"{context} metadata must be an object")
            concept = metadata.get("concept")
            record_ids = metadata.get("chronicle_record_ids")
            if not isinstance(row_key, str) or not row_key:
                raise ValueError(f"{context} requires {row_key_field}")
            if period is None or isinstance(period, bool) or not str(period):
                raise ValueError(f"{context} requires {period_field}")
            if not isinstance(concept, str) or not concept:
                raise ValueError(f"{context} requires concept")
            if not isinstance(record_ids, list) or not record_ids or any(
                not isinstance(value, str) or not value for value in record_ids
            ):
                raise ValueError(
                    f"{context} chronicle_record_ids must be non-empty strings"
                )
            if len(record_ids) != len(set(record_ids)):
                raise ValueError(f"{context} has duplicate Chronicle record IDs")
            try:
                benchmark_value = Decimal(str(raw_value))
            except (InvalidOperation, ValueError) as error:
                raise ValueError(f"{context} has invalid {value_field}") from error
            if not benchmark_value.is_finite():
                raise ValueError(f"{context} has non-finite {value_field}")
            if row_key in rows:
                raise ValueError(
                    f"Microcosm evaluation surface has duplicate row key: {row_key}"
                )
            rows[row_key] = ReleaseEvaluationSurfaceRow(
                row_key=row_key,
                role=role,
                concept=concept,
                chronicle_record_ids=tuple(record_ids),
                period=str(period),
                benchmark_value=benchmark_value,
            )

        for index, target in enumerate(targets):
            add_row(
                target,
                index=index,
                role="target",
                row_key_field="target_name",
                period_field="period",
                value_field="compiled_target",
                metadata_wrapped=True,
            )
        for index, validation in enumerate(validations):
            if (
                isinstance(validation, dict)
                and validation.get("role") != "validation"
            ):
                raise ValueError(
                    f"Microcosm validation surface row {index} must have role "
                    "validation"
                )
            add_row(
                validation,
                index=index,
                role="validation",
                row_key_field="name",
                period_field="year",
                value_field="value",
                metadata_wrapped=False,
            )
        return rows


def _json_document(content: bytes, label: str) -> dict:
    try:
        payload = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Microcosm {label} is not valid JSON") from error
    if not isinstance(payload, dict):
        raise ValueError(f"Microcosm {label} must contain an object")
    return payload


def _release_path(value: object, release_id: str, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"Microcosm latest manifest requires paths.{label}")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"Microcosm latest manifest has unsafe path: {value!r}")
    expected_prefix = ("releases", release_id)
    if path.parts[:2] != expected_prefix:
        raise ValueError(
            f"Microcosm {label} path is outside release {release_id}: {value}"
        )
    return value


def _hf_reader(repository: str, revision: str) -> ArtifactReader:
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")

    def read(relative_path: str) -> bytes:
        url = (
            f"https://huggingface.co/datasets/{repository}/resolve/"
            f"{revision}/{relative_path}"
        )
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request) as response:
            return response.read()

    return read


def resolve_microcosm_release(
    release_dir: str | Path | None = None,
    *,
    repository: str = BELGIUM_MICROCOSM_REPOSITORY,
    revision: str = "main",
    artifact_reader: ArtifactReader | None = None,
) -> ResolvedMicrocosmRelease:
    """Resolve ``latest.json`` from a local release tree or Hugging Face.

    A local directory is read in place and never copied.  When it is omitted,
    the same relative artifacts are fetched from the configured Hugging Face
    dataset repository.  ``artifact_reader`` is an injectable remote reader for
    deterministic tests; callers must not combine it with ``release_dir``.
    """

    if release_dir is not None and artifact_reader is not None:
        raise ValueError("release_dir and artifact_reader are mutually exclusive")
    if release_dir is not None:
        root = Path(release_dir)
        if not root.is_dir():
            raise FileNotFoundError(f"Microcosm release directory does not exist: {root}")

        def read(relative_path: str) -> bytes:
            candidate = root.joinpath(*PurePosixPath(relative_path).parts)
            if not candidate.is_file():
                raise FileNotFoundError(
                    f"Microcosm release artifact does not exist: {candidate}"
                )
            return candidate.read_bytes()

        # Artifact hashes carry identity; keeping machine-specific absolute
        # paths out of the run summary makes local and hosted publication
        # deterministic across worktrees.
        provenance = "local_release_directory"
    else:
        read = artifact_reader or _hf_reader(repository, revision)
        provenance = f"hf:{repository}@{revision}"

    latest_bytes = read("latest.json")
    latest = _json_document(latest_bytes, "latest manifest")
    if latest.get("schema_version") != 1:
        raise ValueError(
            f"unsupported Microcosm latest schema: {latest.get('schema_version')!r}"
        )
    release_id = latest.get("release_id")
    if not isinstance(release_id, str) or not release_id:
        raise ValueError("Microcosm latest manifest requires release_id")
    paths_payload = latest.get("paths")
    if not isinstance(paths_payload, dict):
        raise ValueError("Microcosm latest manifest requires paths")
    artifact_paths = {
        label: _release_path(paths_payload.get(label), release_id, label)
        for label in REQUIRED_RELEASE_PATHS
    }
    artifact_bytes = {
        label: read(relative_path)
        for label, relative_path in artifact_paths.items()
    }
    documents = {
        label: _json_document(content, label.replace("_", " "))
        for label, content in artifact_bytes.items()
    }
    build_id = documents["build_manifest"].get("build_id")
    release_build_id = documents["release_manifest"].get("build", {}).get(
        "build_id"
    )
    if build_id != release_id or release_build_id != release_id:
        raise ValueError(
            "Microcosm release manifests do not match latest release_id: "
            f"{build_id!r}, {release_build_id!r}, {release_id!r}"
        )
    resolved = ResolvedMicrocosmRelease(
        release_id=release_id,
        latest=latest,
        build_manifest=documents["build_manifest"],
        release_manifest=documents["release_manifest"],
        calibration_diagnostics=documents["calibration_diagnostics"],
        artifact_paths=artifact_paths,
        artifact_sha256={
            "latest": hashlib.sha256(latest_bytes).hexdigest(),
            **{
                label: hashlib.sha256(content).hexdigest()
                for label, content in artifact_bytes.items()
            },
        },
        provenance=provenance,
    )
    # Validate target metadata while the release is being resolved rather than
    # deferring malformed provenance until checkpoint classification.
    resolved.calibration_target_record_ids
    return resolved
