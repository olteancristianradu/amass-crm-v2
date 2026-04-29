-- CreateEnum
CREATE TYPE "LawfulBasis" AS ENUM ('CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'VITAL_INTEREST', 'PUBLIC_TASK', 'LEGITIMATE_INTEREST');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('MARKETING_EMAIL', 'MARKETING_SMS', 'MARKETING_WHATSAPP', 'CALL_RECORDING', 'CALL_TRANSCRIPTION', 'AI_PROFILING', 'AI_LEAD_SCORING', 'COOKIES_FUNCTIONAL', 'COOKIES_ANALYTICS', 'COOKIES_MARKETING', 'DATA_SHARING_PARTNERS', 'NEWSLETTER');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'REVOKED', 'EXPIRED', 'PENDING');

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectType" "SubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "lawfulBasis" "LawfulBasis" NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "source" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_records_tenantId_subjectType_subjectId_idx" ON "consent_records"("tenantId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "consent_records_tenantId_purpose_status_idx" ON "consent_records"("tenantId", "purpose", "status");

-- CreateIndex
CREATE INDEX "consent_records_tenantId_createdAt_idx" ON "consent_records"("tenantId", "createdAt");

-- ============================================================================
-- Row-Level Security (RLS) — defense layer 3 for multi-tenant isolation.
-- Pattern matches every other tenant-scoped table in this repo.
-- Function current_tenant_id() defined in 20260407210058_audit_log migration.
-- ============================================================================

ALTER TABLE "consent_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent_records" FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_consent_records ON "consent_records"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

-- Append-only by design: GRANT SELECT + INSERT only. No UPDATE / DELETE.
-- Revocation = INSERT new row with status=REVOKED, NEVER mutate existing.
-- Preserves provable consent history for GDPR Art. 7(1) audit by ANSPDCP.
GRANT SELECT, INSERT ON "consent_records" TO app_user;
