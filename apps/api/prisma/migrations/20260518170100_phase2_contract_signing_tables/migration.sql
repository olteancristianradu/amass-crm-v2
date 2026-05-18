-- Phase 2 A.2 — Contract signing tables + Contract column extends.
-- Runs in a fresh transaction (enums committed in migration A.1 — 20260518170000).
--
-- Adds:
--  1. New columns on `contracts` for the e-sign ceremony (template ref, rendered
--     PDF storage key + hash, ceremony expiry, signing mode).
--  2. `contract_signatures` — per-signer ceremony state with HMAC token (unique
--     globally because the callback lookup is `WHERE ceremony_token=$1`).
--  3. `contract_signature_events` — high-cardinality lifecycle event log
--     (SENT/VIEWED/SIGNED/REMINDER_SENT/...) — complement to the hash-chained
--     audit table (added in migration C — 20260518171000).
--
-- RLS canonical pattern (matches outbox_events, campaign_recipients) — see
-- 20260504065000_rls_deny_missing_tenant: deny-by-default when app.tenant_id
-- is unset (returns sentinel '__amass_missing_tenant_context__').

-- ─── EXTEND contracts ───────────────────────────────────────────────────────
ALTER TABLE "contracts"
  ADD COLUMN "template_id"        TEXT,
  ADD COLUMN "pdf_storage_key"    TEXT,
  ADD COLUMN "pdf_hash"           VARCHAR(64),
  ADD COLUMN "signing_expires_at" TIMESTAMP(3),
  -- VARCHAR + CHECK instead of an enum because we may want to extend to
  -- HYBRID or per-signer overrides later without an ALTER TYPE migration.
  ADD COLUMN "signing_mode"       VARCHAR(16) DEFAULT 'PARALLEL';

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_signing_mode_chk"
  CHECK ("signing_mode" IN ('PARALLEL', 'SEQUENTIAL'));

-- Hot path for the `contracts:signing-expire` cron worker (Phase 2.5):
--   SELECT id FROM contracts
--   WHERE signing_expires_at < NOW() AND status = 'PENDING_SIGNATURE'
-- Partial index keeps it O(pending-backlog), not O(all-contracts).
CREATE INDEX "contracts_tenant_signing_expires_idx"
  ON "contracts" ("tenant_id", "signing_expires_at")
  WHERE "signing_expires_at" IS NOT NULL AND "status" = 'PENDING_SIGNATURE';

-- ─── contract_signatures ────────────────────────────────────────────────────
CREATE TABLE "contract_signatures" (
  "id"                     TEXT NOT NULL,
  "tenant_id"              TEXT NOT NULL,
  "contract_id"            TEXT NOT NULL,
  "signer_email"           VARCHAR(320) NOT NULL,
  "signer_name"            VARCHAR(255) NOT NULL,
  "signer_role"            "ContractSignerRole" NOT NULL DEFAULT 'COUNTERPARTY',
  "signing_order"          INTEGER NOT NULL DEFAULT 0,
  "ceremony_token"         VARCHAR(64) NOT NULL,
  "ceremony_token_kid"     VARCHAR(8) NOT NULL DEFAULT 'v1',
  "status"                 "ContractSignatureStatus" NOT NULL DEFAULT 'PENDING',
  "signature_storage_key"  TEXT,
  "signature_hash"         VARCHAR(64),
  "signature_proof"        JSONB,
  "decline_reason"         VARCHAR(2048),
  "sent_at"                TIMESTAMP(3),
  "first_viewed_at"        TIMESTAMP(3),
  "signed_at"              TIMESTAMP(3),
  "declined_at"            TIMESTAMP(3),
  "expires_at"             TIMESTAMP(3) NOT NULL,
  "ip_address"             VARCHAR(64),
  "user_agent"             VARCHAR(512),
  "signer_geo_city"        VARCHAR(128),
  "signer_geo_country"     VARCHAR(2),
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contract_signatures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contract_signatures_ceremony_token_uniq"
  ON "contract_signatures" ("ceremony_token");

CREATE UNIQUE INDEX "contract_signatures_contract_email_uniq"
  ON "contract_signatures" ("contract_id", "signer_email");

CREATE INDEX "contract_signatures_tenant_contract_order_idx"
  ON "contract_signatures" ("tenant_id", "contract_id", "signing_order");

CREATE INDEX "contract_signatures_tenant_status_expires_idx"
  ON "contract_signatures" ("tenant_id", "status", "expires_at")
  WHERE "status" IN ('PENDING', 'SENT', 'VIEWED');

ALTER TABLE "contract_signatures"
  ADD CONSTRAINT "contract_signatures_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contract_signatures"
  ADD CONSTRAINT "contract_signatures_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contract_signatures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_signatures" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_contract_signatures ON "contract_signatures"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "contract_signatures" TO app_user;

-- ─── contract_signature_events ──────────────────────────────────────────────
CREATE TABLE "contract_signature_events" (
  "id"           TEXT NOT NULL,
  "tenant_id"    TEXT NOT NULL,
  "signature_id" TEXT NOT NULL,
  "event_type"   VARCHAR(32) NOT NULL,
  "ip_address"   VARCHAR(64),
  "user_agent"   VARCHAR(512),
  "metadata"     JSONB,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contract_signature_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contract_signature_events_tenant_sig_created_idx"
  ON "contract_signature_events" ("tenant_id", "signature_id", "created_at");

ALTER TABLE "contract_signature_events"
  ADD CONSTRAINT "contract_signature_events_signature_id_fkey"
  FOREIGN KEY ("signature_id") REFERENCES "contract_signatures"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contract_signature_events"
  ADD CONSTRAINT "contract_signature_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contract_signature_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_signature_events" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_contract_signature_events ON "contract_signature_events"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "contract_signature_events" TO app_user;
