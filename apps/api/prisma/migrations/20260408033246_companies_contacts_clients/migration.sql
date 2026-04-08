-- CreateEnum
CREATE TYPE "CompanySize" AS ENUM ('MICRO', 'SMALL', 'MEDIUM', 'LARGE');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vatNumber" TEXT,
    "registrationNumber" TEXT,
    "industry" TEXT,
    "size" "CompanySize",
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "county" TEXT,
    "postalCode" TEXT,
    "country" TEXT DEFAULT 'RO',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "jobTitle" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "county" TEXT,
    "postalCode" TEXT,
    "country" TEXT DEFAULT 'RO',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "companies_tenantId_createdAt_idx" ON "companies"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "companies_tenantId_name_idx" ON "companies"("tenantId", "name");

-- CreateIndex
CREATE INDEX "companies_tenantId_vatNumber_idx" ON "companies"("tenantId", "vatNumber");

-- CreateIndex
CREATE INDEX "contacts_tenantId_createdAt_idx" ON "contacts"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "contacts_tenantId_companyId_idx" ON "contacts"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "contacts_tenantId_lastName_firstName_idx" ON "contacts"("tenantId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "clients_tenantId_createdAt_idx" ON "clients"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "clients_tenantId_lastName_firstName_idx" ON "clients"("tenantId", "lastName", "firstName");

-- CreateIndex
CREATE INDEX "clients_tenantId_email_idx" ON "clients"("tenantId", "email");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- RLS for the new tenant-scoped tables (S2 pattern). Without these, the new
-- tables would be wide-open to cross-tenant reads even though Prisma extension
-- filters by tenantId.
-- ============================================================================

ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE  ROW LEVEL SECURITY;
ALTER TABLE "contacts"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts"  FORCE  ROW LEVEL SECURITY;
ALTER TABLE "clients"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clients"   FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_companies ON "companies"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

CREATE POLICY tenant_isolation_contacts ON "contacts"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

CREATE POLICY tenant_isolation_clients ON "clients"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

-- Default privileges from the app_role migration cover newly created tables
-- automatically — no extra GRANT needed here.
