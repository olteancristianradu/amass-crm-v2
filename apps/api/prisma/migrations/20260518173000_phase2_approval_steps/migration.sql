-- Phase 2 E — ApprovalStep: per-step state for multi-step approval workflows
-- (Phase 2 schema review §E / §6).
--
-- The enum ApprovalStepStatus is created in the sibling 20260518172000 migration
-- so we can reference it here without an ALTER TYPE in the same transaction.

CREATE TABLE "approval_steps" (
  "id"             TEXT NOT NULL,
  "tenant_id"      TEXT NOT NULL,
  "request_id"     TEXT NOT NULL,
  "order"          INTEGER NOT NULL,
  "approver_id"    TEXT,
  "approver_role"  VARCHAR(64),
  "sla_hours"      INTEGER,
  "status"         "ApprovalStepStatus" NOT NULL DEFAULT 'PENDING',
  "started_at"     TIMESTAMP(3),
  "completed_at"   TIMESTAMP(3),
  "expires_at"     TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id"),

  -- Exact one of approver_id / approver_role set, OR both NULL (unassigned slot).
  -- Both set = ambiguous (which check wins?) → reject at the DB level.
  CONSTRAINT "approval_steps_approver_exclusive_chk"
    CHECK (
      ("approver_id" IS NULL AND "approver_role" IS NULL) OR
      ("approver_id" IS NOT NULL AND "approver_role" IS NULL) OR
      ("approver_id" IS NULL AND "approver_role" IS NOT NULL)
    )
);

CREATE INDEX "approval_steps_tenant_request_order_idx"
  ON "approval_steps" ("tenant_id", "request_id", "order");

CREATE INDEX "approval_steps_tenant_approver_status_idx"
  ON "approval_steps" ("tenant_id", "approver_id", "status")
  WHERE "approver_id" IS NOT NULL AND "status" = 'ACTIVE';

CREATE INDEX "approval_steps_tenant_role_status_idx"
  ON "approval_steps" ("tenant_id", "approver_role", "status")
  WHERE "approver_role" IS NOT NULL AND "status" = 'ACTIVE';

ALTER TABLE "approval_steps"
  ADD CONSTRAINT "approval_steps_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "approval_steps"
  ADD CONSTRAINT "approval_steps_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Now that approval_steps exists, wire the back-references that 20260518172100
-- declared as plain TEXT columns (forward declaration to avoid circular FK).
ALTER TABLE "approval_requests"
  ADD CONSTRAINT "approval_requests_current_step_id_fkey"
  FOREIGN KEY ("current_step_id") REFERENCES "approval_steps"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "approval_decisions"
  ADD CONSTRAINT "approval_decisions_step_id_fkey"
  FOREIGN KEY ("step_id") REFERENCES "approval_steps"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "approval_decisions_tenant_step_idx"
  ON "approval_decisions" ("tenant_id", "step_id")
  WHERE "step_id" IS NOT NULL;

ALTER TABLE "approval_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_steps" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_approval_steps ON "approval_steps"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "approval_steps" TO app_user;
