-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "email_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpUser" TEXT NOT NULL,
    "smtpPassEnc" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "email_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_accounts_tenantId_userId_idx" ON "email_accounts"("tenantId", "userId");
CREATE INDEX "email_accounts_tenantId_userId_isDefault_idx" ON "email_accounts"("tenantId", "userId", "isDefault");

-- CreateTable
CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "subjectType" "SubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "toAddresses" TEXT[] NOT NULL,
    "ccAddresses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "bccAddresses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "sentAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "messageId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_messages_tenantId_subjectType_subjectId_createdAt_idx" ON "email_messages"("tenantId", "subjectType", "subjectId", "createdAt");
CREATE INDEX "email_messages_tenantId_accountId_status_idx" ON "email_messages"("tenantId", "accountId", "status");
CREATE INDEX "email_messages_tenantId_createdById_createdAt_idx" ON "email_messages"("tenantId", "createdById", "createdAt");
CREATE INDEX "email_messages_tenantId_status_idx" ON "email_messages"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Row-Level Security: tenant isolation for email_accounts + email_messages.
-- ============================================================================

ALTER TABLE "email_accounts"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_accounts"   FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_email_accounts ON "email_accounts"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

ALTER TABLE "email_messages"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_messages"   FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_email_messages ON "email_messages"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "email_accounts"  TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "email_messages"  TO app_user;
