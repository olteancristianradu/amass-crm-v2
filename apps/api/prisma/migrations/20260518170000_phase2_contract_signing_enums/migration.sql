-- Phase 2 A.1 — Contract signing enums (Phase 2 schema review §A.2).
--
-- SPLIT from the columns/tables migration because Postgres disallows
-- `ALTER TYPE ... ADD VALUE` and then using the new value in the same
-- transaction. Enum-only migrations commit immediately, the sibling
-- 20260518170100 migration can then reference them safely.
--
-- New ContractStatus values (additive — no rename, no drop):
--   PENDING_SIGNATURE — ceremony issued, waiting on at least one signer
--   DECLINED          — at least one signer refused OR ceremony expired without all signers signing
--
-- New enums for the signing flow:
--   ContractSignatureStatus — per-signer ceremony state machine
--   ContractSignerRole      — eIDAS role taxonomy (tenant / counterparty / witness)
--
-- IF NOT EXISTS makes the migration idempotent on re-apply attempts (eg
-- after a failed `prisma migrate deploy` mid-batch).

ALTER TYPE "ContractStatus" ADD VALUE IF NOT EXISTS 'PENDING_SIGNATURE';
ALTER TYPE "ContractStatus" ADD VALUE IF NOT EXISTS 'DECLINED';

CREATE TYPE "ContractSignatureStatus" AS ENUM (
  'PENDING',
  'SENT',
  'VIEWED',
  'SIGNED',
  'DECLINED',
  'EXPIRED',
  'VOIDED'
);

CREATE TYPE "ContractSignerRole" AS ENUM (
  'TENANT_OWNER',
  'COUNTERPARTY',
  'WITNESS'
);
