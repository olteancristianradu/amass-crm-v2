"""
PII redaction wrapper.

Real path  : presidio-analyzer + presidio-anonymizer installed + spaCy models downloaded.
             Uncomment the presidio block below.
Stub path  : Simple regex-based redaction of obvious PII patterns (phone, email, CNP).
             Good enough for dev; real Presidio is required for production GDPR compliance.
"""
from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

# Patterns for the regex stub (Romanian + generic)
_PATTERNS = [
    (re.compile(r'\b\d{13}\b'), '[CNP_REDACTAT]'),           # Romanian CNP
    (re.compile(r'\b[A-Z]{2}\d{6}\b'), '[CI_REDACTAT]'),     # Romanian ID card
    (re.compile(r'\b(\+?4?0[\s\-]?)?[0-9]{9,10}\b'), '[TEL_REDACTAT]'),  # phone
    (re.compile(r'\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b', re.I), '[EMAIL_REDACTAT]'),  # email
    (re.compile(r'\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b'), '[CARD_REDACTAT]'),  # card number
]


def redact(text: str) -> str:
    """
    Return a copy of `text` with PII replaced by [REDACTED] tokens.

    Upgrade path: install presidio-analyzer + presidio-anonymizer + spaCy models,
    then swap to the real implementation below.
    """
    # ── Real Presidio path ───────────────────────────────────────────────────
    # try:
    #     from presidio_analyzer import AnalyzerEngine
    #     from presidio_anonymizer import AnonymizerEngine
    #
    #     analyzer = AnalyzerEngine()
    #     anonymizer = AnonymizerEngine()
    #
    #     results = analyzer.analyze(text=text, language="en")
    #     return anonymizer.anonymize(text=text, analyzer_results=results).text
    # except ImportError:
    #     pass  # fall through to regex stub
    # except Exception as exc:
    #     logger.error("Presidio redaction failed: %s", exc)
    # ────────────────────────────────────────────────────────────────────────

    logger.info("Using regex PII stub (presidio not installed)")
    redacted = text
    for pattern, replacement in _PATTERNS:
        redacted = pattern.sub(replacement, redacted)
    return redacted
