-- P0-3 (audit 4-agent): add tenant_id to 5 sub-models that previously lacked it.
-- Without tenant_id, RLS policies + tenantExtension cannot scope these tables —
-- a query directly on webhook_deliveries / order_items / etc. bypassed defense.
--
-- Backfill strategy: derive tenant_id from the parent row's tenant_id.
-- This is safe because each sub-model has a parent FK that DOES carry tenant.
-- After backfill we lock the column NOT NULL.

-- ─── webhook_deliveries ───────────────────────────────────────
ALTER TABLE "webhook_deliveries" ADD COLUMN "tenant_id" TEXT;
UPDATE "webhook_deliveries" wd
  SET "tenant_id" = we."tenant_id"
  FROM "webhook_endpoints" we
  WHERE wd."endpoint_id" = we."id";
ALTER TABLE "webhook_deliveries" ALTER COLUMN "tenant_id" SET NOT NULL;
CREATE INDEX "idx_webhook_deliveries_tenant" ON "webhook_deliveries" ("tenant_id");

-- ─── order_items ───────────────────────────────────────────────
ALTER TABLE "order_items" ADD COLUMN "tenant_id" TEXT;
UPDATE "order_items" oi
  SET "tenant_id" = o."tenant_id"
  FROM "orders" o
  WHERE oi."order_id" = o."id";
ALTER TABLE "order_items" ALTER COLUMN "tenant_id" SET NOT NULL;
CREATE INDEX "idx_order_items_tenant" ON "order_items" ("tenant_id");

-- ─── product_bundle_items ─────────────────────────────────────
ALTER TABLE "product_bundle_items" ADD COLUMN "tenant_id" TEXT;
UPDATE "product_bundle_items" pbi
  SET "tenant_id" = pb."tenant_id"
  FROM "product_bundles" pb
  WHERE pbi."bundle_id" = pb."id";
ALTER TABLE "product_bundle_items" ALTER COLUMN "tenant_id" SET NOT NULL;
CREATE INDEX "idx_product_bundle_items_tenant" ON "product_bundle_items" ("tenant_id");

-- ─── territory_assignments ─────────────────────────────────────
ALTER TABLE "territory_assignments" ADD COLUMN "tenant_id" TEXT;
UPDATE "territory_assignments" ta
  SET "tenant_id" = t."tenant_id"
  FROM "territories" t
  WHERE ta."territory_id" = t."id";
ALTER TABLE "territory_assignments" ALTER COLUMN "tenant_id" SET NOT NULL;
CREATE INDEX "idx_territory_assignments_tenant" ON "territory_assignments" ("tenant_id");

-- ─── event_attendees ───────────────────────────────────────────
ALTER TABLE "event_attendees" ADD COLUMN "tenant_id" TEXT;
UPDATE "event_attendees" ea
  SET "tenant_id" = e."tenant_id"
  FROM "events" e
  WHERE ea."event_id" = e."id";
ALTER TABLE "event_attendees" ALTER COLUMN "tenant_id" SET NOT NULL;
CREATE INDEX "idx_event_attendees_tenant" ON "event_attendees" ("tenant_id");
