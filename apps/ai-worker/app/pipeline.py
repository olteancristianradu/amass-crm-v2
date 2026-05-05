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

import ipaddress
import logging
import os
import socket
from typing import Any
from urllib.parse import urlparse

import httpx

from .config import settings
from .transcription import transcribe
from .redaction import redact
from .summary import summarise

logger = logging.getLogger(__name__)


# SEC-006 residual hardening: only fetch recordings from explicitly allowed
# hosts (Twilio media). Comma-separated env override; default = Twilio only.
# Suffix match (`.twilio.com` matches `api.twilio.com` and `media.twilio.com`).
DEFAULT_ALLOWED_HOSTS = ".twilio.com,api.twilio.com,api.twiliocdn.com,media.twiliocdn.com"
RECORDING_ALLOWED_HOSTS = tuple(
    h.strip().lower()
    for h in os.environ.get("RECORDING_ALLOWED_HOSTS", DEFAULT_ALLOWED_HOSTS).split(",")
    if h.strip()
)


def _is_recording_url_safe(url: str) -> tuple[bool, str]:
    """
    Validate a caller-supplied recording URL before fetch:
    - HTTPS only.
    - Hostname must match RECORDING_ALLOWED_HOSTS (suffix match for
      entries starting with '.', exact match otherwise).
    - All resolved IPs must be public (no loopback, link-local, private,
      multicast, reserved). Defends against DNS rebinding to internal
      services like 169.254.169.254 (cloud metadata).

    Returns (ok, reason). When ok=False, callers must refuse the URL.
    """
    try:
        parsed = urlparse(url)
    except Exception as exc:
        return False, f"invalid url: {exc}"

    if parsed.scheme != "https":
        return False, f"scheme must be https, got {parsed.scheme!r}"
    host = (parsed.hostname or "").lower()
    if not host:
        return False, "url has no hostname"

    matched = False
    for allowed in RECORDING_ALLOWED_HOSTS:
        if allowed.startswith("."):
            if host.endswith(allowed) or host == allowed.lstrip("."):
                matched = True
                break
        elif host == allowed:
            matched = True
            break
    if not matched:
        return False, f"host {host!r} not in RECORDING_ALLOWED_HOSTS"

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        return False, f"dns resolution failed: {exc}"

    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            return False, f"invalid ip {addr!r}"
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return False, f"resolved ip {addr} is non-public"
    return True, "ok"


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


# Hard cap on a single recording download. Twilio recordings are rarely
# larger than ~50MB for a 1-hour call at 64kbps mono. 500MB is a generous
# upper bound that still stops OOM attacks (a malicious webhook could
# point at a 50GB endpoint and kill the worker).
MAX_RECORDING_BYTES = 500 * 1024 * 1024
DOWNLOAD_TIMEOUT_SECONDS = 120.0


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

    # SEC-006 residual: refuse caller-supplied URLs that aren't Twilio media
    # over HTTPS resolving to public IPs. This is the last line before httpx
    # follows redirects, so an attacker passing recordingUrl=
    # "https://attacker.com/redirect-to-169.254.169.254" is blocked here.
    safe, reason = _is_recording_url_safe(url)
    if not safe:
        logger.error("Refusing recording download: %s (url=%s)", reason, url)
        return b""

    try:
        auth = None
        if settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN:
            auth = (settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)

        # STREAM the body so we can bail out on oversized downloads without
        # buffering them in memory first.
        async with httpx.AsyncClient(timeout=DOWNLOAD_TIMEOUT_SECONDS) as client:
            async with client.stream("GET", url, auth=auth, follow_redirects=True) as resp:
                resp.raise_for_status()
                declared = resp.headers.get("content-length")
                if declared and int(declared) > MAX_RECORDING_BYTES:
                    logger.error(
                        "Recording too large (declared %s bytes > cap %s) — refusing",
                        declared, MAX_RECORDING_BYTES,
                    )
                    return b""
                chunks: list[bytes] = []
                total = 0
                async for chunk in resp.aiter_bytes():
                    total += len(chunk)
                    if total > MAX_RECORDING_BYTES:
                        logger.error(
                            "Recording exceeded cap during streaming (>%s bytes) — refusing",
                            MAX_RECORDING_BYTES,
                        )
                        return b""
                    chunks.append(chunk)
                logger.info("Downloaded recording %d bytes", total)
                return b"".join(chunks)
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
