-- Make RLS deny-by-default when application code switches to app_user without
-- setting the tenant context first.
--
-- Older policies intentionally used:
--   current_tenant_id() IS NULL OR tenant_id = current_tenant_id()
--
-- That made a missing/empty app.tenant_id fail open for app_user. Returning a
-- sentinel instead of NULL keeps legitimate runWithTenant() traffic working
-- while making the legacy OR branch false when tenant context is absent.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS TEXT AS $$
  SELECT COALESCE(NULLIF(current_setting('app.tenant_id', true), ''), '__amass_missing_tenant_context__');
$$ LANGUAGE SQL STABLE;
