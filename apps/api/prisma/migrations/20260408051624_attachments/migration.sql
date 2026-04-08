-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectType" "SubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storageKey_key" ON "attachments"("storageKey");

-- CreateIndex
CREATE INDEX "attachments_tenantId_subjectType_subjectId_createdAt_idx" ON "attachments"("tenantId", "subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "attachments_tenantId_createdAt_idx" ON "attachments"("tenantId", "createdAt");

-- ============================================================================
-- Row-Level Security: tenant isolation for attachments. Same defense-in-depth
-- pattern as everywhere else; storage objects in MinIO are isolated by the
-- tenant-prefixed `storageKey`, but the metadata row is what guards access.
-- ============================================================================

ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_attachments ON "attachments"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "attachments" TO app_user;
