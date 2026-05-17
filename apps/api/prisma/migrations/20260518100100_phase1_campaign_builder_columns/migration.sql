-- Phase 1 A.2 — Campaign columns for drag-drop builder + counters + scheduler.
-- Depends on enum values added in 20260518100000_phase1_campaign_builder_enums.
--
-- All columns are NULLABLE (or have DEFAULT) so existing 'campaigns' rows
-- remain valid post-migration without backfill. CHECK constraint below
-- guarantees the EMAIL channel can't transition out of DRAFT/PAUSED/CANCELLED
-- without subject + fromAddress + templateHtml — pushes invariant into the DB,
-- not just the service layer.

-- Block A.2.1 — sender / template addressing fields
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "subject"        VARCHAR(998),
  ADD COLUMN IF NOT EXISTS "from_name"      VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "from_address"   VARCHAR(320),
  ADD COLUMN IF NOT EXISTS "reply_to"       VARCHAR(320),
  ADD COLUMN IF NOT EXISTS "preview_text"   VARCHAR(255);

-- Block A.2.2 — template body (JSON block tree + rendered HTML/text caches)
-- template_html capped at 1 MiB matches EmailMessage.bodyHtml ceiling.
-- template_text 256 KiB matches typical plain-text fallback.
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "template_json"  JSONB,
  ADD COLUMN IF NOT EXISTS "template_html"  VARCHAR(1048576),
  ADD COLUMN IF NOT EXISTS "template_text"  VARCHAR(262144);

-- Block A.2.3 — scheduling + audience materialization snapshot
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "scheduled_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sent_at"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recipient_filter"  JSONB,
  ADD COLUMN IF NOT EXISTS "recipient_count"   INTEGER NOT NULL DEFAULT 0;

-- Block A.2.4 — engagement counters (aggregated from CampaignRecipient + EmailTrack).
-- These are denormalized for fast list-page reads — the source-of-truth is
-- CampaignRecipient + EmailTrack rows. A nightly job reconciles drift.
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "open_count"          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "unique_open_count"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "click_count"         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "unique_click_count"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "bounce_count"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "unsubscribe_count"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "spam_report_count"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sent_success_count"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sent_failure_count"  INTEGER NOT NULL DEFAULT 0;

-- Partial index for the BullMQ scheduler hot path: workers poll
-- "give me EMAIL campaigns due in the next N seconds". Partial index keeps
-- size ~= O(scheduled campaigns), not O(all campaigns). Worker query:
--   SELECT id FROM campaigns
--   WHERE status='SCHEDULED' AND scheduled_at <= now() AND tenant_id=...
--   ORDER BY scheduled_at LIMIT 50;
CREATE INDEX IF NOT EXISTS "campaigns_scheduler_pending_idx"
  ON "campaigns" ("tenant_id", "scheduled_at")
  WHERE "status" = 'SCHEDULED';

-- CHECK: an EMAIL campaign that is NOT in DRAFT/PAUSED/CANCELLED must have
-- subject + from_address + template_html populated. Pushes the invariant into
-- the DB so a bug in the service can't ship half-baked sends.
-- Non-EMAIL channels (SMS, WHATSAPP, MIXED) are exempt — they have their own
-- required fields enforced at the service layer.
ALTER TABLE "campaigns" DROP CONSTRAINT IF EXISTS "campaigns_email_ready_chk";
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_email_ready_chk" CHECK (
  "channel" <> 'EMAIL'
  OR "status" IN ('DRAFT', 'PAUSED', 'CANCELLED')
  OR (
    "subject"       IS NOT NULL AND length("subject")       > 0
    AND "from_address" IS NOT NULL AND length("from_address") > 0
    AND "template_html" IS NOT NULL AND length("template_html") > 0
  )
);
