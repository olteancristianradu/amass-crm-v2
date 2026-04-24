-- Schema catch-up migration.
--
-- Prior sessions edited prisma/schema.prisma directly without running
-- `prisma migrate dev`. Result: the schema declared 14 enums and many
-- index/FK renames that existed nowhere in the migrations folder, so
-- `prisma migrate diff --from-migrations --to-schema-datamodel` refused
-- to pass in CI.
--
-- This file realigns migrations with the schema. It is DATA-PRESERVING
-- wherever Prisma's auto-generator wanted to DROP/ADD a column (for
-- text→enum conversions): we use `ALTER COLUMN ... TYPE <enum> USING
-- (value::text::<enum>)` instead. If a row contains a value that is
-- not a valid enum variant the ALTER fails with a clear error — that's
-- the correct behaviour (fail loud rather than silently truncate).
--
-- For timestamp columns Prisma wants `TIMESTAMP(3)` (without time zone);
-- some earlier hand-written migrations used `TIMESTAMPTZ(6)`. Converting
-- under a UTC session is bit-safe because Prisma Client serialises all
-- `DateTime` values as UTC. Set `SET LOCAL timezone = 'UTC'` at the top
-- to guarantee that regardless of the running session's default.

SET LOCAL timezone = 'UTC';

-- ──────────────────────────────────────────────────────────────────────────
-- 1. New enum types (additive, safe)
-- ──────────────────────────────────────────────────────────────────────────

CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED');
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'RENEWED');
CREATE TYPE "ForecastPeriodType" AS ENUM ('MONTHLY', 'QUARTERLY');
CREATE TYPE "CustomerSubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "CaseStatus" AS ENUM ('NEW', 'OPEN', 'PENDING', 'RESOLVED', 'CLOSED');
CREATE TYPE "CasePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED');
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED');
CREATE TYPE "CampaignChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP', 'MIXED');
CREATE TYPE "ValidationEntityType" AS ENUM ('COMPANY', 'CONTACT', 'CLIENT', 'DEAL', 'LEAD', 'CASE', 'ORDER');
CREATE TYPE "ValidationOperator" AS ENUM ('REGEX', 'MIN_LENGTH', 'MAX_LENGTH', 'EQUALS', 'NOT_EQUALS');
CREATE TYPE "ChatterSubjectType" AS ENUM ('COMPANY', 'CONTACT', 'CLIENT', 'DEAL', 'LEAD', 'CASE', 'ORDER', 'PROJECT');
CREATE TYPE "EventKind" AS ENUM ('CONFERENCE', 'WEBINAR', 'WORKSHOP', 'MEETUP');
CREATE TYPE "EventAttendeeStatus" AS ENUM ('INVITED', 'REGISTERED', 'ATTENDED', 'CANCELLED');

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Drop foreign keys that will be re-added with canonical names later.
--    Prisma expects `<table>_<col>_fkey` naming; some hand-written migrations
--    used custom names.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "event_attendees" DROP CONSTRAINT IF EXISTS "event_attendees_event_id_fkey";
ALTER TABLE "invoice_lines" DROP CONSTRAINT IF EXISTS "invoice_lines_product_id_fkey";
ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "order_items_order_id_fkey";
ALTER TABLE "product_bundle_items" DROP CONSTRAINT IF EXISTS "product_bundle_items_bundle_id_fkey";
ALTER TABLE "quote_lines" DROP CONSTRAINT IF EXISTS "quote_lines_product_id_fkey";
ALTER TABLE "territory_assignments" DROP CONSTRAINT IF EXISTS "territory_assignments_territory_id_fkey";
ALTER TABLE "webhook_deliveries" DROP CONSTRAINT IF EXISTS "webhook_deliveries_endpoint_id_fkey";
ALTER TABLE "workflow_runs" DROP CONSTRAINT IF EXISTS "workflow_runs_workflow_id_fkey";
ALTER TABLE "workflow_steps" DROP CONSTRAINT IF EXISTS "workflow_steps_workflow_id_fkey";

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Drop the legacy pgvector HNSW indexes — schema no longer annotates the
--    embedding columns with @@index, so they don't belong in migrations.
--    (The columns themselves remain; only the indexes go.)
-- ──────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS "clients_embedding_hnsw_idx";
DROP INDEX IF EXISTS "companies_embedding_hnsw_idx";
DROP INDEX IF EXISTS "contacts_embedding_hnsw_idx";

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Timestamp precision normalisation (timestamptz(6) → timestamp(3)).
--    Safe under UTC session: Prisma Client treats all DateTime values as
--    UTC, so the timezone label is redundant metadata, not lost data.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "billing_subscriptions"
  ALTER COLUMN "id" DROP DEFAULT,
  ALTER COLUMN "trial_ends_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "current_period_start" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "current_period_end" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- campaigns: enum conversion + timestamps
