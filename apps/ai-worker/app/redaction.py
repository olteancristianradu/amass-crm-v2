"""
PII redaction wrapper.

Real path  : presidio-analyzer + presidio-anonymizer installed + spaCy models
             ro_core_news_sm + en_core_web_sm downloaded (see Dockerfile).
Stub path  : Simple regex-based redaction of obvious PII patterns (CNP/phone/email).
             Used only if Presidio import or NLP engine init fails. Good enough
             for dev; production GDPR compliance requires the real Presidio path.

Public API: `redact(text, language="ro") -> str`.
The 2nd arg defaults to "ro" because the CRM is RO-first; callers can pass
"en" for English transcripts. Falls back silently to regex stub if Presidio
is not available — never blocks the pipeline.
"""
from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

# Patterns for the regex stub (Romanian + generic). Used only when Presidio
# is unavailable.
_PATTERNS = [
    (re.compile(r'\b\d{13}\b'), '[CNP_REDACTAT]'),           # Romanian CNP
    (re.compile(r'\b[A-Z]{2}\d{6}\b'), '[CI_REDACTAT]'),     # Romanian ID card
    (re.compile(r'\b(\+?4?0[\s\-]?)?[0-9]{9,10}\b'), '[TEL_REDACTAT]'),  # phone
    (re.compile(r'\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b', re.I), '[EMAIL_REDACTAT]'),  # email
    (re.compile(r'\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b'), '[CARD_REDACTAT]'),  # card
]

# Entities we ask Presidio to detect. The mix is chosen for Romanian B2B call
# transcripts: names, contact details, financial identifiers, addresses.
_ENTITIES = [
    "PERSON",
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "IBAN_CODE",
    "CREDIT_CARD",
    "LOCATION",
    "DATE_TIME",
]

# Try to wire Presidio at import time. Single global Analyzer+Anonymizer
# (thread-safe per Presidio docs). If anything goes wrong — missing package,
# missing spaCy model, bad config — we log once and flip PRESIDIO_READY=False
# so `redact()` falls back to the regex stub. Never raise at import: the
# worker must boot even with degraded redaction.
PRESIDIO_READY = False
_analyzer = None
_anonymizer = None
_operators = None

try:
    from presidio_analyzer import AnalyzerEngine
    from presidio_analyzer.nlp_engine import NlpEngineProvider
    from presidio_anonymizer import AnonymizerEngine
    from presidio_anonymizer.entities import OperatorConfig

    _nlp_config = {
        "nlp_engine_name": "spacy",
        "models": [
            {"lang_code": "ro", "model_name": "ro_core_news_sm"},
            {"lang_code": "en", "model_name": "en_core_web_sm"},
        ],
    }
    _nlp_engine = NlpEngineProvider(nlp_configuration=_nlp_config).create_engine()
    _analyzer = AnalyzerEngine(
        nlp_engine=_nlp_engine,
        supported_languages=["ro", "en"],
    )
    _anonymizer = AnonymizerEngine()
    _operators = {
        "DEFAULT": OperatorConfig("replace", {"new_value": "[REDACTED]"}),
    }
    PRESIDIO_READY = True
    logger.info("Presidio PII redaction initialised (RO + EN)")
except Exception as exc:  # noqa: BLE001 — never block worker boot
    logger.warning(
        "Presidio init failed, falling back to regex stub: %s",
        exc,
    )
    PRESIDIO_READY = False


def _regex_stub_redact(text: str) -> str:
    """Fallback when Presidio is unavailable. Romanian + generic patterns."""
    redacted = text
    for pattern, replacement in _PATTERNS:
        redacted = pattern.sub(replacement, redacted)
    return redacted


def redact(text: str, language: str = "ro") -> str:
    """
    Return a copy of `text` with PII replaced by `[REDACTED]` tokens.

    Uses Presidio (spaCy NER + recognizers) when available. Falls back to a
    simple regex stub if Presidio init failed at import — the pipeline must
    never break on PII redaction failure.
    """
    if not text:
        return text

    if not PRESIDIO_READY or _analyzer is None or _anonymizer is None:
        return _regex_stub_redact(text)

    try:
        results = _analyzer.analyze(
            text=text,
            language=language,
            entities=_ENTITIES,
        )
        anonymized = _anonymizer.anonymize(
            text=text,
            analyzer_results=results,
            operators=_operators,
        )
        # Presidio has no built-in Romanian CNP / CI card recognizer, so the
        # 13-digit personal numeric code and 2-letter+6-digit ID slip through.
        # Belt-and-suspenders: run the regex stub patterns on the Presidio
        # output to catch RO-specific identifiers it doesn't know about.
        return _regex_stub_redact(anonymized.text)
    except Exception as exc:  # noqa: BLE001
        # Don't let a single bad transcript poison the queue: degrade to regex.
        logger.error("Presidio redaction failed (%s); using regex stub", exc)
        return _regex_stub_redact(text)
