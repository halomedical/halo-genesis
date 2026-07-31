from __future__ import annotations

import re
import unittest

from pathlib import Path


USER_FACING_HEIMDALL = re.compile(
    r"\b(?:throw|Write-(?:Host|Warning|Error)|Read-Host|\.Description\s*=).*\bHeimdall\b",
    re.IGNORECASE,
)


class InstallerBrandingTests(unittest.TestCase):
    def test_user_facing_installer_messages_call_the_product_beamer(self) -> None:
        installer_directory = Path(__file__).resolve().parents[1] / "installer"
        violations: list[str] = []
        for script in installer_directory.glob("*.ps1"):
            for line_number, line in enumerate(script.read_text(encoding="utf-8").splitlines(), 1):
                if USER_FACING_HEIMDALL.search(line):
                    violations.append(f"{script.name}:{line_number}")
        self.assertEqual(violations, [], f"User-facing Heimdall branding found at {violations}")

    def test_existing_output_is_watched_directly_and_drive_root_gets_default_inbox(self) -> None:
        installer = (
            Path(__file__).resolve().parents[1] / "installer" / "install.ps1"
        ).read_text(encoding="utf-8")
        self.assertIn("$usingDriveRoot = $selected.TrimEnd", installer)
        self.assertIn("Join-Path $root 'Beamer\\Inbox'", installer)
        self.assertIn("$watchPath = if ($usingDriveRoot)", installer)
        self.assertIn("$createdNewDefaultInbox = -not $defaultInboxExisted", installer)
        self.assertIn("if (-not $watchSelection.CreatedNewDefaultInbox)", installer)
        self.assertIn("elseif (-not (Test-Path -LiteralPath $watchPath -PathType Container))", installer)
        self.assertNotIn("Join-Path $selected 'Beamer\\Inbox'", installer)

    def test_existing_file_consent_is_required_without_explicit_test_switch(self) -> None:
        installer = (
            Path(__file__).resolve().parents[1] / "installer" / "install.ps1"
        ).read_text(encoding="utf-8")
        self.assertIn("[switch]$ConfirmExistingFilesForReview", installer)
        self.assertIn("[IO.SearchOption]::TopDirectoryOnly", installer)
        self.assertIn("Type YES to continue", installer)
        self.assertIn("if ($confirmation -cne 'YES')", installer)
        self.assertNotIn("$enumerator.Current", installer)


if __name__ == "__main__":
    unittest.main()
