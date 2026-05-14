"""
MinIO upload helper for call recordings.

After the AI pipeline downloads a Twilio recording into memory, we push
it to MinIO under a tenant-scoped key. The API later attaches that key
to the Call row and creates an Attachment so the recording appears in
the client's documents tab.
"""
from __future__ import annotations

import asyncio
import io
import logging

from minio import Minio

from .config import settings

logger = logging.getLogger(__name__)


def _client() -> Minio:
    endpoint = settings.MINIO_ENDPOINT.replace("http://", "").replace("https://", "")
    secure = settings.MINIO_ENDPOINT.startswith("https://")
    return Minio(
        endpoint,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=secure,
    )


def _ensure_bucket(client: Minio, bucket: str) -> None:
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)


async def upload_recording(
    *,
    tenant_id: str,
    call_id: str,
    recording_sid: str,
    audio_bytes: bytes,
) -> str:
    """
    Upload mp3 recording to MinIO. Returns the storage key.

    Key format: tenants/{tenantId}/calls/{callId}/{recordingSid}.mp3
    This matches the Attachment.storageKey convention used elsewhere in
    the CRM so the existing presigned-download flow Just Works.
    """
    bucket = settings.MINIO_BUCKET
    key = f"tenants/{tenant_id}/calls/{call_id}/{recording_sid or call_id}.mp3"

    def _do_upload() -> None:
        client = _client()
        _ensure_bucket(client, bucket)
        client.put_object(
            bucket_name=bucket,
            object_name=key,
            data=io.BytesIO(audio_bytes),
            length=len(audio_bytes),
            content_type="audio/mpeg",
        )

    # Run blocking MinIO SDK in a worker thread so we don't stall asyncio.
    await asyncio.to_thread(_do_upload)
    return key
