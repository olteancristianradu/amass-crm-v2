-- S15: Automated workflows/sequences.
-- A Workflow defines a trigger + ordered list of steps (actions).
-- A WorkflowRun tracks one execution of a workflow for one subject.

CREATE TYPE "WorkflowTrigger" AS ENUM (
  'DEAL_CREATED',
  'DEAL_STAGE_CHANGED',
  'CONTACT_CREATED',
  'COMPANY_CREATED'
);

CREATE TYPE "WorkflowActionType" AS ENUM (
  'SEND_EMAIL',
  'CREATE_TASK',
  'ADD_NOTE',
  'WAIT_DAYS'
);

CREATE TYPE "WorkflowRunStatus" AS ENUM (
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "workflows" (
  "id"             TEXT              NOT NULL PRIMARY KEY,
  "tenant_id"      TEXT              NOT NULL,
  "name"           TEXT              NOT NULL,
  "description"    TEXT,
  "is_active"      BOOLEAN           NOT NULL DEFAULT true,
  "trigger"        "WorkflowTrigger" NOT NULL,
  -- JSON context for the trigger, e.g. { "stageId": "..." } for DEAL_STAGE_CHANGED
  "trigger_config" JSONB             NOT NULL DEFAULT '{}',
  "created_at"     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  "deleted_at"     TIMESTAMPTZ
);

CREATE TABLE "workflow_steps" (
  "id"            TEXT                  NOT NULL PRIMARY KEY,
  "workflow_id"   TEXT                  NOT NULL REFERENCES "workflows"("id") ON DELETE CASCADE,
  "tenant_id"     TEXT                  NOT NULL,
  "order"         INTEGER               NOT NULL DEFAULT 0,
  "action_type"   "WorkflowActionType"  NOT NULL,
  -- JSON shape per action_type:
  --   SEND_EMAIL: { accountId, subject, body }  (to = subject's email)
  --   CREATE_TASK: { title, priority, dueInDays }
  --   ADD_NOTE:    { body }
  --   WAIT_DAYS:   { days }
  "action_config" JSONB                 NOT NULL DEFAULT '{}',
  "created_at"    TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

CREATE TABLE "workflow_runs" (
  "id"           TEXT                NOT NULL PRIMARY KEY,
  "tenant_id"    TEXT                NOT NULL,
  "workflow_id"  TEXT                NOT NULL REFERENCES "workflows"("id") ON DELETE CASCADE,
  "subject_type" TEXT                NOT NULL,
  "subject_id"   TEXT                NOT NULL,
  "status"       "WorkflowRunStatus" NOT NULL DEFAULT 'RUNNING',
  "current_step" INTEGER             NOT NULL DEFAULT 0,
  "started_at"   TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  "completed_at" TIMESTAMPTZ,
  "error"        TEXT
);

CREATE INDEX idx_workflows_tenant         ON "workflows"("tenant_id", "is_active");
CREATE INDEX idx_workflow_steps_workflow  ON "workflow_steps"("workflow_id", "order");
CREATE INDEX idx_workflow_runs_tenant     ON "workflow_runs"("tenant_id", "workflow_id", "status");
CREATE INDEX idx_workflow_runs_subject    ON "workflow_runs"("tenant_id", "subject_type", "subject_id");

ALTER TABLE "workflows"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_runs"  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "workflows"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "workflow_steps" FORCE ROW LEVEL SECURITY;
ALTER TABLE "workflow_runs"  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "workflows"
  USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation ON "workflow_steps"
  USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY tenant_isolation ON "workflow_runs"
  USING (tenant_id = current_setting('app.tenant_id', true));
