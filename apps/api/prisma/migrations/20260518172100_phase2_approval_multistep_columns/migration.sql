-- Phase 2 D.2 — Approval polymorphic + multi-step columns + backfill
-- (Phase 2 schema review §D.2 / §5.4).
--
-- 2-PHASE ROLLOUT PATTERN (BLOCKER 5):
--   Phase 2.0 (this migration): ADD nullable polymorphic columns, BACKFILL
--                               existing rows (subject_type=QUOTE, subject_id=quote_id),
--                               ALTER quote_id → nullable so the new MANUAL trigger
--                               can create approval requests without a quote.
--   Phase 2.3 (>=14d post-deploy): app reads only from new columns. Dual-write kept.
--   Phase 2.6 (>=30d post-deploy): separate `DROP COLUMN quote_id` migration
--                                  AFTER verifying zero reads (pg_stat_user_tables + Sentry).

-- ─── EXTEND approval_policies ───────────────────────────────────────────────
ALTER TABLE "approval_policies"
  ADD COLUMN "subject_type" "ApprovalSubjectType" NOT NULL DEFAULT 'QUOTE',
  ADD COLUMN "steps_config" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX "approval_policies_tenant_subject_active_idx"
  ON "approval_policies" ("tenant_id", "subject_type", "is_active")
  WHERE "deleted_at" IS NULL;

-- ─── EXTEND approval_requests ───────────────────────────────────────────────
ALTER TABLE "approval_requests"
  ADD COLUMN "subject_type"    "ApprovalSubjectType",
  ADD COLUMN "subject_id"      TEXT,
  ADD COLUMN "current_step_id" TEXT,
  ADD COLUMN "expires_at"      TIMESTAMP(3),
  ADD COLUMN "completed_at"    TIMESTAMP(3);

-- ALTER quote_id → NULLABLE (was NOT NULL). Required by the MANUAL trigger
-- which can target any subject (no quote at all).
ALTER TABLE "approval_requests"
  ALTER COLUMN "quote_id" DROP NOT NULL;

-- BACKFILL existing rows: every pre-Phase-2 request was a QUOTE request.
-- Idempotent: the WHERE clause skips already-backfilled rows on re-apply.
UPDATE "approval_requests"
  SET "subject_type" = 'QUOTE',
      "subject_id"   = "quote_id"
  WHERE "subject_type" IS NULL
    AND "quote_id" IS NOT NULL;

-- Defense for orphan rows (shouldn't exist pre-Phase-2 since quote_id was
-- NOT NULL, but covers the case where a Phase-2 alpha branch was applied
-- and then rolled back, leaving NULL rows).
UPDATE "approval_requests"
  SET "status"       = 'CANCELLED',
      "subject_type" = 'QUOTE',
      "subject_id"   = 'DELETED_QUOTE'
  WHERE "subject_type" IS NULL
    AND "quote_id" IS NULL;

CREATE INDEX "approval_requests_tenant_subject_idx"
  ON "approval_requests" ("tenant_id", "subject_type", "subject_id");

CREATE INDEX "approval_requests_tenant_status_expires_idx"
  ON "approval_requests" ("tenant_id", "status", "expires_at")
  WHERE "expires_at" IS NOT NULL AND "status" IN ('PENDING', 'IN_PROGRESS');

-- ─── EXTEND approval_decisions ──────────────────────────────────────────────
ALTER TABLE "approval_decisions"
  ADD COLUMN "step_id" TEXT;
-- FK + index added in 20260518173000 (approval_steps doesn't exist yet).
