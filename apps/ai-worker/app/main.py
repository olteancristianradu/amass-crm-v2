"""
AMASS AI Worker — Sprint 13
FastAPI app + BullMQ queue worker running in the same process.

HTTP endpoints:
  GET  /health              liveness probe
  POST /process/call        trigger pipeline manually (admin/testing)

Queue:
  Consumes 'ai-calls' BullMQ jobs posted by NestJS when a call recording is ready.
  Each job runs: download audio → transcribe → redact PII → summarise → POST result.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .config import settings
from .pipeline import process_call
from .queue_worker import create_worker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

_worker: Any = None


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    """
    Start the BullMQ worker on boot, close it on shutdown.
    The worker polls Redis in the background via asyncio — no separate process needed.
    """
    global _worker
    _worker = create_worker()
    logger.info(
        "AI worker ready — API_URL=%s WHISPER_MODEL=%s",
        settings.API_URL,
        settings.WHISPER_MODEL,
    )
    yield
    if _worker is not None:
        try:
            await _worker.close()
            logger.info("BullMQ worker closed")
        except Exception as exc:
            logger.error("Error closing worker: %s", exc)


app = FastAPI(title="amass-ai-worker", version="0.13.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "sprint": 13,
        "worker": _worker is not None,
        "whisper_model": settings.WHISPER_MODEL,
        "anthropic_configured": bool(settings.ANTHROPIC_API_KEY),
    }


class ManualProcessRequest(BaseModel):
    callId: str
    tenantId: str
    recordingUrl: str = ""
    recordingSid: str = ""


@app.post("/process/call")
async def manual_process(req: ManualProcessRequest) -> dict[str, Any]:
    """
    Manually trigger the pipeline for a call (admin/debug use only).
    In production this endpoint should be protected by a firewall or
    the same AI_WORKER_SECRET as the API callback.
    """
    try:
        result = await process_call(req.model_dump())
        return {"status": "ok", "callId": req.callId, "result": result}
    except Exception as exc:
        logger.error("Manual process failed for call %s: %s", req.callId, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
