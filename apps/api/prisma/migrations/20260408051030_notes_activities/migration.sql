-- CreateEnum
CREATE TYPE "SubjectType" AS ENUM ('COMPANY', 'CONTACT', 'CLIENT');

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectType" "SubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectType" "SubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notes_tenantId_subjectType_subjectId_createdAt_idx" ON "notes"("tenantId", "subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "notes_tenantId_createdAt_idx" ON "notes"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "activities_tenantId_subjectType_subjectId_createdAt_idx" ON "activities"("tenantId", "subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "activities_tenantId_createdAt_idx" ON "activities"("tenantId", "createdAt");

-- ============================================================================
-- Row-Level Security: tenant isolation for notes + activities.
-- Same defense-in-depth pattern as companies/contacts/clients/import_jobs:
-- the `app_user` role (NOSUPERUSER NOBYPASSRLS) is what app code uses, and
-- `current_tenant_id()` reads from `app.tenant_id` set via SET LOCAL.
-- ============================================================================

ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notes" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_notes ON "notes"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activities" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_activities ON "activities"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

-- Grant CRUD to app_user (default privileges from 20260407211000_app_role
-- only cover tables that existed at the time it ran).
GRANT SELECT, INSERT, UPDATE, DELETE ON "notes"      TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "activities" TO app_user;
