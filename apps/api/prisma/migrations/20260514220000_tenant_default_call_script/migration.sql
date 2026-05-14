-- Tenant-level default sales/support script for call-compliance evaluation.
-- AI worker reads this list of points when running script-compliance on a
-- recorded call. NULL = feature disabled for the tenant (no scoring).
ALTER TABLE "tenants" ADD COLUMN "defaultCallScript" JSONB;
