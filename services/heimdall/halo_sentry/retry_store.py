"""Crash-safe journal containing opaque spool references only."""

from __future__ import annotations

import json
import os
import re
import threading
import uuid

from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from pathlib import Path

from halo_sentry.path_safety import opaque_spool_path


_SPOOL_NAME = re.compile(r"^(?P<id>[0-9a-f-]{36})(?P<suffix>\.[a-z0-9]{1,10})$", re.I)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class RetryJob:
    id: str
    spool_name: str
    kind: str
    review_reason_code: str | None = None
    attempts: int = 0
    next_attempt_at: str = "1970-01-01T00:00:00+00:00"

    @classmethod
    def create(
        cls,
        suffix: str,
        *,
        kind: str,
        review_reason_code: str | None = None,
        delay_seconds: float = 0.0,
        job_id: str | None = None,
    ) -> "RetryJob":
        identifier = job_id or str(uuid.uuid4())
        safe_suffix = suffix.lower() if re.fullmatch(r"\.[a-z0-9]{1,10}", suffix.lower()) else ".bin"
        next_at = datetime.fromtimestamp(
            _utc_now().timestamp() + max(0.0, delay_seconds), tz=timezone.utc
        ).isoformat()
        return cls(
            id=identifier,
            spool_name=f"{identifier}{safe_suffix}",
            kind=kind,
            review_reason_code=review_reason_code,
            next_attempt_at=next_at,
        )

    def due(self, now: datetime | None = None) -> bool:
        due_at = datetime.fromisoformat(self.next_attempt_at)
        if due_at.tzinfo is None:
            due_at = due_at.replace(tzinfo=timezone.utc)
        return due_at <= (now or _utc_now())


class RetryStore:
    def __init__(self, state_directory: Path) -> None:
        self.state_directory = state_directory
        opaque_spool_path(state_directory, "00000000-0000-4000-8000-000000000000.bin")
        self._path = state_directory / "pending_uploads.json"
        self._lock = threading.RLock()
        self._jobs: dict[str, RetryJob] = {}
        self._load()
        self.recover_orphaned_spool_files()

    def path_for(self, job: RetryJob) -> Path:
        return opaque_spool_path(self.state_directory, job.spool_name)

    def add(self, job: RetryJob) -> RetryJob:
        with self._lock:
            existing = self._jobs.get(job.id)
            if existing:
                return existing
            self._jobs[job.id] = job
            self._write()
            return job

    def due_jobs(self, now: datetime | None = None) -> tuple[RetryJob, ...]:
        with self._lock:
            return tuple(job for job in self._jobs.values() if job.due(now))

    def remove(self, job_id: str) -> None:
        with self._lock:
            if self._jobs.pop(job_id, None) is not None:
                self._write()

    def reschedule(self, job_id: str, *, delay_seconds: float) -> RetryJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            next_at = datetime.fromtimestamp(
                _utc_now().timestamp() + max(0.0, delay_seconds), tz=timezone.utc
            ).isoformat()
            updated = replace(job, attempts=job.attempts + 1, next_attempt_at=next_at)
            self._jobs[job_id] = updated
            self._write()
            return updated

    def all_jobs(self) -> tuple[RetryJob, ...]:
        with self._lock:
            return tuple(self._jobs.values())

    def recover_orphaned_spool_files(self) -> int:
        spool = self.state_directory / "spool"
        if not spool.is_dir():
            return 0
        recovered = 0
        with self._lock:
            for path in spool.iterdir():
                match = _SPOOL_NAME.fullmatch(path.name)
                if not match or not path.is_file() or match.group("id") in self._jobs:
                    continue
                job = RetryJob.create(
                    match.group("suffix"), kind="recovered", job_id=match.group("id")
                )
                self._jobs[job.id] = job
                recovered += 1
            if recovered:
                self._write()
        return recovered

    def _load(self) -> None:
        if not self._path.is_file():
            return
        with self._path.open(encoding="utf-8-sig") as handle:
            raw = json.load(handle)
        if not isinstance(raw, dict) or raw.get("schema_version") != 2:
            raise ValueError("Unsupported pending upload journal schema")
        for item in raw.get("jobs", []):
            job = RetryJob(**dict(item))
            if not _SPOOL_NAME.fullmatch(job.spool_name) or not job.spool_name.startswith(job.id):
                raise ValueError("Pending upload journal contains an invalid opaque reference")
            self._jobs[job.id] = job

    def _write(self) -> None:
        self.state_directory.mkdir(parents=True, exist_ok=True)
        temp = self._path.with_suffix(".tmp")
        payload = {"schema_version": 2, "jobs": [asdict(job) for job in self._jobs.values()]}
        with temp.open("w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, self._path)
