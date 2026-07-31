"""POPIA-oriented filename de-identification before upload."""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime
from pathlib import Path

logger = logging.getLogger("halo_sentry.popia")

# Files already renamed by Halo Sentry must not be re-processed on watchdog events.
HALO_SAFE_PREFIX = "halo_"

# UPDATED: Radar now explicitly looks for halo_YYYYMMDD_HHMMSS_UUID
HALO_SAFE_PATTERN = re.compile(
    r"^halo_\d{8}_\d{6}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    re.IGNORECASE,
)

# Heuristic patterns that often appear in clinical export filenames.
PII_FILENAME_HINTS = re.compile(
    r"(patient|pat_|mrn|name|surname|dob|birth|id[_-]?no|"
    r"firstname|lastname|given|family)",
    re.IGNORECASE,
)


def is_already_deidentified(path: Path) -> bool:
    return bool(HALO_SAFE_PATTERN.match(path.stem))


def deidentify_filename(path: Path) -> Path:
    """
    Rename file locally, replacing identifiable filename segments with a timestamp and UUID.

    Original name is never logged. A privacy-safe correlation token is used.
    Extension is preserved for downstream clinical viewers.
    """
    if is_already_deidentified(path):
        return path

    # Generate the exact time of processing (Format: YYYYMMDD_HHMMSS)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # Construct the new format: halo_[timestamp]_[uuid].[extension]
    new_name = f"{HALO_SAFE_PREFIX}{timestamp}_{uuid.uuid4()}{path.suffix.lower()}"
    target = path.with_name(new_name)

    logger.info(
        "POPIA: de-identifying local filename%s",
        " (identifier-like pattern detected)" if PII_FILENAME_HINTS.search(path.stem) else "",
    )

    path.rename(target)
    return target
