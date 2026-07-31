"""Watchdog-based directory monitoring."""

from __future__ import annotations

import logging
from pathlib import Path

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from halo_sentry.config import SentryConfig
from halo_sentry.pipeline import FilePipeline
from halo_sentry.privacy import safe_file_ref

logger = logging.getLogger("halo_sentry.watcher")


class HaloSentryHandler(FileSystemEventHandler):
    def __init__(self, pipeline: FilePipeline) -> None:
        super().__init__()
        self._pipeline = pipeline

    def on_created(self, event: FileSystemEvent) -> None:
        self._handle(Path(event.src_path))

    def on_moved(self, event: FileSystemEvent) -> None:
        dest = getattr(event, "dest_path", None)
        if dest:
            self._handle(Path(dest))

    def on_modified(self, event: FileSystemEvent) -> None:
        # Some Fujifilm exporters only emit modified events on Windows.
        self._handle(Path(event.src_path))

    def _handle(self, path: Path) -> None:
        if not self._pipeline.should_accept(path):
            return
        logger.info("Watchdog event for %s", safe_file_ref(path))
        self._pipeline.enqueue(path)


def run_observer(config: SentryConfig, pipeline: FilePipeline) -> Observer:
    watch_dir = config.watch_directory
    if not watch_dir.is_dir():
        raise NotADirectoryError(
            "Configured watch directory does not exist or is unavailable."
        )

    handler = HaloSentryHandler(pipeline)
    observer = Observer()
    pipeline.ensure_special_watch_directories()
    observer.schedule(handler, str(watch_dir), recursive=False)
    observer.start()
    logger.info("Watching configured directory (non-recursive)")
    return observer
