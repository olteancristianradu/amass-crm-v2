-- Postgres bypasses RLS for table owners by default. The app connects as
-- the database owner in dev, so without FORCE the policies are no-ops.
-- FORCE makes the owner subject to RLS too — which is what we want for
-- defense in depth.
ALTER TABLE "users"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "sessions"   FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
