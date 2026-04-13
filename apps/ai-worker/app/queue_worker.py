"""
BullMQ queue consumer. Reads jobs from the 'ai-calls' queue and runs the
call processing pipeline. Uses the official Python BullMQ client.

The worker is started as a background asyncio task inside the FastAPI lifespan
so that the /health endpoint stays available while processing is in progress.

Job payload (set by NestJS CallsService.handleRecordingWebhook):
  {
    "callId":       "<cuid>",
    "tenantId":     "<cuid>",
    "recordingUrl": "https://api.twilio.com/.../Recordings/RExxx",
    "recordingSid": "RExxxxxx"
  }
"""
from __future__ import annotations

import logging
import urllib.parse
from typing import Any

from .pipeline import process_call

logger = logging.getLogger(__name__)

QUEUE_NAME = "ai-calls"


def _redis_opts_from_url(redis_url: str) -> dict[str, Any]:
    """Convert a redis:// URL to the connection dict expected by BullMQ Python."""
    parsed = urllib.parse.urlparse(redis_url)
    opts: dict[str, Any] = {
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 6379,
    }
    if parsed.password:
        opts["password"] = parsed.password
    if parsed.path and parsed.path.lstrip("/"):
        try:
            opts["db"] = int(parsed.path.lstrip("/"))
        except ValueError:
            pass
    return opts


async def process_job(job: Any, token: str) -> dict[str, Any]:
    """BullMQ job handler — called for every job on the 'ai-calls' queue."""
    logger.info("BullMQ job received id=%s name=%s", job.id, job.name)
    try:
        result = await process_call(job.data)
        return result
    except Exception as exc:
        logger.error("Job %s failed: %s", job.id, exc)
        # Re-raise so BullMQ marks the job as failed and applies retry/backoff
        raise


def create_worker() -> Any:
    """
    Instantiate a BullMQ Worker. Returns None if bullmq is not installed
    (graceful degradation — the FastAPI app still starts without the queue).
    """
    from .config import settings

    try:
        from bullmq import Worker  # type: ignore[import]

        redis_opts = _redis_opts_from_url(settings.REDIS_URL)
        worker = Worker(QUEUE_NAME, process_job, {"connection": redis_opts})
        logger.info("BullMQ worker started on queue '%s' (redis=%s)", QUEUE_NAME, settings.REDIS_URL)
        return worker
    except ImportError:
        logger.warning(
            "bullmq package not installed — queue worker disabled. "
            "Install with: pip install bullmq"
        )
        return None
    except Exception as exc:
        logger.error("Failed to start BullMQ worker: %s", exc)
        return None
