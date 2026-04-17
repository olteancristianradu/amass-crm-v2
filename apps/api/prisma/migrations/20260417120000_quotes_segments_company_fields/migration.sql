-- Migration: S27-S33 — Company CRM fields, Contact isDecider, Quotes, Email sequences, Contact segments

-- ── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE "RelationshipStatus" AS ENUM ('LEAD', 'PROSPECT', 'ACTIVE', 'INACTIVE');
CREATE TYPE "LeadSource" AS ENUM ('REFERRAL', 'WEB', 'COLD_CALL', 'EVENT', 'PARTNER', 'SOCIAL', 'OTHER');
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');
CREATE TYPE "SequenceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'UNSUBSCRIBED', 'FAILED');

-- ── Company: new CRM fields ───────────────────────────────────────────────────

ALTER TABLE "companies"
  ADD COLUMN "relationship_status" "RelationshipStatus",
  ADD COLUMN "lead_source" "LeadSource";

CREATE INDEX "companies_tenant_id_relationship_status_idx" ON "companies"("tenantId", "relationship_status");

-- ── Contact: isDecider flag ───────────────────────────────────────────────────

ALTER TABLE "contacts"
  ADD COLUMN "is_decider" BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Quotes ────────────────────────────────────────────────────────────────────

CREATE TABLE "quotes" (
  "id"            TEXT NOT NULL,
  "tenant_id"     TEXT NOT NULL,
  "company_id"    TEXT NOT NULL,
  "deal_id"       TEXT,
  "number"        TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "issue_date"    TIMESTAMP(3) NOT NULL,
  "valid_until"   TIMESTAMP(3) NOT NULL,
  "subtotal"      DECIMAL(14,2) NOT NULL,
  "vat_amount"    DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total"         DECIMAL(14,2) NOT NULL,
  "currency"      "InvoiceCurrency" NOT NULL DEFAULT 'RON',
  "status"        "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
  "notes"         TEXT,
  "invoice_id"    TEXT,
  "created_by_id" TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  "deleted_at"    TIMESTAMP(3),

  CONSTRAINT "quotes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quotes_invoice_id_key" UNIQUE ("invoice_id"),
  CONSTRAINT "quotes_tenant_id_number_key" UNIQUE ("tenant_id", "number")
);

CREATE INDEX "quotes_tenant_id_company_id_issue_date_idx" ON "quotes"("tenant_id", "company_id", "issue_date");
CREATE INDEX "quotes_tenant_id_status_idx" ON "quotes"("tenant_id", "status");

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "quote_lines" (
  "id"          TEXT NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "quote_id"    TEXT NOT NULL,
  "position"    INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "quantity"    DECIMAL(14,3) NOT NULL,
  "unit_price"  DECIMAL(14,2) NOT NULL,
  "vat_rate"    DECIMAL(5,2) NOT NULL DEFAULT 19,
  "subtotal"    DECIMAL(14,2) NOT NULL,
  "vat_amount"  DECIMAL(14,2) NOT NULL,
  "total"       DECIMAL(14,2) NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "quote_lines_quote_id_idx" ON "quote_lines"("quote_id");

ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_fkey"
  FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Email sequences (S32) ─────────────────────────────────────────────────────

CREATE TABLE "email_sequences" (
  "id"            TEXT NOT NULL,
  "tenant_id"     TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "description"   TEXT,
  "status"        "SequenceStatus" NOT NULL DEFAULT 'DRAFT',
  "created_by_id" TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  "deleted_at"    TIMESTAMP(3),

  CONSTRAINT "email_sequences_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_sequences_tenant_id_status_idx" ON "email_sequences"("tenant_id", "status");

CREATE TABLE "email_sequence_steps" (
  "id"          TEXT NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "sequence_id" TEXT NOT NULL,
  "order"       INTEGER NOT NULL,
  "delay_days"  INTEGER NOT NULL DEFAULT 0,
  "subject"     TEXT NOT NULL,
  "body_html"   TEXT NOT NULL,
  "body_text"   TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "email_sequence_steps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_sequence_steps_sequence_id_order_idx" ON "email_sequence_steps"("sequence_id", "order");

ALTER TABLE "email_sequence_steps" ADD CONSTRAINT "email_sequence_steps_sequence_id_fkey"
  FOREIGN KEY ("sequence_id") REFERENCES "email_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sequence_enrollments" (
  "id"           TEXT NOT NULL,
  "tenant_id"    TEXT NOT NULL,
  "sequence_id"  TEXT NOT NULL,
  "to_email"     TEXT NOT NULL,
  "contact_id"   TEXT,
  "current_step" INTEGER NOT NULL DEFAULT 0,
  "status"       "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "enrolled_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "next_send_at" TIMESTAMP(3),

  CONSTRAINT "sequence_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sequence_enrollments_tenant_id_sequence_id_status_idx" ON "sequence_enrollments"("tenant_id", "sequence_id", "status");
CREATE INDEX "sequence_enrollments_tenant_id_status_next_send_at_idx" ON "sequence_enrollments"("tenant_id", "status", "next_send_at");

ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_sequence_id_fkey"
  FOREIGN KEY ("sequence_id") REFERENCES "email_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Contact segments (S33) ────────────────────────────────────────────────────

CREATE TABLE "contact_segments" (
  "id"            TEXT NOT NULL,
  "tenant_id"     TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "description"   TEXT,
  "filter_json"   JSONB NOT NULL,
  "created_by_id" TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "contact_segments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contact_segments_tenant_id_idx" ON "contact_segments"("tenant_id");
