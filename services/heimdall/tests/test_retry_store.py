from __future__ import annotations

import tempfile
import unittest

from pathlib import Path

from halo_sentry.retry_store import RetryJob, RetryStore


class RetryStorePrivacyTests(unittest.TestCase):
    def test_journal_contains_only_opaque_spool_reference(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            state = Path(temp) / "state"
            store = RetryStore(state)
            job = RetryJob.create(".jpg", kind="normal")
            store.add(job)
            raw = (state / "pending_uploads.json").read_text(encoding="utf-8")
            self.assertIn(job.id, raw)
            self.assertNotIn("local_path", raw)
            self.assertNotIn("Patient", raw)
            self.assertNotIn("\\", raw)
            self.assertEqual(store.path_for(job).name, f"{job.id}.jpg")


if __name__ == "__main__":
    unittest.main()
