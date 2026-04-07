-- Create a non-superuser role used by application transactions. RLS is
-- bypassed by superusers (and roles with BYPASSRLS), so all data-plane
-- queries must run under this restricted role. Migrations still run as the
-- connection user (typically `postgres`), which is what we want — schema
-- changes need owner privileges.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Future tables created by migrations should also be accessible.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
