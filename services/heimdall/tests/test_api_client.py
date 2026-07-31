from __future__ import annotations

import json
import tempfile
import unittest

from pathlib import Path
from unittest.mock import patch

from halo_sentry.api_client import BeamerApiClient, BeamerApiError
from halo_sentry.config import AgentEndpoints, SentryConfig


class FakeResponse:
    status = 201

    def read(self) -> bytes:
        return b'{"upload":{"id":"asset-1"}}'


class FakeConnection:
    def __init__(self) -> None:
        self.method = ""
        self.path = ""
        self.headers: dict[str, str] = {}
        self.body = bytearray()

    def putrequest(self, method: str, path: str) -> None:
        self.method, self.path = method, path

    def putheader(self, key: str, value: str) -> None:
        self.headers[key] = value

    def endheaders(self) -> None:
        return None

    def send(self, data: bytes) -> None:
        self.body.extend(data)

    def getresponse(self) -> FakeResponse:
        return FakeResponse()

    def close(self) -> None:
        return None


class ApiClientTests(unittest.TestCase):
    def test_proxy_upload_uses_idempotent_opaque_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            token = root / "token.txt"
            token.write_text("x" * 64, encoding="utf-8")
            image = root / "Patient_Janet.jpg"
            payload = b"\xff\xd8\xff" + b"image-data"
            image.write_bytes(payload)
            connection = FakeConnection()
            client = BeamerApiClient(
                self._config(root, token),
                connection_factory=lambda *args, **kwargs: connection,
            )
            upload_id = "11111111-1111-4111-8111-111111111111"
            self.assertEqual(client.upload_file(image, upload_id=upload_id), "asset-1")
            self.assertEqual(connection.path, f"/api/beamer/agent/files/{upload_id}")
            self.assertEqual(bytes(connection.body), payload)
            serialized_headers = json.dumps(connection.headers)
            self.assertNotIn("Janet", serialized_headers)
            self.assertNotIn("fileName", serialized_headers)
            self.assertNotIn("Drive", serialized_headers)
            self.assertNotIn("X-Beamer-Patient-Id", connection.headers)
            self.assertEqual(connection.headers["X-Beamer-Review-Status"], "pending_review")

    def test_proxy_rejects_non_raster_magic(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            token = root / "token.txt"
            token.write_text("x" * 64, encoding="utf-8")
            image = root / "fake.jpg"
            image.write_bytes(b"not-an-image")
            client = BeamerApiClient(self._config(root, token))
            with self.assertRaises(BeamerApiError):
                client.upload_file(image, upload_id="11111111-1111-4111-8111-111111111111")

    def test_proxy_rejects_reason_code_outside_backend_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            token = root / "token.txt"
            token.write_text("x" * 64, encoding="utf-8")
            image = root / "image.jpg"
            image.write_bytes(b"\xff\xd8\xffimage")
            client = BeamerApiClient(self._config(root, token))
            with self.assertRaisesRegex(BeamerApiError, "reason code"):
                client.upload_file(
                    image,
                    upload_id="11111111-1111-4111-8111-111111111111",
                    review_reason_code="identifier-not-found",
                )

    def test_loopback_http_uses_plain_http_and_default_port_80(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            token = root / "token.txt"
            token.write_text("x" * 64, encoding="utf-8")
            config = self._config(root, token, api_base_url="http://localhost")
            with patch("halo_sentry.api_client.http.client.HTTPConnection") as factory:
                client = BeamerApiClient(config)
                connection = client._connection()
            factory.assert_called_once_with("localhost", 80, timeout=60)
            self.assertIs(connection, factory.return_value)

    def test_https_uses_tls_and_default_port_443(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            token = root / "token.txt"
            token.write_text("x" * 64, encoding="utf-8")
            config = self._config(root, token)
            with patch("halo_sentry.api_client.http.client.HTTPSConnection") as factory:
                client = BeamerApiClient(config)
                connection = client._connection()
            factory.assert_called_once_with("app.halo.africa", 443, timeout=60)
            self.assertIs(connection, factory.return_value)

    def _config(
        self,
        root: Path,
        token: Path,
        *,
        api_base_url: str = "https://app.halo.africa",
    ) -> SentryConfig:
        return SentryConfig(
            watch_directory=root / "watch",
            api_base_url=api_base_url,
            device_id="00000000-0000-4000-8000-000000000001",
            installation_id="00000000-0000-4000-8000-000000000002",
            device_credential_path=token,
            watch_volume_serial="A1B2C3D4",
            agent_endpoints=AgentEndpoints(uploads="/api/beamer/agent/files"),
        )


if __name__ == "__main__":
    unittest.main()
