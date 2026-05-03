-- Rename legacy hand-written indexes after the migrations that create them.
--
-- 20260501082407 originally tried to rename these before
-- 20260501100000_add_soft_delete_compound_indexes and
-- 20260501110000_add_tenant_id_sub_models had created them. A clean
-- `prisma migrate deploy` therefore failed in CI. Keep each rename
-- idempotent so existing databases that already have the final names do not
-- fail when applying this catch-up migration.

CREATE OR REPLACE FUNCTION _amass_rename_index_if_needed(old_name text, new_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass(format('public.%I', old_name)) IS NOT NULL
     AND to_regclass(format('public.%I', new_name)) IS NULL THEN
    EXECUTE format('ALTER INDEX %I RENAME TO %I', old_name, new_name);
  END IF;
END;
$$;

SELECT _amass_rename_index_if_needed('idx_approval_policies_tenant_deleted', 'approval_policies_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_attachments_tenant_deleted', 'attachments_tenantId_deletedAt_idx');
SELECT _amass_rename_index_if_needed('idx_calendar_integrations_tenant_deleted', 'calendar_integrations_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_calls_tenant_deleted', 'calls_tenantId_deletedAt_idx');
SELECT _amass_rename_index_if_needed('idx_campaigns_tenant_deleted', 'campaigns_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_cases_tenant_deleted', 'cases_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_chatter_posts_tenant_deleted', 'chatter_posts_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_clients_tenant_deleted', 'clients_tenantId_deletedAt_idx');
SELECT _amass_rename_index_if_needed('idx_companies_tenant_deleted', 'companies_tenantId_deletedAt_idx');
SELECT _amass_rename_index_if_needed('idx_contacts_tenant_deleted', 'contacts_tenantId_deletedAt_idx');
SELECT _amass_rename_index_if_needed('idx_contracts_tenant_deleted', 'contracts_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_custom_field_defs_tenant_deleted', 'custom_field_defs_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_customer_subscriptions_tenant_deleted', 'customer_subscriptions_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_deals_tenant_deleted', 'deals_tenantId_deletedAt_idx');
SELECT _amass_rename_index_if_needed('idx_email_accounts_tenant_deleted', 'email_accounts_tenantId_deletedAt_idx');
SELECT _amass_rename_index_if_needed('idx_email_sequences_tenant_deleted', 'email_sequences_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_event_attendees_tenant', 'event_attendees_tenant_id_idx');
SELECT _amass_rename_index_if_needed('idx_events_tenant_deleted', 'events_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_invoices_tenant_deleted', 'invoices_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_leads_tenant_deleted', 'leads_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_notes_tenant_deleted', 'notes_tenantId_deletedAt_idx');
SELECT _amass_rename_index_if_needed('idx_order_items_tenant', 'order_items_tenant_id_idx');
SELECT _amass_rename_index_if_needed('idx_orders_tenant_deleted', 'orders_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_payments_tenant_deleted', 'payments_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_phone_numbers_tenant_deleted', 'phone_numbers_tenantId_deletedAt_idx');
SELECT _amass_rename_index_if_needed('idx_pipeline_stages_tenant_deleted', 'pipeline_stages_tenantId_deletedAt_idx');
SELECT _amass_rename_index_if_needed('idx_pipelines_tenant_deleted', 'pipelines_tenantId_deletedAt_idx');
SELECT _amass_rename_index_if_needed('idx_price_lists_tenant_deleted', 'price_lists_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_product_bundle_items_tenant', 'product_bundle_items_tenant_id_idx');
SELECT _amass_rename_index_if_needed('idx_product_categories_tenant_deleted', 'product_categories_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_products_tenant_deleted', 'products_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_projects_tenant_deleted', 'projects_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_quotes_tenant_deleted', 'quotes_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_reminders_tenant_deleted', 'reminders_tenantId_deletedAt_idx');
SELECT _amass_rename_index_if_needed('idx_report_templates_tenant_deleted', 'report_templates_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_tasks_tenant_deleted', 'tasks_tenantId_deletedAt_idx');
SELECT _amass_rename_index_if_needed('idx_territory_assignments_tenant', 'territory_assignments_tenant_id_idx');
SELECT _amass_rename_index_if_needed('idx_webhook_deliveries_tenant', 'webhook_deliveries_tenant_id_idx');
SELECT _amass_rename_index_if_needed('idx_whatsapp_accounts_tenant_deleted', 'whatsapp_accounts_tenant_id_deleted_at_idx');
SELECT _amass_rename_index_if_needed('idx_workflows_tenant_deleted', 'workflows_tenant_id_deleted_at_idx');

DROP FUNCTION _amass_rename_index_if_needed(text, text);
