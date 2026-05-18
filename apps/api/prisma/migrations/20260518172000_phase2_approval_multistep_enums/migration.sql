-- Phase 2 D.1 — Approval workflow multi-step enums (Phase 2 schema review §D.1 / §5.3).
--
-- SPLIT from the columns migration per the Postgres `ALTER TYPE ... ADD VALUE`
-- restriction (same reason as A.1).
--
-- ApprovalStatus additions:
--   IN_PROGRESS — at least one step approved, more steps pending
--   EXPIRED     — SLA deadline passed without final decision
--
-- ApprovalPolicyTrigger additions: open the engine to non-Quote subjects.
--
-- New ApprovalSubjectType enum (polymorphic subject) — replaces the quote_id-only
-- model. Backfill in 20260518172100 maps existing rows to QUOTE.
--
-- ApprovalStepStatus is created here (in the enum-only migration) so the
-- sibling 20260518173000 migration can reference it without an ALTER TYPE
-- inside the same transaction as the table that uses it.
--
-- IF NOT EXISTS for idempotency on re-apply.

ALTER TYPE "ApprovalStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
ALTER TYPE "ApprovalStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TYPE "ApprovalPolicyTrigger" ADD VALUE IF NOT EXISTS 'CONTRACT_VALUE_ABOVE';
ALTER TYPE "ApprovalPolicyTrigger" ADD VALUE IF NOT EXISTS 'EXPENSE_ABOVE_VALUE';
ALTER TYPE "ApprovalPolicyTrigger" ADD VALUE IF NOT EXISTS 'DEAL_DISCOUNT_ABOVE_PCT';
ALTER TYPE "ApprovalPolicyTrigger" ADD VALUE IF NOT EXISTS 'MANUAL';

CREATE TYPE "ApprovalSubjectType" AS ENUM (
  'QUOTE',
  'CONTRACT',
  'DEAL',
  'INVOICE',
  'EXPENSE'
);

CREATE TYPE "ApprovalStepStatus" AS ENUM (
  'PENDING',
  'ACTIVE',
  'APPROVED',
  'REJECTED',
  'SKIPPED'
);
