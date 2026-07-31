"""Practice-scoped Beamer agent API client; no Google credential exists here."""

from __future__ import annotations

import http.client
import json

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, urlparse

from halo_sentry.config import AGENT_CONTRACT_VERSION, SentryConfig


class BeamerApiError(RuntimeError):
    pass


REVIEW_REASON_CODES = {"identifier_not_detected", "identifier_ambiguous", "manual_review"}


def detect_raster_mime(path: Path) -> str:
    with path.open("rb") as handle:
        header = handle.read(16)
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image/webp"
    if header[4:8] == b"ftyp" and header[8:12] in {b"heic", b"heix", b"hevc", b"hevx"}:
        return "image/heic"
    if header[4:8] == b"ftyp" and header[8:12] in {b"mif1", b"msf1"}:
        return "image/heif"
    raise BeamerApiError("Only verified JPEG, PNG, WebP, HEIC, and HEIF images may be proxied")


class BeamerApiClient:
    def __init__(
        self,
        config: SentryConfig,
        *,
        connection_factory: Callable[..., http.client.HTTPConnection] | None = None,
    ) -> None:
        config.validate()
        self._config = config
        self._parsed = urlparse(config.api_base_url)
        self._connection_factory = connection_factory or (
            http.client.HTTPConnection
            if self._parsed.scheme == "http"
            else http.client.HTTPSConnection
        )

    def verify_agent_access(self) -> None:
        if not self._config.device_credential_path.is_file():
            raise FileNotFoundError("Beamer device credential is unavailable; run installer repair")
        if len(self._token()) < 32:
            raise BeamerApiError("Beamer device credential is invalid")

    def upload_file(
        self,
        local_path: Path,
        *,
        upload_id: str,
        review_reason_code: str | None = None,
    ) -> str:
        size = local_path.stat().st_size
        if size < 1 or size > self._config.max_upload_bytes:
            raise BeamerApiError("Image size is outside the enrolled Beamer limit")
        mime = detect_raster_mime(local_path)
        endpoint = self._config.agent_endpoints.uploads.rstrip("/") + "/" + quote(upload_id, safe="")
        captured_at = datetime.fromtimestamp(local_path.stat().st_mtime, tz=timezone.utc).isoformat()
        headers = {
            "Authorization": f"Bearer {self._token()}",
            "Content-Type": mime,
            "Content-Length": str(size),
            "X-Beamer-Capture-Time": captured_at,
            # Safe v1 never resolves patients on the workstation. Every Windows
            # image waits in Beamer Review for explicit patient assignment.
            "X-Beamer-Review-Status": "pending_review",
        }
        if review_reason_code and review_reason_code not in REVIEW_REASON_CODES:
            raise BeamerApiError("Unsupported Beamer review reason code")
        if review_reason_code:
            headers["X-Beamer-Review-Reason"] = review_reason_code

        connection = self._connection()
        try:
            connection.putrequest("POST", endpoint)
            for key, value in headers.items():
                connection.putheader(key, value)
            connection.endheaders()
            with local_path.open("rb") as handle:
                while chunk := handle.read(1024 * 1024):
                    connection.send(chunk)
            response = connection.getresponse()
            payload = response.read()
            if response.status < 200 or response.status >= 300:
                raise BeamerApiError(f"Beamer upload proxy returned HTTP {response.status}")
            result = json.loads(payload.decode("utf-8"))
            asset_id = str(result.get("upload", {}).get("id", "")).strip()
            if not asset_id:
                raise BeamerApiError("Beamer upload response did not contain an asset ID")
            return asset_id
        finally:
            connection.close()

    def upload_file_to_path(
        self,
        local_path: Path,
        folder_names: tuple[str, ...],
        *,
        upload_id: str,
        review_reason_code: str | None = None,
    ) -> str:
        # Folder names are intentionally not transmitted. Windows OCR-derived
        # identities require explicit review in Beamer before patient assignment.
        del folder_names
        return self.upload_file(
            local_path,
            upload_id=upload_id,
            review_reason_code=review_reason_code,
        )

    def heartbeat(
        self,
        *,
        agent_version: str,
        pending_upload_count: int,
        pending_review_count: int,
        last_synced_at: str | None,
    ) -> dict[str, Any]:
        body = json.dumps(
            {
                "contractVersion": AGENT_CONTRACT_VERSION,
                "agentVersion": agent_version,
                "configSchemaVersion": self._config.config_schema_version,
                "pendingUploadCount": pending_upload_count,
                "pendingReviewCount": pending_review_count,
                "lastSyncedAt": last_synced_at,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        connection = self._connection()
        try:
            connection.request(
                "POST",
                self._config.agent_endpoints.heartbeat,
                body=body,
                headers={
                    "Authorization": f"Bearer {self._token()}",
                    "Content-Type": "application/json",
                    "Content-Length": str(len(body)),
                },
            )
            response = connection.getresponse()
            payload = response.read()
            if response.status < 200 or response.status >= 300:
                raise BeamerApiError(f"Beamer heartbeat returned HTTP {response.status}")
            return json.loads(payload.decode("utf-8"))
        finally:
            connection.close()

    def _connection(self) -> http.client.HTTPConnection:
        default_port = 80 if self._parsed.scheme == "http" else 443
        return self._connection_factory(
            self._parsed.hostname,
            self._parsed.port or default_port,
            timeout=60,
        )

    def _token(self) -> str:
        return self._config.device_credential_path.read_text(encoding="utf-8-sig").strip()
