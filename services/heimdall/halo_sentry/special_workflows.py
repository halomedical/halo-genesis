"""Special folder workflows for OCR-driven uploads."""

from __future__ import annotations

import logging
import shutil
import uuid

from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

from halo_sentry.config import SentryConfig
from halo_sentry.file_ready import FileNotReadyError, wait_until_file_ready
from halo_sentry.patient_parser import (
    PatientIdentity,
    extract_patient_identity,
    sanitize_folder_segment,
    text_matches_any_variant,
)
from halo_sentry.path_safety import UnsafePathError, is_reparse_or_symlink, require_safe_file
from halo_sentry.popia import deidentify_filename
from halo_sentry.privacy import safe_file_ref
from halo_sentry.text_extraction import (
    TextExtractionUnavailable,
    TextExtractor,
    UnsupportedFileType,
)
from halo_sentry.timestamps import timestamp_for_path

logger = logging.getLogger("halo_sentry.special_workflows")


@dataclass(frozen=True)
class WorkflowDefinition:
    name: str
    folder_name: str
    kind: str
    requires_identifier: bool = False


@dataclass(frozen=True)
class WorkflowCandidate:
    source_path: Path
    timestamp: datetime
    patient: PatientIdentity | None


@dataclass(frozen=True)
class CandidateGroup:
    folder_name: str
    candidates: tuple[WorkflowCandidate, ...]


