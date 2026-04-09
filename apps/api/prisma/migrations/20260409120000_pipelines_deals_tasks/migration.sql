-- CreateEnum
CREATE TYPE "StageType" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateTable
CREATE TABLE "pipelines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipelines_tenantId_order_idx" ON "pipelines"("tenantId", "order");
CREATE INDEX "pipelines_tenantId_isDefault_idx" ON "pipelines"("tenantId", "isDefault");

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "StageType" NOT NULL DEFAULT 'OPEN',
    "order" INTEGER NOT NULL DEFAULT 0,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipeline_stages_tenantId_pipelineId_order_idx" ON "pipeline_stages"("tenantId", "pipelineId", "order");

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "ownerId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "value" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "probability" INTEGER,
    "expectedCloseAt" TIMESTAMP(3),
    "status" "DealStatus" NOT NULL DEFAULT 'OPEN',
    "lostReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "orderInStage" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deals_tenantId_pipelineId_stageId_orderInStage_idx" ON "deals"("tenantId", "pipelineId", "stageId", "orderInStage");
CREATE INDEX "deals_tenantId_status_idx" ON "deals"("tenantId", "status");
CREATE INDEX "deals_tenantId_ownerId_status_idx" ON "deals"("tenantId", "ownerId", "status");
CREATE INDEX "deals_tenantId_companyId_idx" ON "deals"("tenantId", "companyId");
CREATE INDEX "deals_tenantId_contactId_idx" ON "deals"("tenantId", "contactId");
CREATE INDEX "deals_tenantId_expectedCloseAt_idx" ON "deals"("tenantId", "expectedCloseAt");

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dealId" TEXT,
    "subjectType" "SubjectType",
    "subjectId" TEXT,
    "assigneeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_tenantId_assigneeId_status_dueAt_idx" ON "tasks"("tenantId", "assigneeId", "status", "dueAt");
CREATE INDEX "tasks_tenantId_status_dueAt_idx" ON "tasks"("tenantId", "status", "dueAt");
CREATE INDEX "tasks_tenantId_dealId_idx" ON "tasks"("tenantId", "dealId");
CREATE INDEX "tasks_tenantId_subjectType_subjectId_idx" ON "tasks"("tenantId", "subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Row-Level Security: tenant isolation for pipelines, stages, deals, tasks.
-- Same defense-in-depth pattern as every other tenant-scoped table — even if
-- a service forgets WHERE tenantId = …, RLS still blocks cross-tenant reads
-- and writes inside `SET LOCAL ROLE app_user`.
-- ============================================================================

ALTER TABLE "pipelines"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipelines"        FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_pipelines ON "pipelines"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

ALTER TABLE "pipeline_stages"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_stages"  FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_pipeline_stages ON "pipeline_stages"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

ALTER TABLE "deals"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deals"            FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_deals ON "deals"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

ALTER TABLE "tasks"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks"            FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tasks ON "tasks"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "pipelines"       TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "pipeline_stages" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "deals"           TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tasks"           TO app_user;
