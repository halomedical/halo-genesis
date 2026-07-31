"""Entry point: python -m halo_sentry"""

from __future__ import annotations

import signal
import threading
import time

from dataclasses import replace
from halo_sentry.config import load_config
from halo_sentry import __version__
from halo_sentry.api_client import BeamerApiClient
from halo_sentry.logging_setup import configure_logging
from halo_sentry.pipeline import FilePipeline
from halo_sentry.path_safety import resolve_watch_directory
from halo_sentry.watcher import run_observer

_STOP = threading.Event()


def _handle_stop(signum: int, frame: object | None) -> None:  # noqa: ARG001
    _STOP.set()


def main() -> int:
    config = load_config()
    config = replace(
        config,
        watch_directory=resolve_watch_directory(
            config.watch_directory,
            config.watch_volume_serial or "",
        ),
    )
    logger = configure_logging(config.log_file)
    logger.info("Halo Sentry starting")

    config.watch_directory.mkdir(parents=True, exist_ok=True)

    uploader = BeamerApiClient(config)
    uploader.verify_agent_access()

    pipeline = FilePipeline(config, uploader)
    pipeline.validate_runtime_dependencies()
    pipeline.start()
    try:
        observer = run_observer(config, pipeline)
        pipeline.enqueue_startup_backlog()
    except Exception:
        pipeline.shutdown()
        raise

    signal.signal(signal.SIGINT, _handle_stop)
    signal.signal(signal.SIGTERM, _handle_stop)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _handle_stop)

    logger.info("Halo Sentry running")
    next_heartbeat = 0.0
    try:
        while not _STOP.is_set():
            now = time.monotonic()
            if now >= next_heartbeat:
                try:
                    uploader.heartbeat(
                        agent_version=__version__,
                        pending_upload_count=pipeline.pending_upload_count,
                        pending_review_count=pipeline.pending_review_count,
                        last_synced_at=pipeline.last_synced_at,
                    )
                except Exception:
                    logger.warning("Beamer heartbeat failed; upload processing will continue")
                next_heartbeat = now + config.heartbeat_interval_seconds
            _STOP.wait(timeout=1.0)
    finally:
        observer.stop()
        observer.join(timeout=30)
        pipeline.shutdown(timeout=30)
        logger.info("Halo Sentry stopped")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
