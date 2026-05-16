-- B3-PR4 e2e finding: scim_tokens lacked GRANT to app_user role.
-- Without this, the runtime user (which uses SET LOCAL ROLE app_user)
-- gets permission denied even though RLS rules would otherwise let
-- the row through.
--
-- We grant SELECT + INSERT + UPDATE + DELETE; same surface as the
-- other tenant-scoped tables (RLS still constrains WHICH rows the
-- role can touch).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scim_tokens TO app_user;

-- Ensure RLS is enabled (the original 20260515090000_scim_token
-- migration set the policy but did not explicitly ENABLE RLS — it
-- worked locally because the table inherits the schema default, but
-- belt-and-suspenders here covers any environment where the default
-- differs).
ALTER TABLE public.scim_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scim_tokens FORCE ROW LEVEL SECURITY;
