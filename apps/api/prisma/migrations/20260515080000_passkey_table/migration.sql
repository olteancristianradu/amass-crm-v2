-- B2-PR1: WebAuthn / FIDO2 passkey credentials.
-- One row per registered authenticator (a single user can have many — phone,
-- laptop, hardware key). Public key + counter are persisted; the private key
-- never leaves the user's device.

-- CreateTable
CREATE TABLE "passkeys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "device_name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

-- credentialId is globally unique per the WebAuthn spec — at login the
-- assertion arrives with only the credentialId and we look up the row.
-- CreateIndex
CREATE UNIQUE INDEX "passkeys_credential_id_key" ON "passkeys"("credential_id");

-- Hot-path: list a user's authenticators for excludeCredentials at register
-- and for allowCredentials at authenticate.
-- CreateIndex
CREATE INDEX "passkeys_tenantId_userId_idx" ON "passkeys"("tenantId", "userId");

-- AddForeignKey — cascade so deleting a tenant/user cleans up all passkeys.
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS — same template as every other tenant-scoped table in this repo.
-- current_tenant_id() returns a sentinel when missing (see
-- 20260504065000_rls_deny_missing_tenant), so app_user without a SET LOCAL
-- app.tenant_id fails closed.
ALTER TABLE "passkeys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "passkeys" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_passkeys ON "passkeys"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "passkeys" TO app_user;
