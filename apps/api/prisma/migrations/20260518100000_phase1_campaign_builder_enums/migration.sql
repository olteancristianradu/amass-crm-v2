-- Phase 1 A.1 — extend CampaignStatus enum with lifecycle values needed by the
-- drag-drop campaign builder + scheduler worker. Postgres disallows
-- ALTER TYPE ... ADD VALUE inside a transaction with subsequent column-DDL
-- that depends on the new value, so this migration is split: enum-only here,
-- columns + indexes + CHECKs in the sibling 20260518100100 migration.
--
-- New values (additive, no rename, no drop):
--   SCHEDULED — campaign has a future scheduledAt and is on the BullMQ delay queue
--   SENDING   — worker has started dispatching messages to recipients
--   CANCELLED — admin paused/cancelled before COMPLETED (matches existing style)
--
-- IF NOT EXISTS guards make the migration idempotent on re-apply attempts.

ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'SENDING';
ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
