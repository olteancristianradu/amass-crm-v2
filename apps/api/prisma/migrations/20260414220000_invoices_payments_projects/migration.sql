-- S22/S23/S24: Invoices, InvoiceLines, Payments, Projects
-- Multi-tenant with Postgres RLS on every table.

-- ─── enums ───────────────────────────────────────────────────────────────────
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');
CREATE TYPE "InvoiceCurrency" AS ENUM ('RON', 'EUR', 'USD');
CREATE TYPE "PaymentMethod" AS ENUM ('BANK', 'CASH', 'CARD', 'OTHER');
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- ─── invoices ────────────────────────────────────────────────────────────────
CREATE TABLE "invoices" (
    "id"              TEXT NOT NULL,
    "tenant_id"       TEXT NOT NULL,
    "company_id"      TEXT NOT NULL,
    "deal_id"         TEXT,
    "series"          TEXT NOT NULL,
    "number"          INTEGER NOT NULL,
    "issue_date"      TIMESTAMP(3) NOT NULL,
    "due_date"        TIMESTAMP(3) NOT NULL,
    "subtotal"        DECIMAL(14,2) NOT NULL,
    "vat_amount"      DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total"           DECIMAL(14,2) NOT NULL,
    "currency"        "InvoiceCurrency" NOT NULL DEFAULT 'RON',
    "status"          "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "notes"           TEXT,
    "pdf_storage_key" TEXT,
    "created_by_id"   TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,
    "deleted_at"      TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoices_tenant_id_series_number_key" ON "invoices"("tenant_id", "series", "number");
CREATE INDEX "invoices_tenant_id_company_id_issue_date_idx" ON "invoices"("tenant_id", "company_id", "issue_date");
CREATE INDEX "invoices_tenant_id_status_idx" ON "invoices"("tenant_id", "status");
CREATE INDEX "invoices_tenant_id_due_date_idx" ON "invoices"("tenant_id", "due_date");

-- ─── invoice_lines ───────────────────────────────────────────────────────────
CREATE TABLE "invoice_lines" (
    "id"          TEXT NOT NULL,
    "tenant_id"   TEXT NOT NULL,
    "invoice_id"  TEXT NOT NULL,
    "position"    INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity"    DECIMAL(14,3) NOT NULL,
    "unit_price"  DECIMAL(14,2) NOT NULL,
    "vat_rate"    DECIMAL(5,2) NOT NULL DEFAULT 19,
    "subtotal"    DECIMAL(14,2) NOT NULL,
    "vat_amount"  DECIMAL(14,2) NOT NULL,
    "total"       DECIMAL(14,2) NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines"("invoice_id");
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── payments ────────────────────────────────────────────────────────────────
CREATE TABLE "payments" (
    "id"            TEXT NOT NULL,
    "tenant_id"     TEXT NOT NULL,
    "invoice_id"    TEXT NOT NULL,
    "amount"        DECIMAL(14,2) NOT NULL,
    "paid_at"       TIMESTAMP(3) NOT NULL,
    "method"        "PaymentMethod" NOT NULL DEFAULT 'BANK',
    "reference"     TEXT,
    "notes"         TEXT,
    "created_by_id" TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"    TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payments_tenant_id_invoice_id_idx" ON "payments"("tenant_id", "invoice_id");
CREATE INDEX "payments_tenant_id_paid_at_idx" ON "payments"("tenant_id", "paid_at");
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── projects ────────────────────────────────────────────────────────────────
CREATE TABLE "projects" (
    "id"            TEXT NOT NULL,
    "tenant_id"     TEXT NOT NULL,
    "company_id"    TEXT NOT NULL,
    "deal_id"       TEXT,
    "name"          TEXT NOT NULL,
    "description"   TEXT,
    "status"        "ProjectStatus" NOT NULL DEFAULT 'PLANNED',
    "start_date"    TIMESTAMP(3),
    "end_date"      TIMESTAMP(3),
    "budget"        DECIMAL(14,2),
    "currency"      "InvoiceCurrency" NOT NULL DEFAULT 'RON',
    "created_by_id" TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL,
    "deleted_at"    TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "projects_deal_id_key" ON "projects"("deal_id");
CREATE INDEX "projects_tenant_id_company_id_idx" ON "projects"("tenant_id", "company_id");
CREATE INDEX "projects_tenant_id_status_idx" ON "projects"("tenant_id", "status");

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Each table isolates by `app.tenant_id` session var. See
-- 20260407210500_force_rls for the rationale on FORCE + NOSUPERUSER.

ALTER TABLE "invoices"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_lines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payments"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "projects"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects"      FORCE ROW LEVEL SECURITY;

CREATE POLICY "invoices_tenant_isolation"      ON "invoices"      USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY "invoice_lines_tenant_isolation" ON "invoice_lines" USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY "payments_tenant_isolation"      ON "payments"      USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY "projects_tenant_isolation"      ON "projects"      USING (tenant_id = current_setting('app.tenant_id', true));

-- Grant CRUD to app_user so non-superuser connection can read/write under RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON "invoices", "invoice_lines", "payments", "projects" TO app_user;
