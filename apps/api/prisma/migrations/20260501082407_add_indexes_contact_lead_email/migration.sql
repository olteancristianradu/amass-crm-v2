-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_tenantId_email_idx" ON "contacts"("tenantId", "email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "leads_tenant_id_email_idx" ON "leads"("tenant_id", "email");

-- Index renames live in 20260501120000_rename_soft_delete_indexes.
-- This migration's timestamp is earlier than the migrations that create the
-- legacy idx_* indexes on a clean database, so doing the renames here made CI
-- fail with P3018/P3006.
