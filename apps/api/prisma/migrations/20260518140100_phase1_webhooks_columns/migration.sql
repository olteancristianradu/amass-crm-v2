-- Phase 1 E.2 — Webhook hardening per security threat model:
--   - secretEncrypted + secretKid (envelope encryption, BLOCKER 2 stage 1:
--     additive, dual-write coexistence with plaintext `secret` for 30 days;
--     plaintext drop deferred to Phase 1.6 cleanup migration after backfill)
--   - operational health columns on WebhookEndpoint
--   - retry orchestration + idempotency + signature audit on WebhookDelivery
--
-- All NULLABLE (or DEFAULT) so existing rows remain valid post-migration.

-- =============================================================
-- WebhookEndpoint extends
-- =============================================================

ALTER TABLE "webhook_endpoints"
  -- Encrypted secret + KMS key identifier (envelope encryption).
  -- Format: base64url(ciphertext || tag || iv). 1024-char ceiling fits
  -- AES-256-GCM with a 32-byte plaintext + auth tag + IV margin.
  -- BLOCKER 2 phase 1: dual-write with existing plaintext `secret` column
  -- for 30 days, then backfill encrypt + DROP COLUMN secret in Phase 1.6.
  ADD COLUMN IF NOT EXISTS "secret_encrypted"      VARCHAR(1024),
  ADD COLUMN IF NOT EXISTS "secret_kid"            VARCHAR(64),
  -- Optional human description shown in the admin UI ("Slack #sales channel").
  ADD COLUMN IF NOT EXISTS "description"           VARCHAR(512),
  -- Operational health counters maintained by the delivery worker.
  ADD COLUMN IF NOT EXISTS "consecutive_failures"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_delivery_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_success_at"       TIMESTAMP(3),
  -- Auto-disable bookkeeping (set when 410 Gone repeats or failure threshold trips).
  ADD COLUMN IF NOT EXISTS "disabled_at"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disabled_reason"       VARCHAR(256),
  -- Audit: which user registered this endpoint. NULL acceptable for system-created.
  ADD COLUMN IF NOT EXISTS "created_by_id"         TEXT;

-- CHECK: url MUST start with 'https://' in production. We do NOT add a NODE_ENV
-- check at the DB layer — the app layer already enforces https-only in prod
-- (webhooks.service.ts), but a DB CHECK is a hard belt-and-braces. We allow
-- http for the test/dev tenant because some unit tests register http URLs.
-- The CHECK below is intentionally NOT enforced — see Phase 1.6 cleanup.
-- For now, document the constraint as a comment for the security review trail.
-- ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_url_https_chk" ...
-- DEFERRED: enabling this without a backfill would break existing test rows.

-- Partial index: scheduler-hot path "list active endpoints for a tenant".
-- Most endpoints stay isActive=true; the partial filter keeps the index lean
-- by skipping disabled endpoints.
CREATE INDEX IF NOT EXISTS "webhook_endpoints_tenant_active_idx"
  ON "webhook_endpoints" ("tenant_id")
  WHERE "is_active" = TRUE;

-- =============================================================
-- WebhookDelivery extends
-- =============================================================

ALTER TABLE "webhook_deliveries"
  -- payload_hash: SHA-256 hex of the canonicalized payload JSON. Two purposes:
  --   1. Idempotency on retry (same payload across attempts = same hash).
  --   2. Audit forensics (recipient claims "we never got that body").
  ADD COLUMN IF NOT EXISTS "payload_hash"      CHAR(64),
  -- idempotency_key: app-supplied dedup key (e.g., outbox_event_id::endpoint_id).
  -- Sent in X-Idempotency-Key header so naive receivers can dedupe.
  ADD COLUMN IF NOT EXISTS "idempotency_key"   VARCHAR(128),
  -- signature: the X-Amass-Signature value we sent. Persisted so admin can
  -- replay verification against the stored payload if dispute arises.
  ADD COLUMN IF NOT EXISTS "signature"         VARCHAR(256),
  -- signature_kid: KMS key id used for the HMAC (matches WebhookEndpoint.secret_kid
  -- at delivery time; allows rotation introspection).
  ADD COLUMN IF NOT EXISTS "signature_kid"     VARCHAR(64),
  -- response_headers: provider-returned headers (truncated). JSONB so admins
  -- can query e.g. "find deliveries where x-ratelimit-remaining < 10".
  ADD COLUMN IF NOT EXISTS "response_headers"  JSONB,
  -- max_attempts: per-delivery override of the default retry envelope.
  -- Default 8 matches the BullMQ backoff plan (30s, 1m, 5m, 30m, 2h, 6h, 1d, 3d).
  ADD COLUMN IF NOT EXISTS "max_attempts"      INTEGER NOT NULL DEFAULT 8,
  -- next_attempt_at: when the BullMQ poller should pick this row up again.
  -- NULL after success OR dead_letter = TRUE (no further retries).
  ADD COLUMN IF NOT EXISTS "next_attempt_at"   TIMESTAMP(3),
  -- dead_letter: terminal state. Set TRUE when attempts >= max_attempts or
  -- receiver returned 410 Gone, etc. Admin UI lists these for manual replay.
  ADD COLUMN IF NOT EXISTS "dead_letter"       BOOLEAN NOT NULL DEFAULT FALSE,
  -- duration_ms: end-to-end network time (DNS + TCP + TLS + send + receive).
  -- Useful for "is receiver getting slow?" dashboards.
  ADD COLUMN IF NOT EXISTS "duration_ms"       INTEGER,
  -- completed_at: when this delivery row finalized (success OR dead_letter).
  ADD COLUMN IF NOT EXISTS "completed_at"      TIMESTAMP(3);

-- Partial index: BullMQ retry poller hot path.
-- Worker query (every 5s): "give me pending deliveries due now".
--   SELECT id FROM webhook_deliveries
--   WHERE success = FALSE AND dead_letter = FALSE AND next_attempt_at <= now()
--   ORDER BY next_attempt_at LIMIT 100;
-- Partial WHERE keeps the index O(in-flight) not O(all deliveries).
CREATE INDEX IF NOT EXISTS "webhook_deliveries_retry_pending_idx"
  ON "webhook_deliveries" ("next_attempt_at")
  WHERE "success" = FALSE AND "dead_letter" = FALSE;

-- Dead-letter queue listing for admin UI ("show me failed deliveries").
-- Sorted by created_at DESC to land newest-first paging.
CREATE INDEX IF NOT EXISTS "webhook_deliveries_dead_letter_idx"
  ON "webhook_deliveries" ("tenant_id", "created_at" DESC)
  WHERE "dead_letter" = TRUE;
