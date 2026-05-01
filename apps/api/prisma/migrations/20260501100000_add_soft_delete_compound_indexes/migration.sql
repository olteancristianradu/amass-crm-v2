-- P0-4 (audit 4-agent): add (tenantId, deletedAt) compound index on 35 soft-delete models.
-- Without this, every list-page query on a tenant with 10k+ rows scans the whole table.
-- Index name format: idx_{table}_tenant_deleted

CREATE INDEX IF NOT EXISTS "idx_companies_tenant_deleted" ON "companies" ("tenantId", "deletedAt");
CREATE INDEX IF NOT EXISTS "idx_contacts_tenant_deleted" ON "contacts" ("tenantId", "deletedAt");
CREATE INDEX IF NOT EXISTS "idx_clients_tenant_deleted" ON "clients" ("tenantId", "deletedAt");
CREATE INDEX IF NOT EXISTS "idx_attachments_tenant_deleted" ON "attachments" ("tenantId", "deletedAt");
CREATE INDEX IF NOT EXISTS "idx_notes_tenant_deleted" ON "notes" ("tenantId", "deletedAt");
CREATE INDEX IF NOT EXISTS "idx_reminders_tenant_deleted" ON "reminders" ("tenantId", "deletedAt");
CREATE INDEX IF NOT EXISTS "idx_pipelines_tenant_deleted" ON "pipelines" ("tenantId", "deletedAt");
CREATE INDEX IF NOT EXISTS "idx_pipeline_stages_tenant_deleted" ON "pipeline_stages" ("tenantId", "deletedAt");
CREATE INDEX IF NOT EXISTS "idx_deals_tenant_deleted" ON "deals" ("tenantId", "deletedAt");
CREATE INDEX IF NOT EXISTS "idx_tasks_tenant_deleted" ON "tasks" ("tenantId", "deletedAt");
CREATE INDEX IF NOT EXISTS "idx_email_accounts_tenant_deleted" ON "email_accounts" ("tenantId", "deletedAt");
CREATE INDEX IF NOT EXISTS "idx_phone_numbers_tenant_deleted" ON "phone_numbers" ("tenantId", "deletedAt");
CREATE INDEX IF NOT EXISTS "idx_calls_tenant_deleted" ON "calls" ("tenantId", "deletedAt");
CREATE INDEX IF NOT EXISTS "idx_workflows_tenant_deleted" ON "workflows" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_invoices_tenant_deleted" ON "invoices" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_payments_tenant_deleted" ON "payments" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_projects_tenant_deleted" ON "projects" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_quotes_tenant_deleted" ON "quotes" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_email_sequences_tenant_deleted" ON "email_sequences" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_product_categories_tenant_deleted" ON "product_categories" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_products_tenant_deleted" ON "products" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_price_lists_tenant_deleted" ON "price_lists" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_custom_field_defs_tenant_deleted" ON "custom_field_defs" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_approval_policies_tenant_deleted" ON "approval_policies" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_whatsapp_accounts_tenant_deleted" ON "whatsapp_accounts" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_calendar_integrations_tenant_deleted" ON "calendar_integrations" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_report_templates_tenant_deleted" ON "report_templates" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_leads_tenant_deleted" ON "leads" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_contracts_tenant_deleted" ON "contracts" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_customer_subscriptions_tenant_deleted" ON "customer_subscriptions" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_cases_tenant_deleted" ON "cases" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_orders_tenant_deleted" ON "orders" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_campaigns_tenant_deleted" ON "campaigns" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_chatter_posts_tenant_deleted" ON "chatter_posts" ("tenant_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "idx_events_tenant_deleted" ON "events" ("tenant_id", "deleted_at");
