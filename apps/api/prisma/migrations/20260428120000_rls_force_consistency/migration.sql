-- M-aud-RLS-sweep: enforce FORCE ROW LEVEL SECURITY on every table that
-- has RLS enabled but lacks FORCE. Without FORCE, the table OWNER
-- bypasses RLS even if app_user (NOSUPERUSER + NOBYPASSRLS) doesn't —
-- which means a future migration that runs as the postgres role and
-- forgets `SET LOCAL ROLE app_user` could read/write across tenants.
-- LESSONS.md 2026-04-08 documents this exact pitfall.
--
-- These 10 tables fell out of the bash audit (run 2026-04-28 against
-- the live schema):
ALTER TABLE "chatter_posts"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "commission_plans"       FORCE ROW LEVEL SECURITY;
ALTER TABLE "commissions"            FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_subscriptions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "events"                 FORCE ROW LEVEL SECURITY;
ALTER TABLE "formula_fields"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_bundles"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_variants"       FORCE ROW LEVEL SECURITY;
ALTER TABLE "territories"            FORCE ROW LEVEL SECURITY;
ALTER TABLE "validation_rules"       FORCE ROW LEVEL SECURITY;

-- Three tables intentionally remain WITHOUT RLS:
--   - tenants                    : slug→id lookup happens before any
--     auth context exists; RLS would deadlock the login path.
--   - email_verification_tokens  : token→user lookup, pre-auth.
--   - password_reset_tokens      : same shape as the verification one.
-- Each of these has a unique-by-token global index and a short TTL
-- (≤24h), and any queries against them go through bespoke service
-- methods that don't touch user data outside the (tenantId, email)
-- pair the token row already carries.
