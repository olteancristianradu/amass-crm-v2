-- Phase 1 / F1 — Tenant-level GDPR opt-out for email open/click tracking.
-- Default TRUE: backward-compatible with existing send pipeline that already
-- relies on tracking; tenant admin can flip to FALSE in tenant settings to
-- disable pixel + click-rewrite injection for all outbound emails.
--
-- Per docs/threat-models/phase-1.md T-MAIL-E-02 (GDPR lawful-basis evidence).

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "email_tracking_enabled" BOOLEAN NOT NULL DEFAULT true;
