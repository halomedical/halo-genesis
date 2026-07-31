from __future__ import annotations

import threading
import time
import tempfile
import unittest

from dataclasses import replace
from pathlib import Path

from halo_sentry.config import SentryConfig, SpecialWorkflowConfig
from halo_sentry.pipeline import FilePipeline
from halo_sentry.retry_store import RetryStore


class RecordingUploader:
    def __init__(self, *, fail_count: int = 0, delay: float = 0.0) -> None:
        self._fail_count = fail_count
        self._delay = delay
        self._lock = threading.Lock()
        self.uploads: list[Path] = []
        self.active = 0
        self.max_active = 0
        self.review_reasons: list[str | None] = []

    def upload_file(
        self,
        path: Path,
        *,
        upload_id: str,
        review_reason_code: str | None = None,
    ) -> str:
        self.assert_opaque(path, upload_id)
        self.review_reasons.append(review_reason_code)
        with self._lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            if self._delay:
                time.sleep(self._delay)
            with self._lock:
                if self._fail_count:
                    self._fail_count -= 1
                    raise RuntimeError("synthetic upload failure")
                self.uploads.append(path)
            return "drive-test"
        finally:
            with self._lock:
                self.active -= 1

    def assert_opaque(self, path: Path, upload_id: str) -> None:
        if path.stem != upload_id:
            raise AssertionError("pipeline did not use an opaque spool filename")


class PipelineReliabilityTests(unittest.TestCase):
    def test_non_recursive_root_identifier_miss_is_sent_to_review(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            watch = root / "watch"
            watch.mkdir()
            image = watch / "capture.jpg"
            image.write_bytes(b"image")
            config = replace(
                self._config(root, watch),
                special_workflows=SpecialWorkflowConfig(
                    enabled=False,
                    image_stack_identifier_variants=("Janet Johnson",),
                ),
            )

            class Extractor:
                def validate_dependencies(self) -> None:
                    return None

                def extract_image_text(self, path: Path) -> str:
                    return "Other operator"

            uploader = RecordingUploader()
            pipeline = FilePipeline(
                config,
                uploader,
                text_extractor=Extractor(),
                volume_validator=lambda *_: True,
            )
            pipeline.start()
            try:
                self.assertEqual(pipeline.special_watch_directories(), ())
                pipeline.enqueue(image)
                pipeline.wait_for_idle()
            finally:
                pipeline.shutdown()
            self.assertEqual(uploader.review_reasons, ["identifier_not_detected"])

    def test_startup_backlog_includes_original_and_deidentified_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            watch = root / "watch"
            watch.mkdir()
            original = watch / "Patient_Janet.jpg"
            recovered = watch / "halo_20260731_120000_12345678-1234-1234-1234-123456789abc.jpg"
            original.write_bytes(b"first")
            recovered.write_bytes(b"second")
            uploader = RecordingUploader()
            pipeline = FilePipeline(self._config(root, watch), uploader, volume_validator=lambda *_: True)
            pipeline.start()
            try:
                self.assertEqual(pipeline.enqueue_startup_backlog(), 2)
                pipeline.wait_for_idle()
            finally:
                pipeline.shutdown()

            self.assertEqual(len(uploader.uploads), 2)
            self.assertEqual(len(tuple((watch / "_halo_processed").glob("*.jpg"))), 2)
            self.assertFalse(original.exists())
            self.assertFalse(recovered.exists())

    def test_failed_upload_is_persisted_and_retried(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            watch = root / "watch"
            watch.mkdir()
            source = watch / "Patient_Janet.jpg"
            source.write_bytes(b"image")
            config = self._config(root, watch)
            retry_store = RetryStore(config.state_directory)
            uploader = RecordingUploader(fail_count=1)
            pipeline = FilePipeline(
                config,
                uploader,
                retry_store=retry_store,
                volume_validator=lambda *_: True,
            )
            pipeline.start()
            try:
                pipeline.enqueue(source)
                pipeline.wait_for_idle()
                self.assertEqual(len(retry_store.all_jobs()), 1)
                deadline = time.monotonic() + 2.0
                while retry_store.all_jobs() and time.monotonic() < deadline:
                    time.sleep(0.02)
                pipeline.wait_for_idle()
            finally:
                pipeline.shutdown()

            self.assertEqual(retry_store.all_jobs(), ())
            self.assertEqual(len(uploader.uploads), 1)
            self.assertEqual(len(tuple((watch / "_halo_processed").glob("*.jpg"))), 1)

    def test_worker_concurrency_is_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            watch = root / "watch"
            watch.mkdir()
            paths = []
            for index in range(8):
                path = watch / f"capture_{index}.jpg"
                path.write_bytes(b"image")
                paths.append(path)
            uploader = RecordingUploader(delay=0.03)
            pipeline = FilePipeline(self._config(root, watch), uploader, volume_validator=lambda *_: True)
            pipeline.start()
            try:
                for path in paths:
                    pipeline.enqueue(path)
                pipeline.wait_for_idle()
            finally:
                pipeline.shutdown()

            self.assertEqual(len(uploader.uploads), len(paths))
            self.assertLessEqual(uploader.max_active, 2)

    def test_shutdown_does_not_block_when_queue_was_full(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            watch = root / "watch"
            watch.mkdir()
            config = self._config(root, watch)
            object.__setattr__(config, "max_workers", 1)
            object.__setattr__(config, "queue_capacity", 1)
            uploader = RecordingUploader(delay=0.05)
            pipeline = FilePipeline(config, uploader, volume_validator=lambda *_: True)
            paths = []
            for index in range(4):
                path = watch / f"full_{index}.jpg"
                path.write_bytes(b"image")
                paths.append(path)
            pipeline.start()
            for path in paths:
                pipeline.enqueue(path)
            started = time.monotonic()
            pipeline.shutdown(timeout=2.0)
            self.assertLess(time.monotonic() - started, 2.0)

    def test_volume_identity_mismatch_stops_startup(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            watch = root / "watch"
            watch.mkdir()
            pipeline = FilePipeline(
                self._config(root, watch),
                RecordingUploader(),
                volume_validator=lambda *_: False,
            )
            with self.assertRaisesRegex(RuntimeError, "volume identity"):
                pipeline.start()

    def _config(self, root: Path, watch: Path) -> SentryConfig:
        return SentryConfig(
            watch_directory=watch,
            api_base_url="https://app.halo.africa",
            device_id="00000000-0000-4000-8000-000000000001",
            installation_id="00000000-0000-4000-8000-000000000002",
            device_credential_path=root / "device-token.txt",
            watch_volume_serial="A1B2C3D4",
            state_directory=root / "state",
            settle_seconds=0,
            max_lock_retries=1,
            lock_retry_delay_seconds=0,
            max_workers=2,
            queue_capacity=3,
            retry_initial_delay_seconds=0.1,
            retry_max_delay_seconds=0.1,
            retry_dispatch_interval_seconds=0.01,
        )


if __name__ == "__main__":
    unittest.main()
