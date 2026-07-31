"""File locking mitigation: settle time and exclusive-read verification."""

from __future__ import annotations

import logging
import sys
import time
from pathlib import Path

from halo_sentry.privacy import safe_file_ref

logger = logging.getLogger("halo_sentry.file_ready")

# Windows API constants for CreateFileW exclusive read probe.
if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    GENERIC_READ = 0x80000000
    FILE_SHARE_NONE = 0
    OPEN_EXISTING = 3
    FILE_ATTRIBUTE_NORMAL = 0x80
    INVALID_HANDLE_VALUE = wintypes.HANDLE(-1).value
    ERROR_SHARING_VIOLATION = 32
    ERROR_LOCK_VIOLATION = 33


class FileNotReadyError(RuntimeError):
    """Raised when a file remains locked after all retry attempts."""


def _exclusive_read_probe_windows(path: Path) -> None:
    """Attempt exclusive read access via CreateFileW (no share flags)."""
    handle = _kernel32.CreateFileW(
        str(path),
        GENERIC_READ,
        FILE_SHARE_NONE,
        None,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        None,
    )
    if handle == INVALID_HANDLE_VALUE:
        err = ctypes.get_last_error()
        if err in (ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION):
            raise PermissionError("File is locked by another process")
        raise OSError(err, "Exclusive file readiness probe failed")
    _kernel32.CloseHandle(handle)


def _exclusive_read_probe_posix(path: Path) -> None:
    with path.open("rb") as handle:
        handle.read(1)


def assert_exclusive_read_access(path: Path) -> None:
    if sys.platform == "win32":
        _exclusive_read_probe_windows(path)
    else:
        _exclusive_read_probe_posix(path)


def wait_until_file_ready(
    path: Path,
    *,
    settle_seconds: float,
    max_retries: int,
    retry_delay_seconds: float,
) -> None:
    """
    Wait for Fujifilm processor to finish writing, then confirm exclusive read.

    1. Initial settle sleep (brief recommends 2-5 seconds).
    2. Up to max_retries exclusive-read attempts; PermissionError triggers retry.
    """
    if not path.is_file():
        raise FileNotFoundError("File no longer exists")

    if settle_seconds > 0:
        logger.info(
            "Settle wait %.1fs before lock check: %s", settle_seconds, safe_file_ref(path)
        )
        time.sleep(settle_seconds)

    last_error: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            assert_exclusive_read_access(path)
            logger.info("File ready (attempt %d/%d): %s", attempt, max_retries, safe_file_ref(path))
            return
        except (PermissionError, OSError) as exc:
            last_error = exc
            if attempt >= max_retries:
                break
            logger.warning(
                "File locked, retry %d/%d in %.1fs: %s (%s)",
                attempt,
                max_retries,
                retry_delay_seconds,
                safe_file_ref(path),
                exc,
            )
            time.sleep(retry_delay_seconds)

    raise FileNotReadyError(
        f"File remained locked after {max_retries} attempts"
    ) from last_error
