-- Phase 1.1 HIGH-1 (T-MAIL-S-02) — open-pixel + click HMAC replay dedup.
--
-- Problem:
--   The HMAC-signed open pixel URL is included verbatim in the recipient's
--   inbox. Some mail clients (Outlook prefetch, Gmail proxy, Apple Mail
--   privacy protection) hit the URL MULTIPLE times — once at delivery, then
--   again at user open, then again on every "show external content" click.
--   Pre-fix, each hit wrote a fresh EmailTrack row -> inflated open/click
--   counters by 2-5x and made engagement reporting useless.
--
-- Solution:
--   Partial unique index on (message_id, kind, ip_address, hourBucket).
--   Hour-resolution bucket is the right grain: legit "two opens 30s apart
--   from the same client" still count as one (correct - same recipient,
--   same view session). A second open the next hour gets its own row
--   (correct - recipient came back).
--
--   The application layer wraps inserts in try/catch on P2002 -> silently
--   no-ops on dup (returns success so the pixel response stays
--   indistinguishable from a real hit; service docstring covers why).
--
-- Why partial:
--   - Filtered to kind IN ('OPEN','CLICK') because BOUNCE/UNSUBSCRIBE/
--     SPAM_REPORT semantically MUST allow multiple rows (different events
--     of the same kind are legitimate).
--   - Filtered to ip_address IS NOT NULL so we don't accidentally collapse
--     unrelated rows when an upstream proxy stripped the IP.
--
-- Why date_trunc('hour'):
--   - IMMUTABLE-equivalent for TIMESTAMP. Indexable in Postgres. The
--     expression is evaluated at row insert and during index lookup; both
--     give the same answer for the same created_at value, so the unique
--     constraint stays well-defined.
--
-- Idempotent: IF NOT EXISTS guards the index creation.

CREATE UNIQUE INDEX IF NOT EXISTS "email_tracks_open_click_dedup_idx"
  ON "email_tracks" ("message_id", "kind", "ip_address", (date_trunc('hour', "created_at")))
  WHERE "kind" IN ('OPEN', 'CLICK') AND "ip_address" IS NOT NULL AND "message_id" IS NOT NULL;
