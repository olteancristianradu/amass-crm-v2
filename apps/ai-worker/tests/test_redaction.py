"""
Unit tests for app.redaction.

Goal: pin the contract that the AI worker actually redacts the patterns we
document as PII in docs/DATA_CLASSIFICATION.md. These tests run inside the
Docker image where Presidio + spaCy ro_core_news_sm + en_core_web_sm are
installed (see apps/ai-worker/Dockerfile). When the Presidio path is
unavailable (local dev without the heavy NER deps), the Presidio-only tests
are skipped with a clear reason — the regex-stub coverage still runs.

Pytest discovery: `pytest apps/ai-worker/tests/test_redaction.py -v` from
the repo root, or `pytest tests/test_redaction.py` from apps/ai-worker.
"""
from __future__ import annotations

import os
import sys

import pytest

# Make `app` importable when tests are run from repo root or from
# apps/ai-worker. Pytest doesn't add the parent of `tests/` to sys.path
# unless there's a conftest — we keep this self-contained.
_HERE = os.path.dirname(os.path.abspath(__file__))
_AI_WORKER_ROOT = os.path.dirname(_HERE)
if _AI_WORKER_ROOT not in sys.path:
    sys.path.insert(0, _AI_WORKER_ROOT)

from app import redaction  # noqa: E402  — path mangling required first


# ── Regex-stub path: always available, runs in every environment ──────────

class TestRegexStubFallback:
    """The regex stub runs unconditionally as belt-and-suspenders on the
    Presidio output AND as the sole redactor when Presidio init fails.
    These tests pin the RO-specific patterns we cannot lose."""

    def test_cnp_redacted(self):
        # Romanian CNP: 13 digits. Pattern in DATA_CLASSIFICATION.md.
        out = redaction._regex_stub_redact("Clientul are CNP 1991201123456 înregistrat")
        assert "1991201123456" not in out
        assert "[CNP_REDACTAT]" in out

    def test_email_redacted_in_stub(self):
        out = redaction._regex_stub_redact("Scrie la test@example.com pentru detalii")
        assert "test@example.com" not in out
        assert "[EMAIL_REDACTAT]" in out

    def test_phone_redacted_in_stub(self):
        # Romanian phone with country prefix.
        out = redaction._regex_stub_redact("Sună la +40712345678 mâine")
        assert "+40712345678" not in out
        assert "[TEL_REDACTAT]" in out

    def test_card_number_redacted_in_stub(self):
        out = redaction._regex_stub_redact("Card 4111 1111 1111 1111 expirat")
        assert "4111 1111 1111 1111" not in out
        assert "[CARD_REDACTAT]" in out

    def test_id_card_redacted_in_stub(self):
        # Romanian CI: 2 letters + 6 digits.
        out = redaction._regex_stub_redact("Seria CI: AB123456 expiră anul viitor")
        assert "AB123456" not in out
        assert "[CI_REDACTAT]" in out

    def test_clean_text_unchanged(self):
        text = "Discutăm despre proiect și termeni comerciali"
        assert redaction._regex_stub_redact(text) == text

    def test_empty_string_unchanged(self):
        assert redaction.redact("") == ""
        assert redaction.redact(None) is None  # type: ignore[arg-type]


# ── Presidio path: only runs when Presidio + spaCy models loaded ──────────

_PRESIDIO_SKIP_REASON = (
    "Presidio path not initialised (PRESIDIO_READY=False). This test "
    "validates the production redaction contract; it runs inside the AI "
    "worker Docker image where presidio-analyzer/anonymizer + spaCy "
    "ro_core_news_sm + en_core_web_sm are installed. Skipping in local "
    "dev environments without these deps. CI Docker job runs them."
)


@pytest.mark.skipif(not redaction.PRESIDIO_READY, reason=_PRESIDIO_SKIP_REASON)
class TestPresidioRedaction:
    """End-to-end through the real Presidio engine. These are the contract
    tests legal/compliance can cite as proof Art. 32 (security of
    processing) is met for the patterns called out in
    docs/DATA_CLASSIFICATION.md."""

    def test_cnp_redacted_via_belt_and_suspenders_regex(self):
        # Presidio has no built-in RO CNP recognizer; redact() runs the
        # regex stub on the Presidio output exactly for this case.
        out = redaction.redact("CNP-ul meu este 1991201123456", language="ro")
        assert "1991201123456" not in out

    def test_iban_redacted(self):
        # IBAN_CODE is a built-in Presidio entity.
        out = redaction.redact(
            "Plata se face în IBAN RO49AAAA1B31007593840000",
            language="ro",
        )
        assert "RO49AAAA1B31007593840000" not in out

    def test_romanian_person_name_redacted(self):
        # PERSON detection via spaCy ro_core_news_sm. We don't pin the
        # exact replacement token shape (Presidio defaults to [REDACTED]
        # via our operator config) — we only assert the name is gone.
        out = redaction.redact("Ion Popescu a sunat azi-dimineață", language="ro")
        assert "Ion Popescu" not in out
        assert "[REDACTED]" in out or "ANONYMIZED" in out.upper()

    def test_email_redacted_via_presidio(self):
        out = redaction.redact("Trimite la test@example.com factura", language="ro")
        assert "test@example.com" not in out

    def test_phone_redacted_via_presidio(self):
        out = redaction.redact("Telefon +40712345678 disponibil", language="ro")
        assert "+40712345678" not in out

    def test_english_text_also_works(self):
        # The pipeline supports en for foreign calls/emails. en_core_web_sm
        # provides PERSON detection.
        out = redaction.redact("John Smith called from +1-555-0100", language="en")
        # At minimum the phone goes; PERSON detection on English text
        # depends on the model — we keep this lenient (one of the two
        # must be redacted to prove the en path is wired).
        assert "John Smith" not in out or "+1-555-0100" not in out

    def test_multiple_pii_in_one_string(self):
        # Compound: email + phone + CNP + name + IBAN. Worst case.
        out = redaction.redact(
            "Ion Popescu, CNP 1991201123456, IBAN RO49AAAA1B31007593840000, "
            "telefon +40712345678, email ion.popescu@example.ro",
            language="ro",
        )
        assert "1991201123456" not in out
        assert "RO49AAAA1B31007593840000" not in out
        assert "+40712345678" not in out
        assert "ion.popescu@example.ro" not in out
        assert "Ion Popescu" not in out

    def test_redact_never_raises_on_garbage_input(self):
        # The pipeline must NEVER block on a bad transcript — even if
        # Presidio errors internally, the regex stub catches.
        # We pass an absurd string and assert we got SOMETHING back.
        out = redaction.redact("\x00\x01" * 100 + "1991201123456", language="ro")
        assert "1991201123456" not in out
