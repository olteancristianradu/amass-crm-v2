-- Audit finding: 40 tenant-scoped tables were missing RLS policies. This
-- migration closes the gap so Layer 3 of defense-in-depth covers every
-- tenant-scoped table (not just ~48%). `current_tenant_id()` was defined
-- in 20260407210058_audit_log — we reuse it here.
--
-- Pattern:
--   ENABLE ROW LEVEL SECURITY      — turn on the mechanism
--   FORCE  ROW LEVEL SECURITY      — apply to the table owner too; without
--                                    FORCE, `postgres` bypasses policies
--   CREATE POLICY tenant_isolation_<t> ... USING / WITH CHECK
--     current_tenant_id() IS NULL allows pre-auth queries (slug lookup,
--     seed scripts) to proceed; the app switches to `app_user` inside
--     runWithTenant which triggers the enforcement path.
--   GRANT … TO app_user             — the application role needs CRUD
--                                    access; owner bypass is blocked by FORCE.
--
-- 35 tables with a direct tenant_id column + 5 indirect (child of a
-- tenant-scoped parent) use a subquery against the parent table.

-- ─── Direct tenant_id tables (35) ──────────────────────────────────────────
ALTER TABLE "anaf_submissions"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "anaf_submissions"        FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_anaf_submissions ON "anaf_submissions"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "approval_decisions"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_decisions"      FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_approval_decisions ON "approval_decisions"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "approval_policies"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_policies"       FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_approval_policies ON "approval_policies"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "approval_requests"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_requests"       FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_approval_requests ON "approval_requests"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "billing_subscriptions"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_subscriptions"   FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_billing_subscriptions ON "billing_subscriptions"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "calendar_events"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_events"         FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_calendar_events ON "calendar_events"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "calendar_integrations"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_integrations"   FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_calendar_integrations ON "calendar_integrations"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "campaigns"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns"               FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_campaigns ON "campaigns"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "cases"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cases"                   FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_cases ON "cases"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "contact_segments"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_segments"        FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_contact_segments ON "contact_segments"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "contracts"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contracts"               FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_contracts ON "contracts"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "custom_field_defs"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_defs"       FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_custom_field_defs ON "custom_field_defs"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "custom_field_values"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_values"     FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_custom_field_values ON "custom_field_values"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "data_exports"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_exports"            FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_data_exports ON "data_exports"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "email_sequence_steps"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_sequence_steps"    FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_email_sequence_steps ON "email_sequence_steps"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "email_sequences"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_sequences"         FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_email_sequences ON "email_sequences"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "forecast_quotas"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forecast_quotas"         FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_forecast_quotas ON "forecast_quotas"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "lead_scores"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_scores"             FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_lead_scores ON "lead_scores"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "leads"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads"                   FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_leads ON "leads"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "notifications"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications"           FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_notifications ON "notifications"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "orders"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"                  FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_orders ON "orders"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "portal_tokens"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_tokens"           FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_portal_tokens ON "portal_tokens"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "price_list_items"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_list_items"        FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_price_list_items ON "price_list_items"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "price_lists"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_lists"             FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_price_lists ON "price_lists"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "product_categories"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_categories"      FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_product_categories ON "product_categories"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "products"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products"                FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_products ON "products"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "quote_lines"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_lines"             FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_quote_lines ON "quote_lines"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "quotes"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotes"                  FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_quotes ON "quotes"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "report_templates"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_templates"        FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_report_templates ON "report_templates"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "sequence_enrollments"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sequence_enrollments"    FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sequence_enrollments ON "sequence_enrollments"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "sms_messages"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sms_messages"            FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sms_messages ON "sms_messages"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "sso_configs"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sso_configs"             FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sso_configs ON "sso_configs"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "webhook_endpoints"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_endpoints"       FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_webhook_endpoints ON "webhook_endpoints"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "whatsapp_accounts"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_accounts"       FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_whatsapp_accounts ON "whatsapp_accounts"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

