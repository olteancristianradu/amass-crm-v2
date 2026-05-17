-- Phase 1 C.2 — EmailTrack columns to support per-recipient attribution +
-- bounce diagnostics + GDPR-style PII anonymization clock.
-- Depends on enum values from 20260518120000.

-- C.2.1 — make message_id NULLABLE: a deliverability event (BOUNCE, SPAM_REPORT)
-- can arrive from a provider webhook before we've matched it back to an
-- EmailMessage row, or can be attributed solely to a CampaignRecipient (the
-- per-recipient send) without a 1:1 EmailMessage. Existing OPEN/CLICK rows
-- keep their message_id values — the DROP NOT NULL is a relaxation.
ALTER TABLE "email_tracks" ALTER COLUMN "message_id" DROP NOT NULL;

-- C.2.2 — new columns
ALTER TABLE "email_tracks"
  -- recipient_id: optional FK to the CampaignRecipient row that owns this
  -- event. Set when the event was captured via per-recipient HMAC token
  -- (so we know which recipient inside a campaign opened/clicked/bounced).
  ADD COLUMN IF NOT EXISTS "recipient_id"    TEXT,
  -- bounce_type: SMTP/provider classification ('hard', 'soft', 'block',
  -- 'spam', etc.). Free-form string capped at 32 chars — the set varies
  -- per provider, we don't lock it into an enum.
  ADD COLUMN IF NOT EXISTS "bounce_type"     VARCHAR(32),
  -- bounce_code: provider-specific code (SMTP 5xx code, Mailgun event code,
  -- etc.) for deeper debugging.
  ADD COLUMN IF NOT EXISTS "bounce_code"     VARCHAR(64),
  -- pii_hashed_at: timestamp when the daily anonymization job zeroed out
  -- ip_address + user_agent on this row. NULL = still has raw PII; non-NULL
  -- = anonymized. Drives the GDPR purge cron's "where pii_hashed_at IS NULL
  -- AND created_at < now() - 90 days" hot path.
  ADD COLUMN IF NOT EXISTS "pii_hashed_at"   TIMESTAMP(3);

-- C.2.3 — FK to campaign_recipients. ON DELETE SET NULL so deleting a
-- recipient row (rare — only happens on tenant teardown) doesn't cascade
-- and lose the event history.
ALTER TABLE "email_tracks"
  ADD CONSTRAINT "email_tracks_recipient_id_fkey"
  FOREIGN KEY ("recipient_id") REFERENCES "campaign_recipients"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- C.2.4 — CHECK: every row must be attributable to EITHER an EmailMessage
-- OR a CampaignRecipient (or both). A row with neither is orphaned data.
ALTER TABLE "email_tracks" DROP CONSTRAINT IF EXISTS "email_tracks_attribution_chk";
ALTER TABLE "email_tracks" ADD CONSTRAINT "email_tracks_attribution_chk" CHECK (
  "message_id" IS NOT NULL OR "recipient_id" IS NOT NULL
);

-- C.2.5 — indexes for the new access patterns:

-- 1. Per-recipient timeline lookup: "show me all opens/clicks for recipient X".
CREATE INDEX IF NOT EXISTS "email_tracks_tenant_recipient_created_idx"
  ON "email_tracks" ("tenant_id", "recipient_id", "created_at" DESC)
  WHERE "recipient_id" IS NOT NULL;

-- 2. Daily aggregations per tenant + kind (existing index covers a similar
--    pattern but doesn't filter on "active" rows). New PARTIAL index:
--    deliverability dashboards filter on BOUNCE/SPAM_REPORT/UNSUBSCRIBE only.
CREATE INDEX IF NOT EXISTS "email_tracks_deliverability_idx"
  ON "email_tracks" ("tenant_id", "kind", "created_at" DESC)
  WHERE "kind" IN ('BOUNCE', 'SPAM_REPORT', 'UNSUBSCRIBE');

-- 3. GDPR anonymization scan: nightly cron picks rows older than 90 days
--    that haven't been anonymized yet. Partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS "email_tracks_pii_pending_idx"
  ON "email_tracks" ("created_at")
  WHERE "pii_hashed_at" IS NULL AND ("ip_address" IS NOT NULL OR "user_agent" IS NOT NULL);
