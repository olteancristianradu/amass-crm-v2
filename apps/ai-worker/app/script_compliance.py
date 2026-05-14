"""
Script-compliance evaluation.

Given a call transcript + a list of "script points" (things the agent should
have said/asked during the call), use Claude to score how many were covered
and which were missed.

Real path : ANTHROPIC_API_KEY is set → call Claude `claude-sonnet-4-6` with a
            structured JSON-output prompt and parse the result.
Stub path : no key → return None so the pipeline writes NULL on the call (the
            UI then hides the score widget instead of showing a fake number).

Output shape:
    {
        "score": int (0-100),
        "missed": list[str]  # subset of script_points
    }
or None when transcription text is too short / no key available.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from .config import settings

logger = logging.getLogger(__name__)


MAX_TRANSCRIPT_CHARS = 12000  # ~3000 tokens. Trim very long calls.

EVAL_PROMPT_TEMPLATE = """Evaluează cât de bine acoperă agentul de vânzări/suport din transcriptul de mai jos punctele de script așteptate.

<script_points>
{points}
</script_points>

<transcript>
{transcript}
</transcript>

Reguli:
- Pentru fiecare punct din `script_points`, decide dacă a fost ACOPERIT (agentul a abordat clar subiectul) sau RATAT.
- Scorul = `100 * (puncte acoperite / total puncte)`, rotunjit la întreg.
- Returnează STRICT JSON (fără text adițional, fără markdown) cu această schemă:
  {{"score": <0-100 int>, "missed": ["punct ratat 1", "punct ratat 2", ...]}}
- `missed` trebuie să fie un SUBSET strict al `script_points` (folosește exact aceleași șiruri).
- Dacă transcriptul e gol sau incoerent, întoarce {{"score": 0, "missed": <toate punctele>}}.
"""


def evaluate_script(
    transcript_text: str,
    script_points: list[str],
) -> dict[str, Any] | None:
    """
    Returns {"score": int, "missed": list[str]} or None if evaluation can't run.
    """
    if not script_points or not isinstance(script_points, list):
        return None
    points = [p.strip() for p in script_points if isinstance(p, str) and p.strip()]
    if not points:
        return None
    if not transcript_text or len(transcript_text.strip()) < 20:
        return {"score": 0, "missed": points}

    if not settings.ANTHROPIC_API_KEY:
        logger.info("ANTHROPIC_API_KEY not set — skipping script-compliance evaluation")
        return None

    try:
        import anthropic
    except ImportError:
        logger.warning("anthropic package not installed — skipping script-compliance")
        return None

    transcript = transcript_text[:MAX_TRANSCRIPT_CHARS]
    points_list = "\n".join(f"- {p}" for p in points)
    prompt = EVAL_PROMPT_TEMPLATE.format(points=points_list, transcript=transcript)

    try:
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = "".join(block.text for block in msg.content if block.type == "text").strip()
    except Exception as exc:
        logger.error("Anthropic call failed for script-compliance: %s", exc)
        return None

    # Pull the first {...} block out — Claude usually outputs clean JSON but
    # we strip any stray markdown fences defensively.
    json_match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not json_match:
        logger.error("Script-compliance response had no JSON object: %s", raw[:200])
        return None

    try:
        parsed = json.loads(json_match.group(0))
    except json.JSONDecodeError as exc:
        logger.error("Script-compliance JSON decode failed: %s | raw=%s", exc, raw[:200])
        return None

    score = parsed.get("score")
    missed = parsed.get("missed")
    if not isinstance(score, int) or not (0 <= score <= 100):
        return None
    if not isinstance(missed, list):
        missed = []
    # Hard-filter `missed` to only contain entries from the input list — Claude
    # occasionally paraphrases; that breaks downstream display logic and the
    # acceptance test that asserts the audit log stays anchored to the input.
    point_set = set(points)
    missed = [m for m in missed if isinstance(m, str) and m in point_set]
    return {"score": score, "missed": missed}
