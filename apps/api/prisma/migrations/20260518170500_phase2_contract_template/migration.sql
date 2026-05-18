-- Phase 2 B — ContractTemplate: tenant-scoped reusable, versioned contract
-- templates (Phase 2 schema review §B / §3).
--
-- Body stored inline (VARCHAR 1 MiB cap) for the typical TipTap/Slate inline
-- editor flow. Templates approaching the cap are an anti-pattern signal —
-- monitor pg_class.relpages and migrate to MinIO + bodyStorageKey when
-- consistently >100MB total per Concern 1 in the schema review.

CREATE TYPE "ContractTemplateStatus" AS ENUM (
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED'
);

CREATE TABLE "contract_templates" (
  "id"             TEXT NOT NULL,
  "tenant_id"      TEXT NOT NULL,
  "name"           VARCHAR(255) NOT NULL,
  "description"    VARCHAR(2048),
  "body_md"        VARCHAR(1048576) NOT NULL,
  "variables"      JSONB NOT NULL DEFAULT '[]',
  "status"         "ContractTemplateStatus" NOT NULL DEFAULT 'DRAFT',
  "version"        INTEGER NOT NULL DEFAULT 1,
  "created_by_id"  TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"     TIMESTAMP(3),

  CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contract_templates_tenant_name_version_uniq"
  ON "contract_templates" ("tenant_id", "name", "version")
  WHERE "deleted_at" IS NULL;

CREATE INDEX "contract_templates_tenant_status_idx"
  ON "contract_templates" ("tenant_id", "status")
  WHERE "deleted_at" IS NULL;

ALTER TABLE "contract_templates"
  ADD CONSTRAINT "contract_templates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- FK from contracts.template_id → contract_templates.id. The template_id
-- column was added in migration A.2 (20260518170100) as plain TEXT because
-- contract_templates didn't yet exist; now we wire the FK.
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "contract_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contract_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_templates" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_contract_templates ON "contract_templates"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "contract_templates" TO app_user;
