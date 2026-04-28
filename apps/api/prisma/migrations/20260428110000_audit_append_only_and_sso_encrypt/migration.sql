-- M-aud-M7: audit_logs is append-only at the DB layer.
-- The application path uses runWithTenant + RLS which already prevents
-- cross-tenant DELETE, but a direct app_user query (or a buggy service
-- that forgets runWithTenant) could still issue UPDATE/DELETE. Revoking
-- those privileges is belt-and-suspenders: even if app code goes wrong,
-- Postgres rejects the statement.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM app_user;
-- Keep INSERT + SELECT + REFERENCES + TRIGGER (read access for /audit list,
-- foreign-key checks, and Prisma's metadata queries).

-- M-aud-M5: SsoConfig now stores idpCertificate + spPrivateKey encrypted
-- at rest. Add the encrypted columns; the application writes encrypted
-- payloads via common/crypto/encryption (AES-256-GCM, same as SMTP
-- passwords + WhatsApp access tokens).
--
-- Existing rows: there is no production tenant with SsoConfig today
-- (SAML disabled per LESSONS.md). We therefore drop unencrypted columns
-- and add fresh encrypted ones; if any tenant had a row it must
-- re-paste their cert through the admin UI on next deploy. No
-- silent data loss because the operator is in the loop.
ALTER TABLE "sso_configs" DROP COLUMN IF EXISTS "idp_certificate";
ALTER TABLE "sso_configs" ADD COLUMN "idp_certificate_enc" TEXT NOT NULL DEFAULT '';
ALTER TABLE "sso_configs" DROP COLUMN IF EXISTS "sp_private_key";
ALTER TABLE "sso_configs" ADD COLUMN "sp_private_key_enc" TEXT;
ALTER TABLE "sso_configs" ALTER COLUMN "idp_certificate_enc" DROP DEFAULT;
