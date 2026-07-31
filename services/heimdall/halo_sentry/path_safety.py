"""Canonical containment and Windows reparse-point protections."""

from __future__ import annotations

import os

from pathlib import Path
from typing import Callable, Iterable


FILE_ATTRIBUTE_REPARSE_POINT = 0x400


class UnsafePathError(ValueError):
    """Raised when a candidate may escape a configured Heimdall root."""


def is_reparse_or_symlink(path: Path) -> bool:
    try:
        stat = path.lstat()
    except FileNotFoundError:
        return False
    attributes = getattr(stat, "st_file_attributes", 0)
    return path.is_symlink() or bool(attributes & FILE_ATTRIBUTE_REPARSE_POINT)


def canonical_root(root: Path) -> Path:
    root = root.absolute()
    if not root.is_dir():
        raise UnsafePathError("Configured watch directory is unavailable")
    cursor = Path(root.anchor)
    for part in root.parts[1:]:
        cursor = cursor / part
        if is_reparse_or_symlink(cursor):
            raise UnsafePathError("Configured watch path cannot cross a link or reparse point")
    return root.resolve(strict=True)


def require_safe_file(path: Path, root: Path) -> Path:
    """Return a strict canonical file path after checking every path component."""
    canonical_watch = canonical_root(root)
    if not path.is_file() or is_reparse_or_symlink(path):
        raise UnsafePathError("Candidate is not a regular file")

    resolved = path.resolve(strict=True)
    try:
        relative = resolved.relative_to(canonical_watch)
    except ValueError as exc:
        raise UnsafePathError("Candidate escapes the configured watch directory") from exc

    cursor = canonical_watch
    for part in relative.parts:
        cursor = cursor / part
        if is_reparse_or_symlink(cursor):
            raise UnsafePathError("Candidate crosses a link or reparse point")
    if not resolved.is_file():
        raise UnsafePathError("Candidate is not a regular file")
    return resolved


def require_safe_destination(path: Path, root: Path) -> Path:
    canonical_parent = path.parent.resolve(strict=True)
    canonical_watch = canonical_root(root)
    try:
        canonical_parent.relative_to(canonical_watch)
    except ValueError as exc:
        raise UnsafePathError("Destination escapes the configured root") from exc
    if is_reparse_or_symlink(path.parent):
        raise UnsafePathError("Destination parent cannot be a link or reparse point")
    return canonical_parent / path.name


def opaque_spool_path(state_directory: Path, spool_name: str) -> Path:
    if not spool_name or Path(spool_name).name != spool_name:
        raise UnsafePathError("Invalid opaque spool name")
    state_directory.mkdir(parents=True, exist_ok=True)
    state_absolute = state_directory.absolute()
    cursor = Path(state_absolute.anchor)
    for part in state_absolute.parts[1:]:
        cursor = cursor / part
        if is_reparse_or_symlink(cursor):
            raise UnsafePathError("State path cannot cross a link or reparse point")
    spool = state_absolute / "spool"
    spool.mkdir(parents=True, exist_ok=True)
    if is_reparse_or_symlink(spool):
        raise UnsafePathError("Spool directory cannot be a link or reparse point")
    candidate = spool / spool_name
    if candidate.exists() and is_reparse_or_symlink(candidate):
        raise UnsafePathError("Spool file cannot be a link or reparse point")
    return candidate


def same_volume_identity(path: Path, expected_serial: str | None) -> bool:
    """Best-effort runtime guard; installer records the authoritative serial."""
    if not expected_serial or os.name != "nt":
        return True
    return _windows_volume_serial(Path(path.anchor)) == expected_serial.upper()


def resolve_watch_directory(
    configured_path: Path,
    expected_serial: str,
    *,
    volume_roots: Iterable[Path] | None = None,
    serial_reader: Callable[[Path], str | None] | None = None,
    original_root: Path | None = None,
) -> Path:
    """Resolve a reattached removable volume even if Windows changed its letter."""
    reader = serial_reader or _windows_volume_serial
    configured_path = configured_path.absolute()
    configured_root = (original_root or Path(configured_path.anchor)).absolute()
    try:
        relative = configured_path.relative_to(configured_root)
    except ValueError as exc:
        raise UnsafePathError("Configured watch path is not relative to its volume root") from exc

    candidates = tuple(volume_roots) if volume_roots is not None else _windows_volume_roots()
    # Check the configured root first, then all other mounted volumes.
    ordered = (configured_root, *(root.absolute() for root in candidates if root.absolute() != configured_root))
    for root in ordered:
        if (reader(root) or "").casefold() != expected_serial.casefold():
            continue
        candidate = root / relative
        if candidate.is_dir():
            return candidate.resolve(strict=True)
    raise UnsafePathError("Enrolled watch volume is not attached or its configured watch folder is unavailable")


def _windows_volume_roots() -> tuple[Path, ...]:
    if os.name != "nt":
        return ()
    try:
        import ctypes

        mask = ctypes.windll.kernel32.GetLogicalDrives()
        return tuple(Path(f"{chr(65 + index)}:\\") for index in range(26) if mask & (1 << index))
    except Exception:
        return ()


def _windows_volume_serial(root: Path) -> str | None:
    if os.name != "nt":
        return None
    try:
        import ctypes

        serial = ctypes.c_ulong()
        ok = ctypes.windll.kernel32.GetVolumeInformationW(
            ctypes.c_wchar_p(str(root)), None, 0, ctypes.byref(serial), None, None, None, 0
        )
        return f"{serial.value:08X}" if ok else None
    except Exception:
        return None
