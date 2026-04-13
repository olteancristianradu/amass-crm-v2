"""
Audio transcription wrapper.

Real path  : WHISPER_MODEL != "off" and openai-whisper is installed.
             Uncomment the whisper import block and set WHISPER_MODEL=base (or medium/large).
Stub path  : WHISPER_MODEL == "off" (default in dev). Returns a single placeholder segment
             so the rest of the pipeline still runs and saves a transcript row.
"""
from __future__ import annotations

import io
import logging
from typing import Any

logger = logging.getLogger(__name__)


def transcribe(audio_bytes: bytes, language: str | None = None) -> dict[str, Any]:
    """
    Transcribe audio bytes. Returns a dict with:
      language  : str | None   — detected or forced language
      rawText   : str          — full concatenated transcript
      segments  : list[dict]   — [{start, end, speaker, text}, ...]
    """
    from .config import settings

    if settings.WHISPER_MODEL == "off":
        return _stub_transcription()

    # ── Real Whisper path ────────────────────────────────────────────────────
    # Uncomment when openai-whisper is installed and WHISPER_MODEL is set.
    #
    # try:
    #     import whisper
    #     import tempfile, soundfile as sf
    #
    #     model = whisper.load_model(settings.WHISPER_MODEL)
    #
    #     # whisper needs a file path; write bytes to a temp file
    #     with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
    #         f.write(audio_bytes)
    #         tmp_path = f.name
    #
    #     result = model.transcribe(
    #         tmp_path,
    #         language=language,
    #         word_timestamps=False,
    #     )
    #     segments = [
    #         {"start": s["start"], "end": s["end"], "speaker": None, "text": s["text"].strip()}
    #         for s in result["segments"]
    #     ]
    #     return {
    #         "language": result.get("language"),
    #         "rawText": result.get("text", "").strip(),
    #         "segments": segments,
    #     }
    # except Exception as exc:
    #     logger.error("Whisper transcription failed: %s", exc)
    #     return _stub_transcription()
    # ────────────────────────────────────────────────────────────────────────

    return _stub_transcription()


def _stub_transcription() -> dict[str, Any]:
    """Placeholder used in dev / when Whisper is disabled."""
    logger.info("Using stub transcription (WHISPER_MODEL=off)")
    return {
        "language": None,
        "rawText": "[Transcrierea audio nu este activată. Setați WHISPER_MODEL=base pentru transcriere reală.]",
        "segments": [
            {
                "start": 0.0,
                "end": 1.0,
                "speaker": None,
                "text": "[stub transcript]",
            }
        ],
    }
