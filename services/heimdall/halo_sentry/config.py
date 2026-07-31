"""Strict versioned configuration for the Heimdall Windows agent."""

from __future__ import annotations

import json
import os
import re

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


CURRENT_CONFIG_SCHEMA_VERSION = 3
AGENT_CONTRACT_VERSION = 1
DEFAULT_IGNORED_EXTENSIONS = (".tmp", ".temp", ".crdownload", ".part")
DEFAULT_IGNORED_PREFIXES = ("~", ".", "$")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _is_allowed_api_origin(value: str) -> bool:
    try:
        parsed = urlparse(value)
        hostname = parsed.hostname
        parsed.port  # Reject malformed ports while validating the origin.
    except ValueError:
        return False
    if (
        not parsed.netloc
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.params
        or parsed.query
        or parsed.fragment
    ):
        return False
    return parsed.scheme == "https" or (
        parsed.scheme == "http" and hostname.casefold() in _LOOPBACK_HOSTS
    )


def _strict_bool(data: dict[str, Any], key: str, default: bool) -> bool:
    value = data.get(key, default)
    if type(value) is not bool:
        raise ValueError(f"{key} must be a JSON boolean")
    return value


def _simple_folder_name(value: object, key: str) -> str:
    name = str(value).strip()
    if (
        not name
        or Path(name).is_absolute()
        or Path(name).name != name
        or "/" in name
        or "\\" in name
        or name in {".", ".."}
    ):
        raise ValueError(f"{key} must be a simple relative folder name")
    return name


@dataclass(frozen=True)
class AgentEndpoints:
    heartbeat: str = "/api/beamer/agent/heartbeat"
    uploads: str = "/api/beamer/agent/files"

    @classmethod
    def from_mapping(cls, data: dict[str, Any] | None) -> "AgentEndpoints":
        values = data or {}
        heartbeat = str(values.get("heartbeat", cls.heartbeat)).strip()
        uploads = str(values.get("uploads", cls.uploads)).strip()
        for key, value in (("heartbeat", heartbeat), ("uploads", uploads)):
            if not value.startswith("/") or value.startswith("//"):
                raise ValueError(f"agent_endpoints.{key} must be an absolute API path")
        return cls(heartbeat=heartbeat, uploads=uploads)


@dataclass(frozen=True)
class SpecialWorkflowConfig:
    enabled: bool = False
    image_stack_folder_name: str = "Images STACK"
    images_folder_name: str = "images_halo-watcher"
    pdfs_folder_name: str = "pdfs_halo-watcher"
    docx_folder_name: str = "docx_halo-watcher"
    other_upload_folder_name: str = "other upload"
    image_stack_identifier_variants: tuple[str, ...] = ()
    grouping_minutes: int = 30
    ocr_tesseract_cmd: str | None = None
    pdf_ocr_max_pages: int = 10

    @classmethod
    def from_mapping(cls, data: dict[str, Any] | None) -> "SpecialWorkflowConfig":
        values = data or {}
        raw_identifiers = values.get("expected_image_identifiers", [])
        if not isinstance(raw_identifiers, list):
            raise ValueError("special_workflows.expected_image_identifiers must be an array")
        identifiers = tuple(value for value in (str(item).strip() for item in raw_identifiers) if value)
        tesseract = values.get("ocr_tesseract_cmd")
        return cls(
            enabled=_strict_bool(values, "enabled", False),
            image_stack_folder_name=_simple_folder_name(values.get("image_stack_folder_name", "Images STACK"), "image_stack_folder_name"),
            images_folder_name=_simple_folder_name(values.get("images_folder_name", "images_halo-watcher"), "images_folder_name"),
            pdfs_folder_name=_simple_folder_name(values.get("pdfs_folder_name", "pdfs_halo-watcher"), "pdfs_folder_name"),
            docx_folder_name=_simple_folder_name(values.get("docx_folder_name", "docx_halo-watcher"), "docx_folder_name"),
            other_upload_folder_name=_simple_folder_name(values.get("other_upload_folder_name", "other upload"), "other_upload_folder_name"),
            image_stack_identifier_variants=identifiers,
            grouping_minutes=int(values.get("grouping_minutes", 30)),
            ocr_tesseract_cmd=str(tesseract).strip() if tesseract else None,
            pdf_ocr_max_pages=int(values.get("pdf_ocr_max_pages", 10)),
        )

    def folder_names(self) -> tuple[str, ...]:
        return (
            self.image_stack_folder_name,
            self.images_folder_name,
            self.pdfs_folder_name,
            self.docx_folder_name,
            self.other_upload_folder_name,
        )


