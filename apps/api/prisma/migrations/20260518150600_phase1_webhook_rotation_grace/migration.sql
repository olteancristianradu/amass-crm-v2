-- Phase 1 F3 — Webhook secret rotation 24h grace window.
-- Threat: T-WH-T-03 — Rotation Without Subscriber Coordination
--
-- Current behavior: rotateSecret() generates a new secret and overwrites
-- the existing column immediately. Any in-flight deliveries signed with
-- the old secret + any subscriber that has cached the old secret AT THE
-- SAME MOMENT will reject the next event with an HMAC mismatch → event
-- lost (or dead-lettered, depending on subscriber).
--
-- Fix: keep the previous secret alongside the new one for 24h. The
-- delivery processor signs with the CURRENT secret AND sends a SECOND
-- header line `X-Amass-Signature: t=...,v1=<new>,v1prev=<old>`. The
-- subscriber accepts either. After 24h, a hourly sweeper NULLs the
-- previous_* columns. No new model — strictly additive on webhook_endpoints.

ALTER TABLE "webhook_endpoints"
  ADD COLUMN IF NOT EXISTS "previous_secret_encrypted"   VARCHAR(1024),
  ADD COLUMN IF NOT EXISTS "previous_secret_kid"         VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "previous_secret_valid_until" TIMESTAMP(3);

-- Sweeper hot-path index: query "find endpoints whose previous secret
-- has expired" runs hourly. Partial index keeps it cheap when most
-- endpoints have no pending grace window.
CREATE INDEX IF NOT EXISTS "webhook_endpoints_previous_secret_expiry_idx"
  ON "webhook_endpoints" ("previous_secret_valid_until")
  WHERE "previous_secret_valid_until" IS NOT NULL;
