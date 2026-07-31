"""Timestamp parsing for Fujifilm-style filenames, folders, and OCR text."""

from __future__ import annotations

import re

from datetime import datetime
from pathlib import Path


_YMD_COMPACT = re.compile(
    r"(?<!\d)(?P<ymd>20\d{2}[01]\d[0-3]\d)"
    r"[\s_.-]?(?P<time>[0-2]\d[0-5]\d(?:[0-5]\d)?)(?!\d)"
)
_YMD_SEPARATED = re.compile(
    r"(?<!\d)(?P<year>20\d{2})[-_./ ](?P<month>\d{1,2})"
    r"[-_./ ](?P<day>\d{1,2})"
    r"(?:[\sT_-]+(?P<hour>\d{1,2})(?:[:hH._-]?"
    r"(?P<minute>\d{2})(?:[:._-]?(?P<second>\d{2}))?)?)?",
    re.IGNORECASE,
)
_DMY_COMPACT = re.compile(
    r"(?<!\d)(?P<day>[0-3]\d)(?P<month>[01]\d)(?P<year>20\d{2})"
    r"[\s_.-]?(?P<time>[0-2]\d[0-5]\d(?:[0-5]\d)?)(?!\d)"
)
_DMY_SEPARATED = re.compile(
    r"(?<!\d)(?P<day>\d{1,2})[-_./ ](?P<month>\d{1,2})"
    r"[-_./ ](?P<year>20\d{2})"
    r"(?:[\sT_-]+(?P<hour>\d{1,2})(?:[:hH._-]?"
    r"(?P<minute>\d{2})(?:[:._-]?(?P<second>\d{2}))?)?)?",
    re.IGNORECASE,
)


def timestamp_for_path(
    path: Path,
    *,
    workflow_root: Path,
    ocr_text: str = "",
    fallback_mtime: datetime | None = None,
) -> datetime:
    """
    Find a timestamp in filename first, then folder names, then OCR text.

    File modified time is the final fallback because many exporters preserve the
    capture time there when filenames do not contain a full timestamp.
    """
    search_values = [path.name]

    try:
        relative_parent = path.parent.relative_to(workflow_root)
    except ValueError:
        relative_parent = Path()

    search_values.extend(reversed(relative_parent.parts))
    if ocr_text:
        search_values.append(ocr_text)

    for value in search_values:
        parsed = extract_timestamp(value, fallback_mtime=fallback_mtime)
        if parsed:
            return parsed

    return fallback_mtime or datetime.fromtimestamp(path.stat().st_mtime)


def extract_timestamp(
    value: str,
    *,
    fallback_mtime: datetime | None = None,
) -> datetime | None:
    for pattern in (_YMD_COMPACT, _DMY_COMPACT):
        for match in pattern.finditer(value):
            parsed = _build_compact(match)
            if parsed:
                return parsed

    for pattern in (_YMD_SEPARATED, _DMY_SEPARATED):
        for match in pattern.finditer(value):
            parsed = _build_separated(match, fallback_mtime=fallback_mtime)
            if parsed:
                return parsed

    return None


def _build_compact(match: re.Match[str]) -> datetime | None:
    groups = match.groupdict()
    if "ymd" in groups and groups.get("ymd"):
        date_value = groups["ymd"]
        year = int(date_value[0:4])
        month = int(date_value[4:6])
        day = int(date_value[6:8])
    else:
        year = int(groups["year"])
        month = int(groups["month"])
        day = int(groups["day"])

    time_value = groups["time"]
    hour = int(time_value[0:2])
    minute = int(time_value[2:4])
    second = int(time_value[4:6]) if len(time_value) >= 6 else 0
    return _safe_datetime(year, month, day, hour, minute, second)


def _build_separated(
    match: re.Match[str],
    *,
    fallback_mtime: datetime | None,
) -> datetime | None:
    groups = match.groupdict()
    year = int(groups["year"])
    month = int(groups["month"])
    day = int(groups["day"])

    if groups.get("hour") is not None:
        hour = int(groups["hour"])
        minute = int(groups.get("minute") or 0)
        second = int(groups.get("second") or 0)
    elif fallback_mtime:
        hour = fallback_mtime.hour
        minute = fallback_mtime.minute
        second = fallback_mtime.second
    else:
        hour = minute = second = 0

    return _safe_datetime(year, month, day, hour, minute, second)


def _safe_datetime(
    year: int,
    month: int,
    day: int,
    hour: int,
    minute: int,
    second: int,
) -> datetime | None:
    try:
        return datetime(year, month, day, hour, minute, second)
    except ValueError:
        return None
