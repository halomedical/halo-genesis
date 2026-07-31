from __future__ import annotations

import tempfile
import unittest

from pathlib import Path

from halo_sentry.path_safety import UnsafePathError, require_safe_file, resolve_watch_directory


class PathSafetyTests(unittest.TestCase):
    def test_resolves_reattached_volume_with_changed_mount(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            old_mount = base / "old-drive"
            new_mount = base / "new-drive"
            old_mount.mkdir()
            inbox = new_mount / "Beamer" / "Inbox"
            inbox.mkdir(parents=True)

            def serial(root: Path) -> str | None:
                return "A1B2C3D4" if root == new_mount else "OTHER"

            resolved = resolve_watch_directory(
                old_mount / "Beamer" / "Inbox",
                "A1B2C3D4",
                volume_roots=(new_mount,),
                serial_reader=serial,
                original_root=old_mount,
            )
            self.assertEqual(resolved, inbox.resolve())

    def test_missing_enrolled_volume_fails_without_creating_a_new_path(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            old_mount = Path(temp) / "old-drive"
            old_mount.mkdir()
            configured = old_mount / "Beamer" / "Inbox"
            with self.assertRaisesRegex(UnsafePathError, "not attached"):
                resolve_watch_directory(
                    configured,
                    "A1B2C3D4",
                    volume_roots=(),
                    serial_reader=lambda _: "OTHER",
                    original_root=old_mount,
                )
            self.assertFalse(configured.exists())

    def test_rejects_file_outside_watch_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            watch = base / "watch"
            watch.mkdir()
            outside = base / "outside.jpg"
            outside.write_bytes(b"image")
            with self.assertRaises(UnsafePathError):
                require_safe_file(outside, watch)

    def test_rejects_symlink_or_reparse_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            watch = base / "watch"
            watch.mkdir()
            outside = base / "outside.jpg"
            outside.write_bytes(b"image")
            link = watch / "link.jpg"
            try:
                link.symlink_to(outside)
            except OSError:
                self.skipTest("symlinks are unavailable")
            with self.assertRaises(UnsafePathError):
                require_safe_file(link, watch)


if __name__ == "__main__":
    unittest.main()
