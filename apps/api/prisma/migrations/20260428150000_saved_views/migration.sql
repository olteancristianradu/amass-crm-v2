-- Saved views: per-user, per-resource snapshot of a list page's filters/search.
-- Scoped (tenantId, ownerId, resource) so each user only sees their own views,
-- and the FE dropdown on /companies only shows views with resource='companies'.
CREATE TABLE "saved_views" (
  "id"         TEXT NOT NULL,
  "tenant_id"  TEXT NOT NULL,
  "owner_id"   TEXT NOT NULL,
  "resource"   TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "filters"    JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- One name per (user, resource) — prevents accidental overwrite via duplicate name.
CREATE UNIQUE INDEX "saved_views_owner_id_resource_name_key"
  ON "saved_views" ("owner_id", "resource", "name");

-- Hot-path: list views for the current user on the current page.
CREATE INDEX "saved_views_tenant_id_owner_id_resource_idx"
  ON "saved_views" ("tenant_id", "owner_id", "resource");

-- FK to users — cascade so when an account is hard-deleted, their views go with it.
-- (Soft-delete leaves them; that's fine, RLS still scopes by tenant.)
ALTER TABLE "saved_views"
  ADD CONSTRAINT "saved_views_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS — same template as every other tenant-scoped table in this repo.
ALTER TABLE "saved_views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_views" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_saved_views ON "saved_views"
  USING (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR "tenant_id" = current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "saved_views" TO app_user;
