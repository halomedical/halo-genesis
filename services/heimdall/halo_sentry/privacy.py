"""Helpers that keep patient names and local paths out of routine logs."""

from __future__ import annotations

import hashlib

from pathlib import Path


def safe_file_ref(path: Path) -> str:
    """Return a stable, non-reversible correlation token and extension."""
    normalized = str(path.resolve(strict=False)).casefold().encode("utf-8", errors="replace")
    digest = hashlib.sha256(normalized).hexdigest()[:12]
    suffix = path.suffix.lower()[:12]
    return f"file:{digest}{suffix}"


def safe_path_kind(path: Path) -> str:
    if path.is_dir():
        return "directory"
    return "file"