@dataclass(frozen=True)
class SentryConfig:
    watch_directory: Path
    api_base_url: str
    device_id: str
    installation_id: str
    device_credential_path: Path
    watch_volume_serial: str | None = None
    config_schema_version: int = CURRENT_CONFIG_SCHEMA_VERSION
    contract_version: int = AGENT_CONTRACT_VERSION
    heartbeat_interval_seconds: int = 60
    max_upload_bytes: int = 20 * 1024 * 1024
    agent_endpoints: AgentEndpoints = field(default_factory=AgentEndpoints)

    settle_seconds: float = 3.0
    max_lock_retries: int = 5
    lock_retry_delay_seconds: float = 2.0
    ignored_extensions: tuple[str, ...] = DEFAULT_IGNORED_EXTENSIONS
    ignored_prefixes: tuple[str, ...] = DEFAULT_IGNORED_PREFIXES
    log_file: Path = Path("logs/heimdall.log")
    state_directory: Path = Path("state")
    processed_subdirectory: str = "_halo_processed"
    review_subdirectory: str = "_halo_review"
    delete_after_upload: bool = False
    max_workers: int = 2
    queue_capacity: int = 256
    startup_backlog_enabled: bool = True
    retry_initial_delay_seconds: float = 15.0
    retry_max_delay_seconds: float = 900.0
    retry_dispatch_interval_seconds: float = 5.0
    special_workflows: SpecialWorkflowConfig = field(default_factory=SpecialWorkflowConfig)

    @classmethod
    def from_mapping(cls, data: dict[str, Any]) -> "SentryConfig":
        version = int(data.get("config_schema_version", 0))
        if version != CURRENT_CONFIG_SCHEMA_VERSION:
            raise ValueError(f"config_schema_version must be {CURRENT_CONFIG_SCHEMA_VERSION}")
        contract = int(data.get("contract_version", 0))
        if contract != AGENT_CONTRACT_VERSION:
            raise ValueError(f"contract_version must be {AGENT_CONTRACT_VERSION}")

        extensions = data.get("ignored_extensions", list(DEFAULT_IGNORED_EXTENSIONS))
        prefixes = data.get("ignored_prefixes", list(DEFAULT_IGNORED_PREFIXES))
        if not isinstance(extensions, list) or not isinstance(prefixes, list):
            raise ValueError("ignored_extensions and ignored_prefixes must be arrays")
        normalized_extensions = tuple(
            value.lower() if value.startswith(".") else f".{value.lower()}"
            for value in (str(item).strip() for item in extensions)
            if value
        )
        volume_serial = str(data.get("watch_volume_serial", "")).strip() or None
        return cls(
            watch_directory=Path(data["watch_directory"]).expanduser(),
            api_base_url=str(data["api_base_url"]).strip().rstrip("/"),
            device_id=str(data["device_id"]).strip(),
            installation_id=str(data["installation_id"]).strip(),
            device_credential_path=Path(data["device_credential_path"]).expanduser(),
            watch_volume_serial=volume_serial,
            config_schema_version=version,
            contract_version=contract,
            heartbeat_interval_seconds=int(data.get("heartbeat_interval_seconds", 60)),
            max_upload_bytes=int(data.get("max_upload_bytes", 20 * 1024 * 1024)),
            agent_endpoints=AgentEndpoints.from_mapping(data.get("agent_endpoints")),
            settle_seconds=float(data.get("settle_seconds", 3.0)),
            max_lock_retries=int(data.get("max_lock_retries", 5)),
            lock_retry_delay_seconds=float(data.get("lock_retry_delay_seconds", 2.0)),
            ignored_extensions=normalized_extensions,
            ignored_prefixes=tuple(str(item) for item in prefixes),
            log_file=Path(data.get("log_file", "logs/heimdall.log")).expanduser(),
            state_directory=Path(data.get("state_directory", "state")).expanduser(),
            processed_subdirectory=_simple_folder_name(data.get("processed_subdirectory", "_halo_processed"), "processed_subdirectory"),
            review_subdirectory=_simple_folder_name(data.get("review_subdirectory", "_halo_review"), "review_subdirectory"),
            delete_after_upload=_strict_bool(data, "delete_after_upload", False),
            max_workers=int(data.get("max_workers", 2)),
            queue_capacity=int(data.get("queue_capacity", 256)),
            startup_backlog_enabled=_strict_bool(data, "startup_backlog_enabled", True),
            retry_initial_delay_seconds=float(data.get("retry_initial_delay_seconds", 15.0)),
            retry_max_delay_seconds=float(data.get("retry_max_delay_seconds", 900.0)),
            retry_dispatch_interval_seconds=float(data.get("retry_dispatch_interval_seconds", 5.0)),
            special_workflows=SpecialWorkflowConfig.from_mapping(data.get("special_workflows")),
        )

    def validate(self) -> None:
        if not _is_allowed_api_origin(self.api_base_url):
            raise ValueError(
                "api_base_url must be an HTTPS origin, or an HTTP loopback origin for synthetic local testing"
            )
        if not _UUID.match(self.device_id) or not _UUID.match(self.installation_id):
            raise ValueError("device_id and installation_id must be UUIDs")
        if self.watch_directory == Path(self.watch_directory.anchor):
            raise ValueError("watch_directory cannot be a filesystem root")
        if not self.watch_volume_serial:
            raise ValueError("watch_volume_serial is required")
        if self.heartbeat_interval_seconds < 15:
            raise ValueError("heartbeat_interval_seconds must be >= 15")
        if self.max_upload_bytes < 1:
            raise ValueError("max_upload_bytes must be positive")
        if self.settle_seconds < 0 or self.lock_retry_delay_seconds < 0 or self.max_lock_retries < 1:
            raise ValueError("invalid file readiness configuration")
        if not 1 <= self.max_workers <= 8 or not 1 <= self.queue_capacity <= 10_000:
            raise ValueError("invalid bounded worker configuration")
        if self.retry_initial_delay_seconds < 0 or self.retry_max_delay_seconds < self.retry_initial_delay_seconds:
            raise ValueError("invalid retry delays")
        if self.retry_dispatch_interval_seconds <= 0:
            raise ValueError("retry_dispatch_interval_seconds must be positive")

        local_names = (self.processed_subdirectory, self.review_subdirectory)
        special_names = self.special_workflows.folder_names()
        all_names = (*local_names, *special_names)
        if len({name.casefold() for name in all_names}) != len(all_names):
            raise ValueError("runtime and special workflow folder names must be unique")
        if self.special_workflows.enabled:
            raise ValueError("recursive special workflows are not supported by proxy contract v1")


def load_config(path: Path | None = None) -> SentryConfig:
    config_path = path or Path(os.environ.get("HALO_SENTRY_CONFIG", "config.json")).expanduser()
    if not config_path.is_file():
        raise FileNotFoundError("Heimdall configuration was not found; re-run the Beamer installer")
    with config_path.open(encoding="utf-8-sig") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("Configuration root must be a JSON object")
    config = SentryConfig.from_mapping(data)
    config.validate()
    return config
