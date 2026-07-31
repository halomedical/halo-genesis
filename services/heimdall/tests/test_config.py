from __future__ import annotations

import json
import tempfile
import unittest

from pathlib import Path

from halo_sentry.config import CURRENT_CONFIG_SCHEMA_VERSION, SentryConfig, load_config


def valid_mapping(root: Path) -> dict[str, object]:
    return {
        "config_schema_version": 3,
        "contract_version": 1,
        "watch_directory": str(root / "watch"),
        "watch_volume_serial": "A1B2C3D4",
        "api_base_url": "https://app.halo.africa",
        "device_id": "00000000-0000-4000-8000-000000000001",
        "installation_id": "00000000-0000-4000-8000-000000000002",
        "device_credential_path": str(root / "device-token.txt"),
    }


class ConfigLoadingTests(unittest.TestCase):
    def test_shipped_proxy_example_is_non_recursive(self) -> None:
        example = Path(__file__).resolve().parents[1] / "config.example.json"
        config = load_config(example)
        self.assertFalse(config.special_workflows.enabled)
        self.assertTrue(config.special_workflows.image_stack_identifier_variants)

    def test_load_config_accepts_utf8_bom(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            config_path = root / "config.json"
            config_path.write_text(json.dumps(valid_mapping(root)), encoding="utf-8-sig")
            config = load_config(config_path)
            self.assertEqual(config.config_schema_version, CURRENT_CONFIG_SCHEMA_VERSION)

    def test_rejects_non_schema_three_config(self) -> None:
        data = valid_mapping(Path("C:/test"))
        data["config_schema_version"] = 2
        with self.assertRaisesRegex(ValueError, "config_schema_version must be 3"):
            SentryConfig.from_mapping(data)

    def test_recursive_special_workflows_are_rejected_in_proxy_v1(self) -> None:
        data = valid_mapping(Path("C:/test"))
        data["special_workflows"] = {"enabled": True}
        config = SentryConfig.from_mapping(data)
        with self.assertRaisesRegex(ValueError, "not supported"):
            config.validate()

    def test_boolean_strings_are_rejected(self) -> None:
        data = valid_mapping(Path("C:/test"))
        data["startup_backlog_enabled"] = "false"
        with self.assertRaisesRegex(ValueError, "JSON boolean"):
            SentryConfig.from_mapping(data)

    def test_absolute_or_escaping_special_folder_is_rejected(self) -> None:
        for value in ("../escape", "C:/escape", "nested/folder"):
            data = valid_mapping(Path("C:/test"))
            data["special_workflows"] = {"images_folder_name": value}
            with self.assertRaisesRegex(ValueError, "simple relative folder"):
                SentryConfig.from_mapping(data)

    def test_explicit_loopback_http_origins_are_allowed_for_local_testing(self) -> None:
        for origin in (
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://[::1]:3000",
        ):
            data = valid_mapping(Path("C:/test"))
            data["api_base_url"] = origin
            SentryConfig.from_mapping(data).validate()

    def test_non_loopback_http_and_non_origin_urls_are_rejected(self) -> None:
        for origin in (
            "http://app.halo.africa",
            "http://192.168.1.5:3000",
            "http://localhost.evil.test:3000",
            "http://localhost:3000/api",
            "http://user@localhost:3000",
            "http://localhost:3000?target=production",
        ):
            data = valid_mapping(Path("C:/test"))
            data["api_base_url"] = origin
            with self.subTest(origin=origin), self.assertRaisesRegex(ValueError, "loopback"):
                SentryConfig.from_mapping(data).validate()


if __name__ == "__main__":
    unittest.main()
