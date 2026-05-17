-- Phase 1 C.1 — extend EmailTrackKind enum with deliverability events.
-- Split from columns/indexes migration to satisfy Postgres' restriction on
-- using a freshly-added enum value within the same transaction.
--
-- New kinds (additive — existing OPEN/CLICK rows unaffected):
--   BOUNCE        — SMTP-level rejection (hard or soft)
--   UNSUBSCRIBE   — recipient clicked List-Unsubscribe / footer link
--   SPAM_REPORT   — provider/recipient reported the message as spam
--   DELIVERED     — provider confirmed inbox delivery (via webhook hook-back)
--
-- Each in its own ALTER TYPE statement, idempotent on re-apply.

ALTER TYPE "EmailTrackKind" ADD VALUE IF NOT EXISTS 'BOUNCE';
ALTER TYPE "EmailTrackKind" ADD VALUE IF NOT EXISTS 'UNSUBSCRIBE';
ALTER TYPE "EmailTrackKind" ADD VALUE IF NOT EXISTS 'SPAM_REPORT';
ALTER TYPE "EmailTrackKind" ADD VALUE IF NOT EXISTS 'DELIVERED';