ALTER TABLE "whatsapp_messages"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_messages"       FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_whatsapp_messages ON "whatsapp_messages"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

-- ─── Indirect tables (5): enforce via parent's tenant_id ───────────────────
-- events is already RLS'd from a prior migration.
ALTER TABLE "event_attendees"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_attendees"         FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_event_attendees ON "event_attendees"
  USING (
    current_tenant_id() IS NULL OR
    event_id IN (SELECT id FROM "events" WHERE "tenant_id" = current_tenant_id())
  )
  WITH CHECK (
    current_tenant_id() IS NULL OR
    event_id IN (SELECT id FROM "events" WHERE "tenant_id" = current_tenant_id())
  );

-- orders just got RLS above; order_items inherits via order_id FK.
ALTER TABLE "order_items"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items"             FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_order_items ON "order_items"
  USING (
    current_tenant_id() IS NULL OR
    order_id IN (SELECT id FROM "orders" WHERE "tenant_id" = current_tenant_id())
  )
  WITH CHECK (
    current_tenant_id() IS NULL OR
    order_id IN (SELECT id FROM "orders" WHERE "tenant_id" = current_tenant_id())
  );

-- product_bundles already has RLS; product_bundle_items inherits via bundle_id.
ALTER TABLE "product_bundle_items"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_bundle_items"    FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_product_bundle_items ON "product_bundle_items"
  USING (
    current_tenant_id() IS NULL OR
    bundle_id IN (SELECT id FROM "product_bundles" WHERE "tenant_id" = current_tenant_id())
  )
  WITH CHECK (
    current_tenant_id() IS NULL OR
    bundle_id IN (SELECT id FROM "product_bundles" WHERE "tenant_id" = current_tenant_id())
  );

-- territories already has RLS; territory_assignments inherits via territory_id.
ALTER TABLE "territory_assignments"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "territory_assignments"   FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_territory_assignments ON "territory_assignments"
  USING (
    current_tenant_id() IS NULL OR
    territory_id IN (SELECT id FROM "territories" WHERE "tenant_id" = current_tenant_id())
  )
  WITH CHECK (
    current_tenant_id() IS NULL OR
    territory_id IN (SELECT id FROM "territories" WHERE "tenant_id" = current_tenant_id())
  );

-- webhook_endpoints just got RLS above; webhook_deliveries inherits via endpoint_id.
ALTER TABLE "webhook_deliveries"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_deliveries"      FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_webhook_deliveries ON "webhook_deliveries"
  USING (
    current_tenant_id() IS NULL OR
    endpoint_id IN (SELECT id FROM "webhook_endpoints" WHERE "tenant_id" = current_tenant_id())
  )
  WITH CHECK (
    current_tenant_id() IS NULL OR
    endpoint_id IN (SELECT id FROM "webhook_endpoints" WHERE "tenant_id" = current_tenant_id())
  );

-- ─── GRANT CRUD to app_user (FORCE RLS blocks owner bypass, so we must
-- grant explicitly) ─────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "anaf_submissions",
  "approval_decisions",
  "approval_policies",
  "approval_requests",
  "billing_subscriptions",
  "calendar_events",
  "calendar_integrations",
  "campaigns",
  "cases",
  "contact_segments",
  "contracts",
  "custom_field_defs",
  "custom_field_values",
  "data_exports",
  "email_sequence_steps",
  "email_sequences",
  "event_attendees",
  "forecast_quotas",
  "lead_scores",
  "leads",
  "notifications",
  "order_items",
  "orders",
  "portal_tokens",
  "price_list_items",
  "price_lists",
  "product_bundle_items",
  "product_categories",
  "products",
  "quote_lines",
  "quotes",
  "report_templates",
  "sequence_enrollments",
  "sms_messages",
  "sso_configs",
  "territory_assignments",
  "webhook_deliveries",
  "webhook_endpoints",
  "whatsapp_accounts",
  "whatsapp_messages"
TO app_user;
