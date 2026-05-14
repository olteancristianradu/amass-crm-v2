"""
Audio transcription wrapper.

Real path  : WHISPER_MODEL != "off" AND openai-whisper imported successfully.
Stub path  : WHISPER_MODEL == "off" OR the whisper import failed at module load.
             Returns a single placeholder segment so the rest of the pipeline still
             runs and saves a transcript row.
"""
from __future__ import annotations

import logging
import tempfile
from typing import Any

logger = logging.getLogger(__name__)


# Try to import openai-whisper at module load. If it works, the real path is
# available. If not (image built without the heavy ML deps), fall back to stub
# regardless of WHISPER_MODEL.
try:
    import whisper  # type: ignore

    _WHISPER_AVAILABLE = True
    logger.info("openai-whisper imported OK — real transcription path available")
except Exception as exc:  # pragma: no cover — depends on image build
    whisper = None  # type: ignore
    _WHISPER_AVAILABLE = False
    logger.warning("openai-whisper not importable (%s) — stub path forced", exc)


# Cache the loaded model so we don't reload weights on every job.
_model_cache: dict[str, Any] = {}


def _get_model(model_name: str):
    if model_name in _model_cache:
        return _model_cache[model_name]
    logger.info("Loading Whisper model %r (first call — may download weights)", model_name)
    model = whisper.load_model(model_name)  # type: ignore[union-attr]
    _model_cache[model_name] = model
    return model


def transcribe(audio_bytes: bytes, language: str | None = None) -> dict[str, Any]:
    """
    Transcribe audio bytes. Returns a dict with:
      language  : str | None   — detected or forced language
      rawText   : str          — full concatenated transcript
      segments  : list[dict]   — [{start, end, speaker, text}, ...]
    """
    from .config import settings

    if settings.WHISPER_MODEL == "off" or not _WHISPER_AVAILABLE:
        return _stub_transcription()

    try:
        model = _get_model(settings.WHISPER_MODEL)

        # whisper.transcribe needs a file path; write bytes to a temp file.
        # Suffix doesn't matter for whisper (ffmpeg sniffs the format).
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio_bytes)
            tmp_path = f.name

        result = model.transcribe(
            tmp_path,
            language=language,
            word_timestamps=False,
            fp16=False,  # CPU container — fp16 is GPU-only
        )
        segments = [
            {
                "start": float(s["start"]),
                "end": float(s["end"]),
                "speaker": None,
                "text": s["text"].strip(),
            }
            for s in result.get("segments", [])
        ]
        return {
            "language": result.get("language"),
            "rawText": result.get("text", "").strip(),
            "segments": segments,
        }
    except Exception as exc:
        logger.error("Whisper transcription failed: %s", exc, exc_info=True)
        return _stub_transcription()


def _stub_transcription() -> dict[str, Any]:
    """Placeholder used in dev / when Whisper is disabled or unavailable."""
    logger.info("Using stub transcription (WHISPER_MODEL=off or whisper unavailable)")
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
