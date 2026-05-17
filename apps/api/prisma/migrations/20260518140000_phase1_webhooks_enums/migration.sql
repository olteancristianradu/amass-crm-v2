-- Phase 1 E.1 — extend WebhookEvent enum with the 7 events that close the
-- loop between F1 (email tracking) and F3 (webhooks marketplace).
-- Split from columns migration per Postgres ALTER TYPE restriction.
--
-- New values (additive, no rename, no drop):
--   CAMPAIGN_SENT          — batch send dispatch started for a campaign
--   CAMPAIGN_COMPLETED     — all recipients processed (incl. failures)
--   EMAIL_OPENED           — tracking pixel hit recorded
--   EMAIL_CLICKED          — tracked link click recorded
--   EMAIL_BOUNCED          — bounce event recorded (hard or soft)
--   EMAIL_UNSUBSCRIBED     — recipient unsubscribed (List-Unsubscribe or footer)
--   EMAIL_SPAM_REPORTED    — recipient/provider reported as spam
--
-- Existing webhook subscriptions ignore new events unless re-configured —
-- this is purely additive surface.

ALTER TYPE "WebhookEvent" ADD VALUE IF NOT EXISTS 'CAMPAIGN_SENT';
ALTER TYPE "WebhookEvent" ADD VALUE IF NOT EXISTS 'CAMPAIGN_COMPLETED';
ALTER TYPE "WebhookEvent" ADD VALUE IF NOT EXISTS 'EMAIL_OPENED';
ALTER TYPE "WebhookEvent" ADD VALUE IF NOT EXISTS 'EMAIL_CLICKED';
ALTER TYPE "WebhookEvent" ADD VALUE IF NOT EXISTS 'EMAIL_BOUNCED';
ALTER TYPE "WebhookEvent" ADD VALUE IF NOT EXISTS 'EMAIL_UNSUBSCRIBED';
ALTER TYPE "WebhookEvent" ADD VALUE IF NOT EXISTS 'EMAIL_SPAM_REPORTED';
