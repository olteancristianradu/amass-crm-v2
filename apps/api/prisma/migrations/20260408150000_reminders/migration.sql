-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'FIRED', 'DISMISSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectType" "SubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "actorId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "firedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reminders_tenantId_subjectType_subjectId_remindAt_idx" ON "reminders"("tenantId", "subjectType", "subjectId", "remindAt");

-- CreateIndex
CREATE INDEX "reminders_tenantId_actorId_status_remindAt_idx" ON "reminders"("tenantId", "actorId", "status", "remindAt");

-- CreateIndex
CREATE INDEX "reminders_tenantId_status_remindAt_idx" ON "reminders"("tenantId", "status", "remindAt");

-- ============================================================================
-- Row-Level Security: tenant isolation for reminders. Same defense-in-depth
-- pattern as everywhere else — even if a service forgets the WHERE clause,
-- RLS still blocks cross-tenant reads/writes inside `SET LOCAL ROLE app_user`.
-- ============================================================================

ALTER TABLE "reminders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reminders" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_reminders ON "reminders"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "reminders" TO app_user;