ALTER TABLE "campaigns"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" SET DATA TYPE "CampaignStatus" USING ("status"::text::"CampaignStatus"),
  ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"CampaignStatus",
  ALTER COLUMN "channel" DROP DEFAULT,
  ALTER COLUMN "channel" SET DATA TYPE "CampaignChannel" USING ("channel"::text::"CampaignChannel"),
  ALTER COLUMN "channel" SET DEFAULT 'EMAIL'::"CampaignChannel",
  ALTER COLUMN "start_date" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "end_date" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMP(3);

-- cases: enum conversion (status + priority) + timestamps
ALTER TABLE "cases"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" SET DATA TYPE "CaseStatus" USING ("status"::text::"CaseStatus"),
  ALTER COLUMN "status" SET DEFAULT 'NEW'::"CaseStatus",
  ALTER COLUMN "priority" DROP DEFAULT,
  ALTER COLUMN "priority" SET DATA TYPE "CasePriority" USING ("priority"::text::"CasePriority"),
  ALTER COLUMN "priority" SET DEFAULT 'NORMAL'::"CasePriority",
  ALTER COLUMN "sla_deadline" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "resolved_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMP(3);

-- chatter_posts: subject_type enum conversion (NOT NULL, no default)
ALTER TABLE "chatter_posts"
  ALTER COLUMN "subject_type" SET DATA TYPE "ChatterSubjectType" USING ("subject_type"::text::"ChatterSubjectType"),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "commission_plans"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "commissions"
  ALTER COLUMN "paid_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- contracts: enum conversion + timestamps
ALTER TABLE "contracts"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" SET DATA TYPE "ContractStatus" USING ("status"::text::"ContractStatus"),
  ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"ContractStatus",
  ALTER COLUMN "signed_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "start_date" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "end_date" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "renewal_date" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMP(3);

-- customer_subscriptions: enum conversion + timestamps
ALTER TABLE "customer_subscriptions"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" SET DATA TYPE "CustomerSubscriptionStatus" USING ("status"::text::"CustomerSubscriptionStatus"),
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"CustomerSubscriptionStatus",
  ALTER COLUMN "start_date" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "end_date" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "cancelled_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "data_exports"
  ALTER COLUMN "id" DROP DEFAULT,
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "completed_at" SET DATA TYPE TIMESTAMP(3);

-- event_attendees: status enum (default 'INVITED')
ALTER TABLE "event_attendees"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" SET DATA TYPE "EventAttendeeStatus" USING ("status"::text::"EventAttendeeStatus"),
  ALTER COLUMN "status" SET DEFAULT 'INVITED'::"EventAttendeeStatus",
  ALTER COLUMN "registered_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "attended_at" SET DATA TYPE TIMESTAMP(3);

-- events: kind enum (default 'CONFERENCE')
ALTER TABLE "events"
  ALTER COLUMN "kind" DROP DEFAULT,
  ALTER COLUMN "kind" SET DATA TYPE "EventKind" USING ("kind"::text::"EventKind"),
  ALTER COLUMN "kind" SET DEFAULT 'CONFERENCE'::"EventKind",
  ALTER COLUMN "start_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "end_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMP(3);

-- forecast_quotas: period_type enum (default 'MONTHLY')
ALTER TABLE "forecast_quotas"
  ALTER COLUMN "period_type" DROP DEFAULT,
  ALTER COLUMN "period_type" SET DATA TYPE "ForecastPeriodType" USING ("period_type"::text::"ForecastPeriodType"),
  ALTER COLUMN "period_type" SET DEFAULT 'MONTHLY'::"ForecastPeriodType",
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- formula_fields: entity_type enum (NOT NULL, no default).
-- Schema declares this column as ValidationEntityType (not
-- CustomFieldEntityType — the naming is confusing because the model
-- reuses the validation-rules enum). Existing TEXT rows must match
-- one of COMPANY/CONTACT/CLIENT/DEAL/LEAD/CASE/ORDER.
ALTER TABLE "formula_fields"
  ALTER COLUMN "entity_type" SET DATA TYPE "ValidationEntityType" USING ("entity_type"::text::"ValidationEntityType"),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- leads: source (nullable) + status (NOT NULL default NEW)
