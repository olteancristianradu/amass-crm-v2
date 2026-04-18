-- S36 Custom Fields, S37 Approvals, S39 Products, S40 SSO — Tier 1 features

-- Enable pg_trgm for duplicate detection similarity queries
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── QuoteStatus: add PENDING_APPROVAL ────────────────────────────────────────
ALTER TYPE "QuoteStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL' BEFORE 'SENT';

-- ─── S39 Product Catalog ──────────────────────────────────────────────────────
CREATE TABLE "product_categories" (
  "id"         TEXT NOT NULL,
  "tenant_id"  TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "product_categories_tenant_id_idx" ON "product_categories"("tenant_id");

CREATE TABLE "products" (
  "id"            TEXT NOT NULL,
  "tenant_id"     TEXT NOT NULL,
  "category_id"   TEXT,
  "name"          TEXT NOT NULL,
  "sku"           TEXT,
  "description"   TEXT,
  "unit"          TEXT NOT NULL DEFAULT 'buc',
  "default_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "vat_rate"      DECIMAL(5,2) NOT NULL DEFAULT 19,
  "currency"      "InvoiceCurrency" NOT NULL DEFAULT 'RON',
  "is_active"     BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  "deleted_at"    TIMESTAMP(3),
  CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "products_tenant_id_is_active_idx" ON "products"("tenant_id", "is_active");
CREATE INDEX "products_tenant_id_category_id_idx" ON "products"("tenant_id", "category_id");
CREATE INDEX "products_tenant_id_sku_idx" ON "products"("tenant_id", "sku");

CREATE TABLE "price_lists" (
  "id"          TEXT NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "currency"    "InvoiceCurrency" NOT NULL DEFAULT 'RON',
  "is_default"  BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  "deleted_at"  TIMESTAMP(3),
  CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "price_lists_tenant_id_is_default_idx" ON "price_lists"("tenant_id", "is_default");

CREATE TABLE "price_list_items" (
  "id"           TEXT NOT NULL,
  "tenant_id"    TEXT NOT NULL,
  "price_list_id" TEXT NOT NULL,
  "product_id"   TEXT NOT NULL,
  "unit_price"   DECIMAL(14,2) NOT NULL,
  "min_quantity" DECIMAL(14,3) NOT NULL DEFAULT 1,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "price_list_items_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "price_list_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "price_list_items_price_list_id_product_id_min_quantity_key" UNIQUE ("price_list_id", "product_id", "min_quantity")
);
CREATE INDEX "price_list_items_tenant_id_price_list_id_idx" ON "price_list_items"("tenant_id", "price_list_id");

-- Add productId to quote_lines and invoice_lines
ALTER TABLE "quote_lines"   ADD COLUMN "product_id" TEXT REFERENCES "products"("id") ON DELETE SET NULL;
ALTER TABLE "invoice_lines" ADD COLUMN "product_id" TEXT REFERENCES "products"("id") ON DELETE SET NULL;

-- ─── S36 Custom Fields ────────────────────────────────────────────────────────
CREATE TYPE "CustomFieldEntityType" AS ENUM ('COMPANY', 'CONTACT', 'CLIENT', 'DEAL', 'QUOTE', 'INVOICE');
CREATE TYPE "CustomFieldType"       AS ENUM ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'MULTI_SELECT');

CREATE TABLE "custom_field_defs" (
  "id"          TEXT NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "entity_type" "CustomFieldEntityType" NOT NULL,
  "field_type"  "CustomFieldType"       NOT NULL,
  "name"        TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "options"     JSONB,
  "is_required" BOOLEAN NOT NULL DEFAULT FALSE,
  "order"       INTEGER NOT NULL DEFAULT 0,
  "is_active"   BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  "deleted_at"  TIMESTAMP(3),
  CONSTRAINT "custom_field_defs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "custom_field_defs_tenant_id_entity_type_name_key" UNIQUE ("tenant_id", "entity_type", "name")
);
CREATE INDEX "custom_field_defs_tenant_id_entity_type_is_active_idx" ON "custom_field_defs"("tenant_id", "entity_type", "is_active");

CREATE TABLE "custom_field_values" (
  "id"           TEXT NOT NULL,
  "tenant_id"    TEXT NOT NULL,
  "field_def_id" TEXT NOT NULL,
  "entity_id"    TEXT NOT NULL,
  "value"        TEXT NOT NULL,
  "updated_at"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "custom_field_values_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "custom_field_values_field_def_id_entity_id_key" UNIQUE ("field_def_id", "entity_id"),
  CONSTRAINT "custom_field_values_field_def_id_fkey" FOREIGN KEY ("field_def_id") REFERENCES "custom_field_defs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "custom_field_values_tenant_id_entity_id_idx" ON "custom_field_values"("tenant_id", "entity_id");

-- ─── S37 Approval Workflows ───────────────────────────────────────────────────
CREATE TYPE "ApprovalStatus"         AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ApprovalPolicyTrigger"  AS ENUM ('QUOTE_ABOVE_VALUE', 'DISCOUNT_ABOVE_PCT');

CREATE TABLE "approval_policies" (
  "id"          TEXT NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "trigger"     "ApprovalPolicyTrigger" NOT NULL,
  "config"      JSONB NOT NULL DEFAULT '{}',
  "approver_id" TEXT,
  "is_active"   BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  "deleted_at"  TIMESTAMP(3),
  CONSTRAINT "approval_policies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "approval_policies_tenant_id_is_active_idx" ON "approval_policies"("tenant_id", "is_active");

CREATE TABLE "approval_requests" (
  "id"           TEXT NOT NULL,
  "tenant_id"    TEXT NOT NULL,
  "policy_id"    TEXT NOT NULL,
  "quote_id"     TEXT NOT NULL,
  "requested_by" TEXT NOT NULL,
  "status"       "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "approval_requests_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "approval_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "approval_requests_tenant_id_quote_id_idx"  ON "approval_requests"("tenant_id", "quote_id");
CREATE INDEX "approval_requests_tenant_id_status_idx"    ON "approval_requests"("tenant_id", "status");

CREATE TABLE "approval_decisions" (
  "id"         TEXT NOT NULL,
  "tenant_id"  TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "decider_id" TEXT NOT NULL,
  "status"     "ApprovalStatus" NOT NULL,
  "comment"    TEXT,
  "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "approval_decisions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "approval_decisions_tenant_id_request_id_idx" ON "approval_decisions"("tenant_id", "request_id");

-- ─── S40 SSO / SAML ──────────────────────────────────────────────────────────
CREATE TABLE "sso_configs" (
  "id"              TEXT NOT NULL,
  "tenant_id"       TEXT NOT NULL,
  "idp_sso_url"     TEXT NOT NULL,
  "idp_certificate" TEXT NOT NULL,
  "sp_entity_id"    TEXT NOT NULL,
  "sp_private_key"  TEXT,
  "attr_email"      TEXT NOT NULL DEFAULT 'email',
  "attr_first_name" TEXT NOT NULL DEFAULT 'firstName',
  "attr_last_name"  TEXT NOT NULL DEFAULT 'lastName',
  "attr_role"       TEXT,
  "is_active"       BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sso_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sso_configs_tenant_id_key" UNIQUE ("tenant_id")
);
