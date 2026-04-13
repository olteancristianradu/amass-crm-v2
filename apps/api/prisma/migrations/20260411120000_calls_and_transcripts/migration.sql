-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('QUEUED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'BUSY', 'NO_ANSWER', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "TranscriptionStatus" AS ENUM ('NONE', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "phone_numbers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "twilioSid" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "label" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "phone_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "phone_numbers_twilioSid_key" ON "phone_numbers"("twilioSid");
CREATE INDEX "phone_numbers_tenantId_userId_idx" ON "phone_numbers"("tenantId", "userId");
CREATE INDEX "phone_numbers_tenantId_number_idx" ON "phone_numbers"("tenantId", "number");

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectType" "SubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "phoneNumberId" TEXT,
    "userId" TEXT,
    "twilioCallSid" TEXT,
    "direction" "CallDirection" NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'QUEUED',
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "recordingSid" TEXT,
    "recordingUrl" TEXT,
    "recordingStorageKey" TEXT,
    "transcriptionStatus" "TranscriptionStatus" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calls_twilioCallSid_key" ON "calls"("twilioCallSid");
CREATE INDEX "calls_tenantId_subjectType_subjectId_createdAt_idx" ON "calls"("tenantId", "subjectType", "subjectId", "createdAt");
CREATE INDEX "calls_tenantId_userId_createdAt_idx" ON "calls"("tenantId", "userId", "createdAt");
CREATE INDEX "calls_tenantId_status_idx" ON "calls"("tenantId", "status");
CREATE INDEX "calls_tenantId_transcriptionStatus_idx" ON "calls"("tenantId", "transcriptionStatus");

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES "phone_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "call_transcripts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "language" TEXT,
    "rawText" TEXT NOT NULL,
    "segments" JSONB NOT NULL,
    "redactedText" TEXT,
    "summary" TEXT,
    "actionItems" JSONB,
    "sentiment" TEXT,
    "topics" JSONB,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_transcripts_callId_key" ON "call_transcripts"("callId");
CREATE INDEX "call_transcripts_tenantId_callId_idx" ON "call_transcripts"("tenantId", "callId");

-- AddForeignKey
ALTER TABLE "call_transcripts" ADD CONSTRAINT "call_transcripts_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Row-Level Security: tenant isolation for phone_numbers, calls, call_transcripts.
-- ============================================================================

ALTER TABLE "phone_numbers"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "phone_numbers"     FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_phone_numbers ON "phone_numbers"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

ALTER TABLE "calls"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calls"             FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_calls ON "calls"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

ALTER TABLE "call_transcripts"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "call_transcripts"  FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_call_transcripts ON "call_transcripts"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "phone_numbers"    TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "calls"            TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "call_transcripts" TO app_user;
