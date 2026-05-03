-- Secure WhatsApp webhook verification and close tenant-scope gaps for new models.

-- WhatsApp Cloud API signs inbound webhooks with the Meta App Secret over
-- the raw request body. The verify token is only for the initial webhook
-- challenge, so keep a separate encrypted app-secret field.
ALTER TABLE "whatsapp_accounts"
  ADD COLUMN IF NOT EXISTS "meta_app_secret_enc" TEXT;

-- Tags, entity_tags, and outlook_tokens were added after the last RLS sweep.
-- They all carry tenant_id and must be covered by the same defense layer as
-- other tenant-scoped tables.
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tags" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tags ON "tags";
CREATE POLICY tenant_isolation_tags ON "tags"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "entity_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "entity_tags" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_entity_tags ON "entity_tags";
CREATE POLICY tenant_isolation_entity_tags ON "entity_tags"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "outlook_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outlook_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_outlook_tokens ON "outlook_tokens";
CREATE POLICY tenant_isolation_outlook_tokens ON "outlook_tokens"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tags" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "entity_tags" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "outlook_tokens" TO app_user;
