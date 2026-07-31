from __future__ import annotations

import io
import logging
import tempfile
import unittest

from pathlib import Path

from halo_sentry.popia import deidentify_filename
from halo_sentry.privacy import safe_file_ref


class PrivacyLoggingTests(unittest.TestCase):
    def test_filename_deidentification_log_excludes_original_name(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "Patient_Janet_Johnson.jpg"
            path.write_bytes(b"image")
            stream = io.StringIO()
            handler = logging.StreamHandler(stream)
            logger = logging.getLogger("halo_sentry.popia")
            logger.addHandler(handler)
            logger.setLevel(logging.INFO)
            try:
                deidentify_filename(path)
            finally:
                logger.removeHandler(handler)
            self.assertNotIn("Janet", stream.getvalue())
            self.assertNotIn(path.name, stream.getvalue())

    def test_safe_file_ref_does_not_include_filename(self) -> None:
        path = Path("C:/clinical/Patient_Janet_Johnson.jpg")
        value = safe_file_ref(path)
        self.assertNotIn("Janet", value)
        self.assertTrue(value.endswith(".jpg"))
