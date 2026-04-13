"""
Claude-powered transcript summarisation.

Uses claude-sonnet-4-6 via the Anthropic SDK. If ANTHROPIC_API_KEY is not set,
returns stub data so the pipeline still completes in dev.
"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-6"

_SYSTEM_PROMPT = """You are a CRM assistant that analyses sales call transcripts.
Given a transcript, extract:
1. A brief summary (2-3 sentences, in the language of the transcript).
2. Action items (list of strings — tasks that must be done after the call).
3. Sentiment (one of: positive, neutral, negative).
4. Topics (list of key topics discussed).

Respond ONLY with a JSON object (no markdown fences, no extra text):
{
  "summary": "...",
  "actionItems": ["...", "..."],
  "sentiment": "positive|neutral|negative",
  "topics": ["...", "..."]
}"""


def summarise(transcript_text: str) -> dict[str, Any]:
    """
    Summarise a call transcript using Claude.
    Returns a dict with: summary, actionItems, sentiment, topics, model.
    On any failure returns stub data so the pipeline doesn't break.
    """
    from .config import settings

    if not settings.ANTHROPIC_API_KEY:
        logger.info("ANTHROPIC_API_KEY not set — returning stub summary")
        return _stub_summary()

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

        message = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=_SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": f"Transcript:\n\n{transcript_text}",
                }
            ],
        )

        raw = message.content[0].text.strip()
        data = json.loads(raw)

        return {
            "summary": data.get("summary", ""),
            "actionItems": data.get("actionItems", []),
            "sentiment": data.get("sentiment", "neutral"),
            "topics": data.get("topics", []),
            "model": MODEL,
        }

    except json.JSONDecodeError as exc:
        logger.error("Claude returned non-JSON: %s", exc)
        return _stub_summary()
    except Exception as exc:
        logger.error("Claude summarisation failed: %s", exc)
        return _stub_summary()


def _stub_summary() -> dict[str, Any]:
    return {
        "summary": "[Rezumatul automat nu este disponibil. Configurați ANTHROPIC_API_KEY.]",
        "actionItems": [],
        "sentiment": "neutral",
        "topics": [],
        "model": None,
    }
