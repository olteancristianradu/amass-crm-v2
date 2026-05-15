-- B3-PR3: SCIM bearer tokens for IdP provisioning auth.
-- One row per IdP integration. tokenHash = SHA-256(raw) so a DB dump does
-- not leak working credentials. revokedAt is permanent (never cleared);
-- the verify path filters by revokedAt IS NULL.

-- CreateTable
CREATE TABLE "scim_tokens" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "scim_tokens_pkey" PRIMARY KEY ("id")
);

-- Token hash is the lookup key on every SCIM call — must be unique +
-- indexed. Unique because two distinct raw tokens that hash to the same
-- digest would be a SHA-256 collision (astronomically unlikely, but the
-- unique constraint makes the failure mode loud rather than silent).
-- CreateIndex
CREATE UNIQUE INDEX "scim_tokens_token_hash_key" ON "scim_tokens"("token_hash");

-- Admin listing reads tokens by tenant.
-- CreateIndex
CREATE INDEX "scim_tokens_tenantId_idx" ON "scim_tokens"("tenantId");

-- AddForeignKey — cascade so deleting a tenant cleans up all SCIM tokens.
ALTER TABLE "scim_tokens" ADD CONSTRAINT "scim_tokens_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS — same template as every other tenant-scoped table in this repo.
-- current_tenant_id() returns a sentinel when missing (see
-- 20260504065000_rls_deny_missing_tenant), so app_user without a SET LOCAL
-- app.tenant_id fails closed.
ALTER TABLE "scim_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scim_tokens" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_scim_tokens ON "scim_tokens"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "scim_tokens" TO app_user;