ALTER TABLE "leads"
  ALTER COLUMN "source" SET DATA TYPE "LeadSource" USING (CASE WHEN "source" IS NULL THEN NULL ELSE "source"::text::"LeadSource" END),
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" SET DATA TYPE "LeadStatus" USING ("status"::text::"LeadStatus"),
  ALTER COLUMN "status" SET DEFAULT 'NEW'::"LeadStatus",
  ALTER COLUMN "converted_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "notifications"
  ALTER COLUMN "id" DROP DEFAULT,
  ALTER COLUMN "read_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- orders: status enum (default 'DRAFT')
ALTER TABLE "orders"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" SET DATA TYPE "OrderStatus" USING ("status"::text::"OrderStatus"),
  ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"OrderStatus",
  ALTER COLUMN "confirmed_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "fulfilled_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "cancelled_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "product_bundles"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "product_variants"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "sms_messages"
  ALTER COLUMN "id" DROP DEFAULT,
  ALTER COLUMN "sent_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "territories"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "territory_assignments"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- validation_rules: two enum conversions, both NOT NULL no default
ALTER TABLE "validation_rules"
  ALTER COLUMN "entity_type" SET DATA TYPE "ValidationEntityType" USING ("entity_type"::text::"ValidationEntityType"),
  ALTER COLUMN "operator" SET DATA TYPE "ValidationOperator" USING ("operator"::text::"ValidationOperator"),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "webhook_deliveries"
  ALTER COLUMN "id" DROP DEFAULT,
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "webhook_endpoints"
  ALTER COLUMN "id" DROP DEFAULT,
  ALTER COLUMN "events" DROP DEFAULT,
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "workflow_runs"
  ALTER COLUMN "started_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "completed_at" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "workflow_steps"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "workflows"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
  ALTER COLUMN "deleted_at" SET DATA TYPE TIMESTAMP(3);

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Re-add foreign keys under their canonical Prisma names.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_id_fkey"
  FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_fkey"
  FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey"
  FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_bundle_items" ADD CONSTRAINT "product_bundle_items_bundle_id_fkey"
  FOREIGN KEY ("bundle_id") REFERENCES "product_bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "territory_assignments" ADD CONSTRAINT "territory_assignments_territory_id_fkey"
  FOREIGN KEY ("territory_id") REFERENCES "territories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. Index renames (cosmetic but required by Prisma's naming convention).
-- ──────────────────────────────────────────────────────────────────────────

