-- Phase 1 B — CampaignRecipient: per-recipient send attribution + tracking.
-- Closes the gap noted in schema.prisma:810-814 (EmailTrack stores opens/clicks
-- by messageId, but campaign-level analytics need per-RECIPIENT attribution
-- including bounce/unsubscribe state, which EmailTrack cannot encode without
-- duplicate EmailMessage rows per recipient).
--
-- BLOCKER 1 satisfied: introduces SubjectTypeExt (COMPANY/CONTACT/CLIENT/LEAD)
-- as a SEPARATE enum from global SubjectType. We deliberately do NOT extend
-- the global enum because Notes/Attachments/Activities use that and adding
-- LEAD there is a separate scope-creep change that needs its own migration.

-- New enum: per-recipient send lifecycle
CREATE TYPE "CampaignRecipientStatus" AS ENUM (
  'PENDING',    -- audience materialized but worker hasn't picked up yet
  'QUEUED',     -- enqueued to BullMQ email-send queue
  'SENT',       -- SMTP relay accepted the message
  'DELIVERED',  -- inbox provider reported successful delivery (via webhook)
  'BOUNCED',    -- hard bounce or repeated soft bounce
  'FAILED',     -- send-time error (template render, suppression, etc.)
  'SKIPPED'     -- suppressed by EmailSuppression list pre-send
);

-- New enum: polymorphic subject types for campaign audience.
-- Parallel to global SubjectType (COMPANY/CONTACT/CLIENT) but ALSO supports
-- LEAD which is a Phase 1 campaign audience type. Keep names ASCII-uppercase
-- to match the convention used by SubjectType.
CREATE TYPE "SubjectTypeExt" AS ENUM (
  'COMPANY',
  'CONTACT',
  'CLIENT',
  'LEAD'
);

CREATE TABLE "campaign_recipients" (
  "id"               TEXT NOT NULL,
  "tenant_id"        TEXT NOT NULL,
  "campaign_id"      TEXT NOT NULL,
  "subject_type"     "SubjectTypeExt" NOT NULL,
  "subject_id"       TEXT NOT NULL,
  -- VARCHAR(320) = RFC 5321 max email length (64 local + 1 @ + 255 domain).
  -- We store the email at the time of audience materialization — if the
  -- contact's email changes later, this row preserves the historical send.
  "email"            VARCHAR(320) NOT NULL,
  -- trackingToken: per-recipient HMAC of (campaign_id || subject_id || tenant_id)
  -- used to attribute opens/clicks back to THIS recipient without leaking the
  -- contact email in the tracking URL. App layer computes; DB stores opaque.
  -- 64-char hex = 256-bit token, large enough to be unguessable.
  "tracking_token"   VARCHAR(64) NOT NULL,
  "status"           "CampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
  -- Lifecycle timestamps for funnel reporting
  "queued_at"        TIMESTAMP(3),
  "sent_at"          TIMESTAMP(3),
  "delivered_at"     TIMESTAMP(3),
  "bounced_at"       TIMESTAMP(3),
  "failed_at"        TIMESTAMP(3),
  -- Per-recipient engagement counters (denormalized from EmailTrack rows).
  -- Updated by the open/click write path with a conditional UPDATE.
  "open_count"       INTEGER NOT NULL DEFAULT 0,
  "click_count"      INTEGER NOT NULL DEFAULT 0,
  "last_open_at"     TIMESTAMP(3),
  "last_click_at"    TIMESTAMP(3),
  -- Diagnostic on failure paths
  "error_code"       VARCHAR(64),
  "error_message"    VARCHAR(2048),
  -- Optional FK to the resulting EmailMessage row (NULL until SENT).
  "message_id"       TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- Unique (campaign_id, subject_type, subject_id): the same contact cannot be
-- materialized twice for the same campaign. Prevents accidental dup sends if
-- the audience-resolution job retries after partial failure.
CREATE UNIQUE INDEX "campaign_recipients_campaign_subject_uniq"
  ON "campaign_recipients" ("campaign_id", "subject_type", "subject_id");

-- Unique tracking_token across the table — pixel/click endpoints look up
-- recipients by this token alone (it includes tenant_id in its HMAC input,
-- so we don't need a composite lookup).
CREATE UNIQUE INDEX "campaign_recipients_tracking_token_uniq"
  ON "campaign_recipients" ("tracking_token");

-- Worker batch read: pick the next N PENDING/QUEUED rows for a campaign in
-- a tenant. (tenant_id, campaign_id, status) is the canonical access pattern.
CREATE INDEX "campaign_recipients_tenant_campaign_status_idx"
  ON "campaign_recipients" ("tenant_id", "campaign_id", "status");

-- Timeline lookup on a Contact/Lead detail page: "which campaigns has this
-- recipient been targeted by?" — (tenant_id, subject_type, subject_id).
CREATE INDEX "campaign_recipients_tenant_subject_idx"
  ON "campaign_recipients" ("tenant_id", "subject_type", "subject_id");

-- Pre-send suppression check: hot path is "is this email on the suppression
-- list?". The lookup hits email_suppressions; this index supports the
-- inverse "which campaigns have we attempted for this email?" question
-- used by deliverability reporting.
CREATE INDEX "campaign_recipients_tenant_email_idx"
  ON "campaign_recipients" ("tenant_id", "email");

-- FK to campaigns — CASCADE so deleting a campaign cleans up its recipients.
ALTER TABLE "campaign_recipients"
  ADD CONSTRAINT "campaign_recipients_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- FK to tenants — CASCADE matches the rest of the schema's tenant-scope policy.
ALTER TABLE "campaign_recipients"
  ADD CONSTRAINT "campaign_recipients_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- FK to email_messages — SET NULL because EmailMessage may be archived/deleted
-- by retention jobs before the recipient row.
ALTER TABLE "campaign_recipients"
  ADD CONSTRAINT "campaign_recipients_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "email_messages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS — canonical pattern from scim_tokens (current_tenant_id() returns the
-- '__amass_missing_tenant_context__' sentinel when ALS is not set, so app_user
-- fails closed if a path forgets runWithTenant).
ALTER TABLE "campaign_recipients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_recipients" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_campaign_recipients ON "campaign_recipients"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "campaign_recipients" TO app_user;
