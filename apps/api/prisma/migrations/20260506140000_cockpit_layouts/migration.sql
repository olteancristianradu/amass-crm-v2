-- CockpitLayout — per-user widget layout for /app/cockpit. JSON column
-- holds the ordered list of widget ids; one row per (tenant, user).

CREATE TABLE "cockpit_layouts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "widgets" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cockpit_layouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cockpit_layouts_tenant_id_user_id_key"
    ON "cockpit_layouts"("tenant_id", "user_id");

CREATE INDEX "cockpit_layouts_tenant_id_idx"
    ON "cockpit_layouts"("tenant_id");

-- RLS: tenant-scoped read + write, deny-by-default via current_tenant_id() sentinel
-- (matches the pattern locked in by 20260504065000_rls_deny_missing_tenant).
ALTER TABLE "cockpit_layouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cockpit_layouts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "cockpit_layouts_tenant_isolation"
    ON "cockpit_layouts"
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "cockpit_layouts" TO app_user;