ALTER INDEX "calendar_events_integration_external_key" RENAME TO "calendar_events_integration_id_external_id_key";
ALTER INDEX "calendar_events_tenant_integration_idx" RENAME TO "calendar_events_tenant_id_integration_id_idx";
ALTER INDEX "calendar_events_tenant_subject_idx" RENAME TO "calendar_events_tenant_id_subjectType_subject_id_idx";
ALTER INDEX "calendar_integrations_tenant_user_idx" RENAME TO "calendar_integrations_tenant_id_user_id_idx";
ALTER INDEX "calendar_integrations_tenant_user_provider_key" RENAME TO "calendar_integrations_tenant_id_user_id_provider_key";
ALTER INDEX "idx_campaigns_tenant_created" RENAME TO "campaigns_tenant_id_created_at_idx";
ALTER INDEX "idx_campaigns_tenant_status" RENAME TO "campaigns_tenant_id_status_idx";
ALTER INDEX "idx_cases_tenant_assignee" RENAME TO "cases_tenant_id_assignee_id_idx";
ALTER INDEX "idx_cases_tenant_company" RENAME TO "cases_tenant_id_company_id_idx";
ALTER INDEX "idx_cases_tenant_status" RENAME TO "cases_tenant_id_status_idx";
ALTER INDEX "idx_chatter_subject" RENAME TO "chatter_posts_tenant_id_subject_type_subject_id_created_at_idx";
ALTER INDEX "companies_tenant_id_relationship_status_idx" RENAME TO "companies_tenantId_relationship_status_idx";
ALTER INDEX "idx_contracts_end_date" RENAME TO "contracts_tenant_id_end_date_idx";
ALTER INDEX "idx_contracts_tenant_company" RENAME TO "contracts_tenant_id_company_id_idx";
ALTER INDEX "idx_contracts_tenant_status" RENAME TO "contracts_tenant_id_status_idx";
ALTER INDEX "idx_customer_subs_tenant_company" RENAME TO "customer_subscriptions_tenant_id_company_id_idx";
ALTER INDEX "idx_customer_subs_tenant_status" RENAME TO "customer_subscriptions_tenant_id_status_idx";
ALTER INDEX "data_exports_tenant_requester_idx" RENAME TO "data_exports_tenant_id_requested_by_id_idx";
ALTER INDEX "idx_event_attendees_event" RENAME TO "event_attendees_event_id_idx";
ALTER INDEX "idx_events_tenant_start" RENAME TO "events_tenant_id_start_at_idx";
ALTER INDEX "lead_scores_tenant_entity_type_entity_id_key" RENAME TO "lead_scores_tenant_id_entity_type_entity_id_key";
ALTER INDEX "lead_scores_tenant_type_score_idx" RENAME TO "lead_scores_tenant_id_entity_type_score_idx";
ALTER INDEX "idx_leads_tenant_created" RENAME TO "leads_tenant_id_created_at_idx";
ALTER INDEX "idx_leads_tenant_owner" RENAME TO "leads_tenant_id_owner_id_idx";
ALTER INDEX "idx_leads_tenant_status" RENAME TO "leads_tenant_id_status_idx";
ALTER INDEX "notifications_tenant_user_read_idx" RENAME TO "notifications_tenant_id_user_id_is_read_created_at_idx";
ALTER INDEX "idx_order_items_order" RENAME TO "order_items_order_id_idx";
ALTER INDEX "idx_orders_tenant_company" RENAME TO "orders_tenant_id_company_id_idx";
ALTER INDEX "idx_orders_tenant_status" RENAME TO "orders_tenant_id_status_idx";
ALTER INDEX "portal_tokens_tenant_email_idx" RENAME TO "portal_tokens_tenant_id_email_idx";
ALTER INDEX "idx_product_bundle_items_bundle" RENAME TO "product_bundle_items_bundle_id_idx";
ALTER INDEX "idx_product_variants_product" RENAME TO "product_variants_product_id_idx";
ALTER INDEX "report_templates_tenant_created_by_idx" RENAME TO "report_templates_tenant_id_created_by_id_idx";
ALTER INDEX "report_templates_tenant_entity_idx" RENAME TO "report_templates_tenant_id_entity_type_idx";
ALTER INDEX "sms_messages_tenant_contact_idx" RENAME TO "sms_messages_tenant_id_contact_id_idx";
ALTER INDEX "sms_messages_tenant_dir_idx" RENAME TO "sms_messages_tenant_id_direction_created_at_idx";
ALTER INDEX "idx_validation_rules_tenant_entity" RENAME TO "validation_rules_tenant_id_entity_type_is_active_idx";
ALTER INDEX "webhook_deliveries_endpoint_idx" RENAME TO "webhook_deliveries_endpoint_id_created_at_idx";
ALTER INDEX "webhook_endpoints_tenant_idx" RENAME TO "webhook_endpoints_tenant_id_idx";
ALTER INDEX "whatsapp_messages_tenant_account_idx" RENAME TO "whatsapp_messages_tenant_id_account_id_idx";
ALTER INDEX "whatsapp_messages_tenant_subject_idx" RENAME TO "whatsapp_messages_tenant_id_subjectType_subject_id_created__idx";
ALTER INDEX "idx_workflow_runs_subject" RENAME TO "workflow_runs_tenant_id_subject_type_subject_id_idx";
ALTER INDEX "idx_workflow_runs_tenant" RENAME TO "workflow_runs_tenant_id_workflow_id_status_idx";
ALTER INDEX "idx_workflow_steps_workflow" RENAME TO "workflow_steps_workflow_id_order_idx";
ALTER INDEX "idx_workflows_tenant" RENAME TO "workflows_tenant_id_is_active_idx";

-- ──────────────────────────────────────────────────────────────────────────
-- 7. Convert two inline UNIQUE(...) table constraints into standalone
--    UNIQUE INDEX objects. The logical constraint is unchanged (same
--    columns, same name); we only swap the Postgres object kind from
--    CONSTRAINT to INDEX because Prisma's `@@unique([...])` declarations
--    expect the latter. Without this, `prisma migrate diff` keeps
--    flagging "added unique index" on every CI run.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE "forecast_quotas"
  DROP CONSTRAINT "forecast_quotas_tenant_id_user_id_year_period_period_type_key";
CREATE UNIQUE INDEX "forecast_quotas_tenant_id_user_id_year_period_period_type_key"
  ON "forecast_quotas"("tenant_id", "user_id", "year", "period", "period_type");

ALTER TABLE "formula_fields"
  DROP CONSTRAINT "formula_fields_tenant_id_entity_type_field_name_key";
CREATE UNIQUE INDEX "formula_fields_tenant_id_entity_type_field_name_key"
  ON "formula_fields"("tenant_id", "entity_type", "field_name");
