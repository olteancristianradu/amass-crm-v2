"""
Call processing pipeline.

For each AI job:
  1. Download audio from Twilio URL (or MinIO if recordingStorageKey is set)
  2. Transcribe with Whisper (stub in dev)
  3. Redact PII with Presidio (regex stub in dev)
  4. Summarise with Claude (real if ANTHROPIC_API_KEY set)
  5. POST result to NestJS API (POST /api/v1/calls/{callId}/ai-result)
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from .config import settings
from .transcription import transcribe
from .redaction import redact
from .summary import summarise

logger = logging.getLogger(__name__)


async def process_call(job_data: dict[str, Any]) -> dict[str, Any]:
    """
    Full pipeline for a single call recording.

    job_data keys:
      callId       : str  — our internal call ID
      tenantId     : str  — tenant for auth
      recordingUrl : str  — Twilio recording URL
      recordingSid : str  — Twilio recording SID
    """
    call_id = job_data["callId"]
    recording_url = job_data.get("recordingUrl", "")
    logger.info("Processing call %s recording=%s", call_id, recording_url)

    # ── Step 1: Download audio ────────────────────────────────────────────────
    audio_bytes = await _download_recording(recording_url)

    # ── Step 2: Transcribe ───────────────────────────────────────────────────
    transcription = transcribe(audio_bytes)

    # ── Step 3: Redact PII ───────────────────────────────────────────────────
    redacted_text = redact(transcription["rawText"])

    # ── Step 4: Summarise ────────────────────────────────────────────────────
    ai_result = summarise(transcription["rawText"])

    # ── Step 5: POST result to API ───────────────────────────────────────────
    payload: dict[str, Any] = {
        "language": transcription.get("language"),
        "rawText": transcription["rawText"],
        "segments": transcription["segments"],
        "redactedText": redacted_text,
        "summary": ai_result.get("summary"),
        "actionItems": ai_result.get("actionItems"),
        "sentiment": ai_result.get("sentiment"),
        "topics": ai_result.get("topics"),
        "model": ai_result.get("model"),
    }
    # Strip None values so Zod doesn't complain about unexpected nulls
    payload = {k: v for k, v in payload.items() if v is not None}

    await _post_result(call_id, payload)
    logger.info("Call %s processed successfully", call_id)
    return payload


async def _download_recording(recording_url: str) -> bytes:
    """
    Download audio from a Twilio recording URL.
    Twilio requires HTTP Basic Auth (accountSid:authToken).
    Returns empty bytes if the URL is blank or download fails (stub mode).
    """
    if not recording_url:
        logger.info("No recording URL — using empty audio (stub mode)")
        return b""

    # Append .mp3 to get a direct audio file (Twilio redirects to the media)
    url = recording_url if recording_url.endswith(".mp3") else recording_url + ".mp3"

    try:
        auth = None
        if settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN:
            auth = (settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(url, auth=auth, follow_redirects=True)
            resp.raise_for_status()
            logger.info("Downloaded recording %d bytes", len(resp.content))
            return resp.content
    except Exception as exc:
        logger.error("Recording download failed: %s", exc)
        return b""


async def _post_result(call_id: str, payload: dict[str, Any]) -> None:
    """POST the AI result to the NestJS API callback endpoint."""
    url = f"{settings.API_URL.rstrip('/')}/api/v1/calls/{call_id}/ai-result"

    if not settings.AI_WORKER_SECRET:
        logger.warning("AI_WORKER_SECRET not set — skipping API callback")
        return

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={
                    "Authorization": f"Bearer {settings.AI_WORKER_SECRET}",
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
            logger.info("API callback succeeded for call %s: %s", call_id, resp.status_code)
    except Exception as exc:
        logger.error("API callback failed for call %s: %s", call_id, exc)
        # Re-raise so BullMQ marks the job as failed and retries
        raise
