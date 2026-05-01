-- CreateIndex
CREATE INDEX "contacts_tenantId_email_idx" ON "contacts"("tenantId", "email");

-- CreateIndex
CREATE INDEX "leads_tenant_id_email_idx" ON "leads"("tenant_id", "email");

-- RenameIndex
ALTER INDEX "idx_approval_policies_tenant_deleted" RENAME TO "approval_policies_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_attachments_tenant_deleted" RENAME TO "attachments_tenantId_deletedAt_idx";

-- RenameIndex
ALTER INDEX "idx_calendar_integrations_tenant_deleted" RENAME TO "calendar_integrations_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_calls_tenant_deleted" RENAME TO "calls_tenantId_deletedAt_idx";

-- RenameIndex
ALTER INDEX "idx_campaigns_tenant_deleted" RENAME TO "campaigns_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_cases_tenant_deleted" RENAME TO "cases_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_chatter_posts_tenant_deleted" RENAME TO "chatter_posts_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_clients_tenant_deleted" RENAME TO "clients_tenantId_deletedAt_idx";

-- RenameIndex
ALTER INDEX "idx_companies_tenant_deleted" RENAME TO "companies_tenantId_deletedAt_idx";

-- RenameIndex
ALTER INDEX "idx_contacts_tenant_deleted" RENAME TO "contacts_tenantId_deletedAt_idx";

-- RenameIndex
ALTER INDEX "idx_contracts_tenant_deleted" RENAME TO "contracts_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_custom_field_defs_tenant_deleted" RENAME TO "custom_field_defs_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_customer_subscriptions_tenant_deleted" RENAME TO "customer_subscriptions_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_deals_tenant_deleted" RENAME TO "deals_tenantId_deletedAt_idx";

-- RenameIndex
ALTER INDEX "idx_email_accounts_tenant_deleted" RENAME TO "email_accounts_tenantId_deletedAt_idx";

-- RenameIndex
ALTER INDEX "idx_email_sequences_tenant_deleted" RENAME TO "email_sequences_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_event_attendees_tenant" RENAME TO "event_attendees_tenant_id_idx";

-- RenameIndex
ALTER INDEX "idx_events_tenant_deleted" RENAME TO "events_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_invoices_tenant_deleted" RENAME TO "invoices_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_leads_tenant_deleted" RENAME TO "leads_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_notes_tenant_deleted" RENAME TO "notes_tenantId_deletedAt_idx";

-- RenameIndex
ALTER INDEX "idx_order_items_tenant" RENAME TO "order_items_tenant_id_idx";

-- RenameIndex
ALTER INDEX "idx_orders_tenant_deleted" RENAME TO "orders_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_payments_tenant_deleted" RENAME TO "payments_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_phone_numbers_tenant_deleted" RENAME TO "phone_numbers_tenantId_deletedAt_idx";

-- RenameIndex
ALTER INDEX "idx_pipeline_stages_tenant_deleted" RENAME TO "pipeline_stages_tenantId_deletedAt_idx";

-- RenameIndex
ALTER INDEX "idx_pipelines_tenant_deleted" RENAME TO "pipelines_tenantId_deletedAt_idx";

-- RenameIndex
ALTER INDEX "idx_price_lists_tenant_deleted" RENAME TO "price_lists_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_product_bundle_items_tenant" RENAME TO "product_bundle_items_tenant_id_idx";

-- RenameIndex
ALTER INDEX "idx_product_categories_tenant_deleted" RENAME TO "product_categories_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_products_tenant_deleted" RENAME TO "products_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_projects_tenant_deleted" RENAME TO "projects_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_quotes_tenant_deleted" RENAME TO "quotes_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_reminders_tenant_deleted" RENAME TO "reminders_tenantId_deletedAt_idx";

-- RenameIndex
ALTER INDEX "idx_report_templates_tenant_deleted" RENAME TO "report_templates_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_tasks_tenant_deleted" RENAME TO "tasks_tenantId_deletedAt_idx";

-- RenameIndex
ALTER INDEX "idx_territory_assignments_tenant" RENAME TO "territory_assignments_tenant_id_idx";

-- RenameIndex
ALTER INDEX "idx_webhook_deliveries_tenant" RENAME TO "webhook_deliveries_tenant_id_idx";

-- RenameIndex
ALTER INDEX "idx_whatsapp_accounts_tenant_deleted" RENAME TO "whatsapp_accounts_tenant_id_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_workflows_tenant_deleted" RENAME TO "workflows_tenant_id_deleted_at_idx";