class SpecialWorkflowProcessor:
    def __init__(
        self,
        config: SentryConfig,
        uploader: object,
        *,
        text_extractor: TextExtractor | None = None,
        clock: Callable[[], datetime] | None = None,
        upload_handler: Callable[[Path, str, str | None], bool] | None = None,
    ) -> None:
        self._config = config
        self._uploader = uploader
        self._special = config.special_workflows
        self._text_extractor = text_extractor or TextExtractor(self._special)
        self._clock = clock or datetime.now
        self._upload_handler = upload_handler
        self._processed_root = (
            config.watch_directory / config.processed_subdirectory
        )
        self._review_root = config.watch_directory / config.review_subdirectory
        definitions = (
            WorkflowDefinition(
                "image_stack",
                self._special.image_stack_folder_name,
                "image",
                requires_identifier=True,
            ),
            WorkflowDefinition(
                "images",
                self._special.images_folder_name,
                "image",
            ),
            WorkflowDefinition(
                "pdfs",
                self._special.pdfs_folder_name,
                "pdf",
            ),
            WorkflowDefinition(
                "docx",
                self._special.docx_folder_name,
                "docx",
            ),
            WorkflowDefinition(
                "other_upload",
                self._special.other_upload_folder_name,
                "other",
            ),
        )
        # Agent contract v1 accepts verified raster bytes only. PDF, DOCX, and
        # pass-through folders remain available to standalone legacy tests but
        # are never watched by the production proxy agent.
        self._definitions = (
            tuple(item for item in definitions if item.kind == "image")
            if upload_handler
            else definitions
        )

    def validate_dependencies(self) -> None:
        self._text_extractor.validate_dependencies()

    def input_directories(self) -> tuple[Path, ...]:
        return tuple(
            self._workflow_root(definition)
            for definition in self._definitions
        )

    def ensure_input_directories(self) -> None:
        for directory in self.input_directories():
            directory.mkdir(parents=True, exist_ok=True)
            if is_reparse_or_symlink(directory):
                raise UnsafePathError("Special workflow directory cannot be a link or reparse point")

    def workflow_for_path(self, path: Path) -> WorkflowDefinition | None:
        if path.exists() and is_reparse_or_symlink(path):
            return None
        resolved = path.resolve(strict=False)
        for definition in self._definitions:
            root = self._workflow_root(definition).resolve(strict=False)
            if resolved == root or _is_relative_to(resolved, root):
                return definition
        return None

    def in_flight_key_for_path(self, path: Path) -> str | None:
        definition = self.workflow_for_path(path)
        if not definition:
            return None
        return str(self._workflow_root(definition).resolve(strict=False))

    def process_event(self, path: Path) -> None:
        definition = self.workflow_for_path(path)
        if not definition:
            return

        root = self._workflow_root(definition)
        if not root.exists() or is_reparse_or_symlink(root):
            return

        logger.info("Processing special workflow '%s'", definition.name)
        if definition.kind == "other":
            self._process_other_upload(definition, root)
        else:
            self._process_text_workflow(definition, root)

        self._cleanup_empty_directories(root)

    def _process_text_workflow(
        self,
        definition: WorkflowDefinition,
        root: Path,
    ) -> None:
        candidates: list[WorkflowCandidate] = []
        for path in self._iter_candidate_files(root):
            if not self._wait_for_ready(path):
                continue

            try:
                text = self._extract_text(definition, path)
            except TextExtractionUnavailable:
                logger.error(
                    "OCR/text extraction unavailable; leaving %s in place",
                    safe_file_ref(path),
                )
                return
            except UnsupportedFileType:
                if definition.requires_identifier:
                    self._move_to_review(path, "manual_review")
                    continue
                text = ""
            except Exception:
                logger.error(
                    "OCR/text extraction failed; leaving %s in place",
                    safe_file_ref(path),
                )
                return

            if definition.requires_identifier and not text_matches_any_variant(
                text,
                self._special.image_stack_identifier_variants,
            ):
                self._move_to_review(path, "identifier_not_detected")
                continue

            try:
                fallback_mtime = datetime.fromtimestamp(path.stat().st_mtime)
            except FileNotFoundError:
                continue

            timestamp = timestamp_for_path(
                path,
                workflow_root=root,
                ocr_text=text,
                fallback_mtime=fallback_mtime,
            )
            excluded_names = (
                self._special.image_stack_identifier_variants
                if definition.requires_identifier
                else ()
            )
            patient = extract_patient_identity(
                text,
                excluded_names=excluded_names,
            )
            candidates.append(
                WorkflowCandidate(
                    source_path=path,
                    timestamp=timestamp,
                    patient=patient,
                )
            )

        for group in self._group_candidates(candidates):
            for candidate in group.candidates:
                self._move_and_upload(
                    candidate.source_path,
                    folder_parts=(group.folder_name,),
                )

    def _process_other_upload(
        self,
        definition: WorkflowDefinition,
        root: Path,
    ) -> None:
        for path in self._iter_candidate_files(root):
            if not self._wait_for_ready(path):
                continue

            try:
                relative_parent = path.parent.relative_to(root)
            except ValueError:
                relative_parent = Path()

            folder_parts = (
                sanitize_folder_segment(definition.folder_name),
                *(
                    sanitize_folder_segment(part)
                    for part in relative_parent.parts
                ),
            )
            self._move_and_upload(path, folder_parts=folder_parts)

    def _extract_text(
        self,
        definition: WorkflowDefinition,
        path: Path,
    ) -> str:
        if definition.kind == "image":
            return self._text_extractor.extract_image_text(path)
        if definition.kind == "pdf":
            return self._text_extractor.extract_pdf_text(path)
        if definition.kind == "docx":
            return self._text_extractor.extract_docx_text(path)
        return ""

    def _group_candidates(
        self,
        candidates: list[WorkflowCandidate],
    ) -> tuple[CandidateGroup, ...]:
        patient_groups: OrderedDict[
            tuple[str, str],
            list[WorkflowCandidate],
        ] = OrderedDict()
        unknowns: list[WorkflowCandidate] = []

        for candidate in sorted(candidates, key=lambda item: item.timestamp):
            if candidate.patient:
                date_suffix = candidate.timestamp.strftime("%Y%m%d")
                key = (candidate.patient.normalized_key, date_suffix)
                patient_groups.setdefault(key, []).append(candidate)
            else:
                unknowns.append(candidate)

        base_folder_counts: dict[str, int] = {}
        grouped_candidates = tuple(patient_groups.values())
        for group_candidates in grouped_candidates:
            base_folder = self._patient_folder_name(group_candidates[0])
            base_folder_counts[base_folder] = (
                base_folder_counts.get(base_folder, 0) + 1
            )

        groups = []
        for group_candidates in grouped_candidates:
            representative = group_candidates[0]
            base_folder = self._patient_folder_name(representative)
            folder_name = (
                self._patient_folder_name(representative, include_details=True)
                if base_folder_counts[base_folder] > 1
                else base_folder
            )
            groups.append(CandidateGroup(folder_name, tuple(group_candidates)))
        groups.extend(self._fallback_groups(unknowns))
        return tuple(groups)

    def _fallback_groups(
        self,
        candidates: list[WorkflowCandidate],
    ) -> tuple[CandidateGroup, ...]:
        if not candidates:
            return ()

        sorted_candidates = sorted(candidates, key=lambda item: item.timestamp)
        max_gap = timedelta(minutes=self._special.grouping_minutes)
        sessions: list[list[WorkflowCandidate]] = []
        current: list[WorkflowCandidate] = []
        previous: WorkflowCandidate | None = None

        for candidate in sorted_candidates:
            starts_new_session = (
                previous is not None
                and (
                    candidate.timestamp.date() != previous.timestamp.date()
                    or candidate.timestamp - previous.timestamp > max_gap
                )
            )
            if starts_new_session and current:
                sessions.append(current)
                current = []

            current.append(candidate)
            previous = candidate

        if current:
            sessions.append(current)

        used_numbers: dict[str, set[int]] = {}
        groups: list[CandidateGroup] = []
        for session in sessions:
            date_suffix = session[0].timestamp.strftime("%Y%m%d")
            number = self._next_patient_number(date_suffix, used_numbers)
            groups.append(
                CandidateGroup(
                    f"Patient {number}_{date_suffix}",
                    tuple(session),
                )
            )
        return tuple(groups)

    def _next_patient_number(
        self,
        date_suffix: str,
        used_numbers: dict[str, set[int]],
    ) -> int:
        used = used_numbers.setdefault(date_suffix, set())
        daily_root = self._daily_processed_root()
        if daily_root.exists():
            for directory in daily_root.glob(f"Patient *_{date_suffix}"):
                if not directory.is_dir():
                    continue
                prefix = directory.name.removesuffix(f"_{date_suffix}")
                number_text = prefix.removeprefix("Patient ").strip()
                if number_text.isdigit():
                    used.add(int(number_text))

        number = 1
        while number in used:
            number += 1
        used.add(number)
        return number

    def _patient_folder_name(
        self,
        candidate: WorkflowCandidate,
        *,
        include_details: bool = False,
    ) -> str:
        assert candidate.patient is not None
        date_suffix = candidate.timestamp.strftime("%Y%m%d")
        name_parts = [candidate.patient.name]
        if include_details:
            if candidate.patient.patient_id:
                name_parts.append(candidate.patient.patient_id)
            if candidate.patient.dob:
                name_parts.append(candidate.patient.dob)

        return (
            f"{sanitize_folder_segment(' '.join(name_parts))}_"
            f"{date_suffix}"
        )

    def _move_and_upload(
        self,
        source_path: Path,
        *,
        folder_parts: tuple[str, ...],
    ) -> None:
        if self._upload_handler:
            self._upload_handler(source_path, "special", None)
            return
        daily_root = self._daily_processed_root()
        destination_dir = daily_root.joinpath(*folder_parts)
        destination_dir.mkdir(parents=True, exist_ok=True)
        try:
            source_path = require_safe_file(source_path, self._config.watch_directory)
            source_path = deidentify_filename(source_path)
            source_path = require_safe_file(source_path, self._config.watch_directory)
        except (OSError, UnsafePathError):
            logger.error("Failed to safely de-identify special workflow image")
            return
        destination = _unique_path(destination_dir / source_path.name)

        try:
            shutil.move(str(source_path), str(destination))
        except OSError:
            logger.error("Failed to move special workflow %s", safe_file_ref(source_path))
            return

        drive_folders = (daily_root.name, *folder_parts)
        try:
            if hasattr(self._uploader, "upload_file_to_path"):
                self._uploader.upload_file_to_path(destination, drive_folders)
            else:
                self._uploader.upload_file(destination)
        except Exception:
            logger.error(
                "Failed to upload special workflow %s; durable retry scheduled",
                safe_file_ref(destination),
            )

    def _daily_processed_root(self) -> Path:
        return self._processed_root / f"{self._clock():%Y%m%d}-uploads"

    def _iter_candidate_files(self, root: Path) -> tuple[Path, ...]:
        if not root.is_dir() or is_reparse_or_symlink(root):
            return ()
        candidates = []
        for path in root.rglob("*"):
            if not path.is_file() or is_reparse_or_symlink(path) or self._should_skip_runtime_file(path):
                continue
            try:
                candidates.append(require_safe_file(path, self._config.watch_directory))
            except UnsafePathError:
                logger.error("Skipped unsafe special-workflow path")
        return tuple(sorted(candidates))

    def iter_candidate_files(self, root: Path) -> tuple[Path, ...]:
        """Expose a privacy-neutral startup backlog count/iterator."""
        return self._iter_candidate_files(root)

    def _should_skip_runtime_file(self, path: Path) -> bool:
        if path.name.startswith(self._config.ignored_prefixes):
            return True
        return path.suffix.lower() in self._config.ignored_extensions

    def _wait_for_ready(self, path: Path) -> bool:
        try:
            wait_until_file_ready(
                path,
                settle_seconds=self._config.settle_seconds,
                max_retries=self._config.max_lock_retries,
                retry_delay_seconds=self._config.lock_retry_delay_seconds,
            )
            return True
        except FileNotFoundError:
            return False
        except FileNotReadyError:
            logger.error("Special workflow file remained locked: %s", safe_file_ref(path))
            return False

    def _move_to_review(self, path: Path, reason: str) -> None:
        """Quarantine a rejected image under a de-identified review name."""
        if self._upload_handler:
            self._upload_handler(path, "review", reason)
            return
        review_dir = self._review_root / f"{self._clock():%Y%m%d}" / reason
        review_dir.mkdir(parents=True, exist_ok=True)
        destination = review_dir / (
            f"review_{self._clock():%Y%m%d_%H%M%S}_{uuid.uuid4()}{path.suffix.lower()}"
        )
        try:
            shutil.move(str(path), str(destination))
            logger.info(
                "Moved rejected image to temporary review (%s): %s",
                reason,
                safe_file_ref(destination),
            )
        except OSError:
            logger.error("Failed to move rejected %s to review", safe_file_ref(path))

    def _cleanup_empty_directories(self, root: Path) -> None:
        directories = sorted(
            (path for path in root.rglob("*") if path.is_dir()),
            key=lambda path: len(path.parts),
            reverse=True,
        )
        for directory in directories:
            try:
                directory.rmdir()
                logger.info("Removed empty special workflow directory")
            except OSError:
                continue

    def _workflow_root(self, definition: WorkflowDefinition) -> Path:
        return self._config.watch_directory / definition.folder_name


def _unique_path(path: Path) -> Path:
    if not path.exists():
        return path

    for index in range(2, 10_000):
        candidate = path.with_name(f"{path.stem}_{index}{path.suffix}")
        if not candidate.exists():
            return candidate

    raise OSError("Could not find a unique destination name")


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False
