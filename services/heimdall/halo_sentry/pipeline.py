"""Bounded, containment-safe and restart-safe image processing."""

from __future__ import annotations

import logging
import queue
import shutil
import threading

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from halo_sentry.api_client import BeamerApiError, detect_raster_mime
from halo_sentry.config import SentryConfig
from halo_sentry.file_ready import FileNotReadyError, wait_until_file_ready
from halo_sentry.path_safety import (
    UnsafePathError,
    is_reparse_or_symlink,
    require_safe_destination,
    require_safe_file,
    same_volume_identity,
)
from halo_sentry.patient_parser import text_matches_any_variant
from halo_sentry.popia import deidentify_filename, is_already_deidentified
from halo_sentry.privacy import safe_file_ref
from halo_sentry.retry_store import RetryJob, RetryStore
from halo_sentry.special_workflows import SpecialWorkflowProcessor
from halo_sentry.text_extraction import TextExtractionUnavailable, TextExtractor, UnsupportedFileType


logger = logging.getLogger("halo_sentry.pipeline")


@dataclass(frozen=True)
class _WorkItem:
    key: str
    path: Path | None = None
    retry_job: RetryJob | None = None


class FilePipeline:
    def __init__(
        self,
        config: SentryConfig,
        uploader: object,
        *,
        retry_store: RetryStore | None = None,
        volume_validator: Callable[[Path, str | None], bool] = same_volume_identity,
        text_extractor: object | None = None,
    ) -> None:
        self._config = config
        self._uploader = uploader
        self._processed_root = config.watch_directory / config.processed_subdirectory
        self._review_root = config.watch_directory / config.review_subdirectory
        self._retry_store = retry_store or RetryStore(config.state_directory)
        self._volume_validator = volume_validator
        self._identifier_extractor = (
            text_extractor or TextExtractor(config.special_workflows)
            if config.special_workflows.image_stack_identifier_variants
            else None
        )
        # Proxy contract v1 is deliberately non-recursive. The legacy special
        # processor is retained as isolated code but is never scheduled here.
        self._special_processor = None
        self._queue: queue.Queue[_WorkItem] = queue.Queue(config.queue_capacity)
        self._lock = threading.Lock()
        self._scheduled: set[str] = set()
        self._workers: list[threading.Thread] = []
        self._retry_thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._started = False
        self._last_synced_at: str | None = None

    def start(self) -> None:
        if not self._volume_validator(self._config.watch_directory, self._config.watch_volume_serial):
            raise RuntimeError("Configured watch volume identity does not match the enrolled device")
        with self._lock:
            if self._started:
                return
            self._started = True
        for index in range(self._config.max_workers):
            worker = threading.Thread(target=self._worker_loop, name=f"heimdall-worker-{index + 1}", daemon=True)
            worker.start()
            self._workers.append(worker)
        self._retry_thread = threading.Thread(target=self._retry_loop, name="heimdall-retry-dispatcher", daemon=True)
        self._retry_thread.start()

    def shutdown(self, *, timeout: float = 30.0) -> None:
        self._stop.set()
        deadline = datetime.now().timestamp() + timeout
        for worker in self._workers:
            worker.join(timeout=max(0.0, deadline - datetime.now().timestamp()))
        if self._retry_thread:
            self._retry_thread.join(timeout=max(0.0, deadline - datetime.now().timestamp()))

    def wait_for_idle(self) -> None:
        self._queue.join()

    @property
    def pending_upload_count(self) -> int:
        return len(self._retry_store.all_jobs())

    @property
    def pending_review_count(self) -> int:
        return sum(1 for job in self._retry_store.all_jobs() if job.review_reason_code)

    @property
    def last_synced_at(self) -> str | None:
        return self._last_synced_at

    def should_accept(self, path: Path) -> bool:
        if self._is_managed_output_path(path):
            return False
        if self._special_processor and self._special_processor.workflow_for_path(path):
            return not is_reparse_or_symlink(path)
        if not path.is_file() or path.name.startswith(self._config.ignored_prefixes):
            return False
        if path.suffix.lower() in self._config.ignored_extensions or is_already_deidentified(path):
            return False
        try:
            require_safe_file(path, self._config.watch_directory)
        except UnsafePathError:
            logger.error("Rejected unsafe filesystem event")
            return False
        return path.parent.resolve(strict=True) == self._config.watch_directory.resolve(strict=True)

    def validate_runtime_dependencies(self) -> None:
        if self._identifier_extractor:
            self._identifier_extractor.validate_dependencies()
        if self._special_processor:
            self._special_processor.validate_dependencies()

    def special_watch_directories(self) -> tuple[Path, ...]:
        return self._special_processor.input_directories() if self._special_processor else ()

    def ensure_special_watch_directories(self) -> None:
        if self._special_processor:
            self._special_processor.ensure_input_directories()

    def enqueue(self, path: Path) -> bool:
        if not self._started or self._stop.is_set():
            return False
        key = self._in_flight_key(path)
        with self._lock:
            if key in self._scheduled:
                return False
            self._scheduled.add(key)
        try:
            self._queue.put_nowait(_WorkItem(key=key, path=path))
            return True
        except queue.Full:
            with self._lock:
                self._scheduled.discard(key)
            logger.warning("Bounded processing queue is full; file will be discovered by rescan")
            return False

    def enqueue_startup_backlog(self) -> int:
        if not self._config.startup_backlog_enabled or self._stop.is_set():
            return 0
        if not self._volume_validator(self._config.watch_directory, self._config.watch_volume_serial):
            logger.error("Skipped backlog scan because watch volume identity changed")
            return 0
        count = 0
        try:
            entries = tuple(self._config.watch_directory.iterdir())
        except OSError:
            return 0
        for path in sorted(entries):
            if self._startup_root_candidate(path) and self.enqueue(path):
                count += 1
        if self._special_processor:
            for root in self._special_processor.input_directories():
                if self._special_processor.iter_candidate_files(root) and self.enqueue(root):
                    count += 1
        return count

    def _startup_root_candidate(self, path: Path) -> bool:
        if not path.is_file() or self._is_managed_output_path(path) or is_reparse_or_symlink(path):
            return False
        if path.name.startswith(self._config.ignored_prefixes):
            return False
        return path.suffix.lower() not in self._config.ignored_extensions

    def _worker_loop(self) -> None:
        while True:
            if self._stop.is_set() and self._queue.empty():
                return
            try:
                item = self._queue.get(timeout=0.2)
            except queue.Empty:
                continue
            try:
                if item.retry_job:
                    self._attempt_job(item.retry_job)
                elif item.path:
                    self._process(item.path)
            except Exception:
                logger.error("Unexpected processing failure")
            finally:
                with self._lock:
                    self._scheduled.discard(item.key)
                self._queue.task_done()

    def _retry_loop(self) -> None:
        while not self._stop.wait(self._config.retry_dispatch_interval_seconds):
            self._retry_store.recover_orphaned_spool_files()
            for job in self._retry_store.due_jobs():
                key = f"retry:{job.id}"
                with self._lock:
                    if key in self._scheduled:
                        continue
                    self._scheduled.add(key)
                try:
                    self._queue.put_nowait(_WorkItem(key=key, retry_job=job))
                except queue.Full:
                    with self._lock:
                        self._scheduled.discard(key)
                    break
            self.enqueue_startup_backlog()

    def _process(self, path: Path) -> None:
        if self._special_processor and self._special_processor.workflow_for_path(path):
            self._special_processor.process_event(path)
            return
        try:
            safe_path = require_safe_file(path, self._config.watch_directory)
        except UnsafePathError:
            logger.error("Rejected unsafe file before processing")
            return
        if not self._wait_for_ready(safe_path):
            return
        reason = self._identifier_review_reason(safe_path)
        if reason == "unsupported_image":
            self._quarantine_local(safe_path, reason)
            return
        self._spool_and_upload(safe_path, "normal", reason)

    def _identifier_review_reason(self, path: Path) -> str | None:
        if not self._identifier_extractor:
            return None
        try:
            text = self._identifier_extractor.extract_image_text(path)
        except UnsupportedFileType:
            try:
                detect_raster_mime(path)
            except BeamerApiError:
                return "unsupported_image"
            return "identifier_not_detected"
        except TextExtractionUnavailable:
            logger.warning("Identifier extraction unavailable; sending image for manual review")
            return "manual_review"
        except Exception:
            logger.warning("Identifier extraction failed; sending image for manual review")
            return "manual_review"
        if text_matches_any_variant(
            text,
            self._config.special_workflows.image_stack_identifier_variants,
        ):
            return None
        return "identifier_not_detected"

    def _quarantine_local(self, path: Path, reason: str) -> None:
        try:
            source = require_safe_file(path, self._config.watch_directory)
            source = deidentify_filename(source)
            source = require_safe_file(source, self._config.watch_directory)
            directory = self._review_root / f"{datetime.now():%Y%m%d}" / reason
            directory.mkdir(parents=True, exist_ok=True)
            destination = require_safe_destination(directory / source.name, self._config.watch_directory)
            shutil.move(str(source), str(destination))
        except (OSError, UnsafePathError):
            logger.error("Could not quarantine unsupported image safely")

    def _spool_and_upload(self, source_path: Path, kind: str, review_reason_code: str | None) -> bool:
        try:
            safe_source = require_safe_file(source_path, self._config.watch_directory)
            renamed = deidentify_filename(safe_source)
            safe_source = require_safe_file(renamed, self._config.watch_directory)
            job = RetryJob.create(
                safe_source.suffix,
                kind=kind,
                review_reason_code=review_reason_code,
                delay_seconds=self._config.retry_initial_delay_seconds,
            )
            spool_path = self._retry_store.path_for(job)
            if spool_path.exists():
                raise UnsafePathError("Opaque spool collision")
            retry_key = f"retry:{job.id}"
            with self._lock:
                self._scheduled.add(retry_key)
            self._retry_store.add(job)
            # Recheck containment immediately before the only source move.
            safe_source = require_safe_file(safe_source, self._config.watch_directory)
            shutil.move(str(safe_source), str(spool_path))
        except (OSError, UnsafePathError):
            if "job" in locals():
                self._retry_store.remove(job.id)
            if "retry_key" in locals():
                with self._lock:
                    self._scheduled.discard(retry_key)
            logger.error("Could not safely stage detected image")
            return False
        try:
            return self._attempt_job(job)
        finally:
            with self._lock:
                self._scheduled.discard(retry_key)

    def _attempt_job(self, job: RetryJob) -> bool:
        try:
            path = self._retry_store.path_for(job)
            if not path.is_file() or is_reparse_or_symlink(path):
                self._retry_store.remove(job.id)
                logger.error("Opaque retry payload is missing or unsafe")
                return False
            self._uploader.upload_file(
                path,
                upload_id=job.id,
                review_reason_code=job.review_reason_code,
            )
        except Exception:
            self._reschedule(job)
            logger.error("Beamer proxy upload failed; durable retry retained for %s", job.id)
            return False
        self._finalize_spool(path, job)
        self._retry_store.remove(job.id)
        self._last_synced_at = datetime.now(timezone.utc).isoformat()
        return True

    def _reschedule(self, job: RetryJob) -> None:
        delay = min(
            self._config.retry_initial_delay_seconds * (2 ** min(job.attempts, 16)),
            self._config.retry_max_delay_seconds,
        )
        self._retry_store.reschedule(job.id, delay_seconds=delay)

    def _wait_for_ready(self, path: Path) -> bool:
        try:
            wait_until_file_ready(
                path,
                settle_seconds=self._config.settle_seconds,
                max_retries=self._config.max_lock_retries,
                retry_delay_seconds=self._config.lock_retry_delay_seconds,
            )
            require_safe_file(path, self._config.watch_directory)
            return True
        except (FileNotFoundError, FileNotReadyError, UnsafePathError):
            logger.warning("File was unavailable or unsafe; periodic rescan will retry it")
            return False

    def _finalize_spool(self, path: Path, job: RetryJob) -> None:
        if self._config.delete_after_upload:
            try:
                path.unlink()
            except OSError:
                logger.error("Could not delete uploaded opaque spool file")
            return
        try:
            self._processed_root.mkdir(parents=True, exist_ok=True)
            if is_reparse_or_symlink(self._processed_root):
                raise UnsafePathError("Processed directory is unsafe")
            name = f"halo_{datetime.now():%Y%m%d_%H%M%S}_{job.id}{path.suffix.lower()}"
            destination = require_safe_destination(self._processed_root / name, self._config.watch_directory)
            shutil.move(str(path), str(destination))
        except (OSError, UnsafePathError):
            logger.error("Could not archive uploaded opaque spool file")

    def _in_flight_key(self, path: Path) -> str:
        if self._special_processor:
            special_key = self._special_processor.in_flight_key_for_path(path)
            if special_key:
                return special_key
        return str(path.resolve(strict=False)).casefold()

    def _is_managed_output_path(self, path: Path) -> bool:
        resolved = path.resolve(strict=False)
        for root in (self._processed_root, self._review_root):
            try:
                resolved.relative_to(root.resolve(strict=False))
                return True
            except ValueError:
                continue
        return False
