from __future__ import annotations

import tempfile
import unittest

from datetime import datetime
from pathlib import Path

from halo_sentry.config import SentryConfig, SpecialWorkflowConfig
from halo_sentry.popia import is_already_deidentified
from halo_sentry.special_workflows import SpecialWorkflowProcessor


class FakeUploader:
    def __init__(self) -> None:
        self.uploads: list[Path] = []

    def upload_file_to_path(self, path: Path, folders: tuple[str, ...]) -> str:
        self.uploads.append(path)
        return "asset"


class FakeExtractor:
    def __init__(self, texts: dict[str, str]) -> None:
        self.texts = texts

    def validate_dependencies(self) -> None:
        return None

    def extract_image_text(self, path: Path) -> str:
        return self.texts[path.name]

    def extract_pdf_text(self, path: Path) -> str:
        return self.texts[path.name]

    def extract_docx_text(self, path: Path) -> str:
        return self.texts[path.name]


class SpecialWorkflowTests(unittest.TestCase):
    def test_identifier_reject_is_sent_to_review_handler(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "Images STACK" / "Batch"
            source.mkdir(parents=True)
            accepted = source / "accepted.jpg"
            rejected = source / "rejected.jpg"
            accepted.write_bytes(b"accepted")
            rejected.write_bytes(b"rejected")
            calls: list[tuple[str, str | None]] = []

            def upload_handler(path: Path, kind: str, reason: str | None) -> bool:
                self.assertTrue(path.is_file())
                calls.append((kind, reason))
                path.unlink()
                return True

            processor = self._processor(
                root,
                FakeUploader(),
                {
                    accepted.name: "Janet Johnson\nPatient Name: Alice Jones",
                    rejected.name: "Other operator\nPatient Name: Bob Jones",
                },
                upload_handler=upload_handler,
            )
            processor.process_event(source)
            self.assertCountEqual(calls, [("special", None), ("review", "identifier_not_detected")])

    def test_fallback_special_upload_deidentifies_filename(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "images_halo-watcher" / "Batch"
            source.mkdir(parents=True)
            image = source / "Patient_Janet_20260731.jpg"
            image.write_bytes(b"image")
            uploader = FakeUploader()
            processor = self._processor(
                root,
                uploader,
                {image.name: "Patient Name: Alice Jones"},
            )
            processor.process_event(source)
            self.assertEqual(len(uploader.uploads), 1)
            self.assertTrue(is_already_deidentified(uploader.uploads[0]))
            self.assertNotIn("Janet", uploader.uploads[0].name)

    def test_symlink_candidate_is_not_processed(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            workflow = root / "images_halo-watcher"
            workflow.mkdir()
            outside = root.parent / f"outside-{root.name}.jpg"
            outside.write_bytes(b"outside")
            link = workflow / "linked.jpg"
            try:
                link.symlink_to(outside)
            except OSError:
                self.skipTest("symlinks are unavailable")
            try:
                processor = self._processor(root, FakeUploader(), {})
                self.assertEqual(processor.iter_candidate_files(workflow), ())
            finally:
                outside.unlink(missing_ok=True)

    def _processor(
        self,
        root: Path,
        uploader: FakeUploader,
        texts: dict[str, str],
        upload_handler=None,
    ) -> SpecialWorkflowProcessor:
        config = SentryConfig(
            watch_directory=root,
            api_base_url="https://app.halo.africa",
            device_id="00000000-0000-4000-8000-000000000001",
            installation_id="00000000-0000-4000-8000-000000000002",
            device_credential_path=root / "device-token.txt",
            watch_volume_serial="A1B2C3D4",
            settle_seconds=0,
            max_lock_retries=1,
            lock_retry_delay_seconds=0,
            special_workflows=SpecialWorkflowConfig(
                enabled=True,
                image_stack_identifier_variants=("Janet Johnson",),
            ),
        )
        return SpecialWorkflowProcessor(
            config,
            uploader,
            text_extractor=FakeExtractor(texts),
            clock=lambda: datetime(2026, 7, 31, 12, 0, 0),
            upload_handler=upload_handler,
        )


if __name__ == "__main__":
    unittest.main()
