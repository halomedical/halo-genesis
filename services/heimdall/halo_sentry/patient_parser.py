"""Patient identity parsing helpers for OCR/text workflow inputs."""

from __future__ import annotations

import re

from dataclasses import dataclass


@dataclass(frozen=True)
class PatientIdentity:
    name: str
    patient_id: str | None = None
    dob: str | None = None
    sex: str | None = None

    @property
    def normalized_key(self) -> str:
        parts = [self.name, self.patient_id or "", self.dob or ""]
        return normalize_for_match(" ".join(parts))


_NAME_CHARS = r"A-Za-zÀ-ÖØ-öø-ÿ' .,-"
_LABEL_VALUE_STOP = re.compile(
    r"\b(?:dob|date\s+of\s+birth|birth|sex|gender|mrn|id|patient\s+id|"
    r"hospital\s+no|date|time)\b",
    re.IGNORECASE,
)

_FULL_NAME_PATTERNS = (
    re.compile(
        rf"\b(?:patient\s*)?(?:name|patient\s+name|pt\s+name)"
        rf"\s*[:=-]\s*([{_NAME_CHARS}]{{2,100}})",
        re.IGNORECASE,
    ),
    re.compile(
        rf"\b(?:patient|pt)\s*[:=-]\s*([{_NAME_CHARS}]{{2,100}})",
        re.IGNORECASE,
    ),
)

_SURNAME_PATTERN = re.compile(
    rf"\b(?:surname|last\s+name|family\s+name)\s*[:=-]\s*"
    rf"([{_NAME_CHARS}]{{2,80}})",
    re.IGNORECASE,
)
_GIVEN_PATTERN = re.compile(
    rf"\b(?:first\s+name|firstname|given\s+name|forename)"
    rf"\s*[:=-]\s*([{_NAME_CHARS}]{{2,80}})",
    re.IGNORECASE,
)
_PATIENT_ID_PATTERN = re.compile(
    r"\b(?:patient\s*)?(?:id|mrn|hospital\s+no|folder\s+no)"
    r"\s*[:=-]\s*([A-Z0-9][A-Z0-9 ._/-]{2,40})",
    re.IGNORECASE,
)
_DOB_PATTERN = re.compile(
    r"\b(?:dob|date\s+of\s+birth|birth\s+date)"
    r"\s*[:=-]\s*([0-9]{1,4}[0-9A-Za-z ._/-]{3,20})",
    re.IGNORECASE,
)
_SEX_PATTERN = re.compile(
    r"\b(?:sex|gender)\s*[:=-]\s*(male|female|m|f|other|unknown)\b",
    re.IGNORECASE,
)


def normalize_for_match(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower().replace("0", "o"))


def text_matches_any_variant(text: str, variants: tuple[str, ...]) -> bool:
    normalized_text = normalize_for_match(text)
    return any(
        normalize_for_match(variant) in normalized_text
        for variant in variants
        if variant.strip()
    )

def sanitize_folder_segment(value: str, *, max_length: int = 120) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", value)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._")
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length].rstrip(" ._")
    return cleaned or "Unknown"


def extract_patient_identity(
    text: str,
    *,
    excluded_names: tuple[str, ...] = (),
) -> PatientIdentity | None:
    normalized_text = _normalize_text(text)
    name = _extract_name(normalized_text, excluded_names=excluded_names)
    if not name:
        return None

    return PatientIdentity(
        name=name,
        patient_id=_extract_optional(_PATIENT_ID_PATTERN, normalized_text),
        dob=_extract_optional(_DOB_PATTERN, normalized_text),
        sex=_extract_optional(_SEX_PATTERN, normalized_text),
    )


def _normalize_text(text: str) -> str:
    text = text.replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


def _extract_name(
    text: str,
    *,
    excluded_names: tuple[str, ...],
) -> str | None:
    surname = _extract_optional(_SURNAME_PATTERN, text)
    given = _extract_optional(_GIVEN_PATTERN, text)
    if surname and given:
        combined = _clean_name(f"{given} {surname}")
        if _is_usable_name(combined, excluded_names):
            return combined

    for pattern in _FULL_NAME_PATTERNS:
        for match in pattern.finditer(text):
            candidate = _clean_name(match.group(1))
            if _is_usable_name(candidate, excluded_names):
                return candidate

    return None


def _extract_optional(pattern: re.Pattern[str], text: str) -> str | None:
    match = pattern.search(text)
    if not match:
        return None
    value = _trim_labeled_value(match.group(1))
    return value or None


def _trim_labeled_value(value: str) -> str:
    value = value.splitlines()[0]
    stop = _LABEL_VALUE_STOP.search(value)
    if stop:
        value = value[: stop.start()]
    value = re.sub(r"\s+", " ", value).strip(" .,_-/")
    return value


def _clean_name(value: str) -> str:
    value = _trim_labeled_value(value)
    if "," in value:
        parts = [part.strip() for part in value.split(",", maxsplit=1)]
        if all(parts):
            value = f"{parts[1]} {parts[0]}"
    value = re.sub(rf"[^{_NAME_CHARS}]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip(" .,-")
    return value.title()


def _is_usable_name(
    value: str | None,
    excluded_names: tuple[str, ...],
) -> bool:
    if not value:
        return False

    words = [word for word in value.split(" ") if word]
    if len(words) < 2:
        return False

    normalized = normalize_for_match(value)
    return all(
        normalize_for_match(excluded) != normalized
        for excluded in excluded_names
    )
