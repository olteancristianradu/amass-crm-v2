-- Phase 1 D — EmailSuppression: persistent unsubscribe / hard-bounce / spam
-- list, stored as SHA-256 hash of the lowercased email (no plaintext PII).
--
-- GDPR justification:
--   - Art. 17 (right to erasure): once a contact requests deletion, we must
--     forget their email. BUT
--   - CAN-SPAM §5(a)(4) + GDPR Recital 70 (legitimate interest in marketing
--     hygiene): we must NOT re-contact someone who unsubscribed/bounced.
--   These constraints conflict if we store plaintext email. Hashing turns
--   the suppression list into a pseudonymous identifier — we can check
--   "have we suppressed this email?" without storing it. emailMasked
--   ("j****@e****.com") gives admins a non-PII rendering for the UI.

-- New enum: why this email landed on the suppression list. Drives
-- per-source retention + override rules.
CREATE TYPE "EmailSuppressionReason" AS ENUM (
  'USER_UNSUBSCRIBE',  -- recipient clicked unsubscribe
  'BOUNCE_HARD',       -- SMTP-confirmed permanent failure
  'SPAM_REPORT',       -- recipient reported as spam
  'MANUAL_ADD',        -- admin added (e.g., legal request)
  'COMPLAINT',         -- direct complaint via support channel
  'GLOBAL_BLOCK'       -- platform-wide block (regulator, abuse)
);

CREATE TABLE "email_suppressions" (
  "id"             TEXT NOT NULL,
  "tenant_id"      TEXT NOT NULL,
  -- email_hash: SHA-256 hex of lowercase(trim(email)). 64 hex chars.
  -- Computed app-side at insert time. Lookup path: pre-send check
  -- "WHERE tenant_id = ? AND email_hash = sha256(?)".
  "email_hash"     CHAR(64) NOT NULL,
  -- email_masked: e.g. "j****@e****.com" — for admin UI rendering.
  -- Truncated form, never the full address. 320 = RFC max in case admin
  -- chooses light masking ("john@e****.com"). App layer enforces masking;
  -- DB just stores the chosen rendering.
  "email_masked"   VARCHAR(320) NOT NULL,
  "reason"         "EmailSuppressionReason" NOT NULL,
  -- source: free-form provenance hint ("webhook:mailgun", "user:abc",
  -- "import:csv-2026-05", etc.) for audit forensics.
  "source"         VARCHAR(128),
  "added_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- expires_at: optional auto-expiry. NULL = indefinite (the default for
  -- USER_UNSUBSCRIBE + BOUNCE_HARD). MANUAL_ADD entries may have a
  -- TTL set by the admin (e.g., 90-day cool-down).
  "expires_at"     TIMESTAMP(3),
  -- Optional metadata for the audit trail. We deliberately do NOT add a
  -- contact_id FK because the suppression must survive contact deletion.
  "added_by_id"    TEXT,
  "notes"          VARCHAR(1024),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- One suppression per (tenant, email_hash). Re-suppression of the same
-- email is an UPDATE (refresh reason/source), not an INSERT.
CREATE UNIQUE INDEX "email_suppressions_tenant_email_hash_uniq"
  ON "email_suppressions" ("tenant_id", "email_hash");

-- Reason-bucket reporting: "show me all hard-bounces this month".
CREATE INDEX "email_suppressions_tenant_reason_added_idx"
  ON "email_suppressions" ("tenant_id", "reason", "added_at" DESC);

-- Expiry sweeper: "delete suppressions whose expires_at < now()".
-- Partial index keeps it cheap when most entries are indefinite.
CREATE INDEX "email_suppressions_expiry_idx"
  ON "email_suppressions" ("expires_at")
  WHERE "expires_at" IS NOT NULL;

-- FK to tenants — CASCADE on delete.
ALTER TABLE "email_suppressions"
  ADD CONSTRAINT "email_suppressions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS — canonical pattern, fails closed when ALS missing.
ALTER TABLE "email_suppressions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_suppressions" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_email_suppressions ON "email_suppressions"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "email_suppressions" TO app_user;
