-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_action_idx" ON "audit_logs"("tenantId", "action");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_subjectType_subjectId_idx" ON "audit_logs"("tenantId", "subjectType", "subjectId");

-- ============================================================================
-- Row-Level Security (RLS) — defense layer 3 for multi-tenant isolation.
-- The application sets `app.tenant_id` per transaction via `SET LOCAL`.
-- Layered defense: TenantGuard (JWT) -> Prisma extension auto-filter ->
-- this RLS policy. If any of the upper layers leak, RLS still prevents
-- cross-tenant reads/writes.
-- ============================================================================

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '');
$$ LANGUAGE SQL STABLE;

ALTER TABLE "users"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

-- Note: `tenants` itself is intentionally NOT row-locked — login/register
-- needs to look up tenants by slug BEFORE we know the tenantId.
--
-- Policy semantics: when `app.tenant_id` is NULL the policy lets the query
-- through (this is required for login/refresh which need to read across
-- tenants by token). Application code (defense layer 2) is responsible for
-- ensuring the var is set on every authenticated request path.

CREATE POLICY tenant_isolation_users ON "users"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

CREATE POLICY tenant_isolation_sessions ON "sessions"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

CREATE POLICY tenant_isolation_audit ON "audit_logs"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());
