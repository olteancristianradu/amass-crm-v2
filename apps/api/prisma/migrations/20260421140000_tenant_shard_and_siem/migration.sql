-- G-prep + E-compliance: add sharding key + SIEM webhook + audit retention
-- override to tenants. Each column is NULL-able so existing rows don't need
-- backfill to keep working; shardId gets populated with a hash of the id so
-- new rows have a stable value immediately.

ALTER TABLE "tenants"
  ADD COLUMN "shardId" INTEGER,
  ADD COLUMN "siemWebhookUrl" TEXT,
  ADD COLUMN "auditRetentionDays" INTEGER;

-- Deterministic shard derivation: first 8 hex chars of MD5 of the id, mod 1024.
-- This yields a stable 0..1023 bucket the app can later route on without a
-- round-trip. MD5 is fine here (not a security primitive — just a hash).
UPDATE "tenants"
SET "shardId" = (('x' || substr(md5("id"), 1, 8))::bit(32)::int) & 1023
WHERE "shardId" IS NULL;

CREATE INDEX "tenants_shardId_idx" ON "tenants"("shardId");
