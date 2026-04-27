-- RLS pattern standardisation.
--
-- Background (super-audit addendum, 2026-04-25):
--   The codebase grew with two RLS policy patterns coexisting:
--
--   Pattern A (used in 10 older migrations + 20260422100000_rls_remaining_tables):
--     USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
--     WITH CHECK (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
--
--   Pattern B (used in 4 mid-sprint migrations on 18 tables):
--     USING (tenant_id = current_setting('app.tenant_id', true))
--     -- WITH CHECK omitted (Postgres defaults it to USING — not a security
--     -- vulnerability, but inconsistent and surprises auditors).
--
--   Pattern A tolerates a NULL/missing `app.tenant_id` setting (returns
--   "no filter") — required for cron jobs that run as the DB owner role
--   (BYPASSRLS) but might also operate via runWithTenant in future
--   refactors. Pattern B is strictly stricter: when no setting is in
--   play, `tenant_id = ''` evaluates false on every row → cron sweeps
--   under `app_user` would silently see ZERO rows on these tables.
--
--   Today's prod isn't broken because direct `prisma.X` calls run as the
--   DB owner (BYPASSRLS), but it's a latent foot-gun. Standardising both:
--     1) closes the inconsistency,
--     2) makes WITH CHECK explicit so future readers don't have to know
--        Postgres' defaulting rule,
--     3) lets us safely move sweep crons under runWithTenant later.
--
-- All 18 affected tables use the snake-case `tenant_id` column (verified
-- via earlier grep of the source migrations). The older Pattern A tables
-- use camelCase `"tenantId"`; this migration touches ONLY snake_case
-- ones, so no naming-quirk risk.

-- ── Workflows ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS tenant_isolation ON workflows;
CREATE POLICY tenant_isolation ON workflows
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON workflow_steps;
CREATE POLICY tenant_isolation ON workflow_steps
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON workflow_runs;
CREATE POLICY tenant_isolation ON workflow_runs
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

-- ── Invoices / payments / projects ────────────────────────────────────
DROP POLICY IF EXISTS "invoices_tenant_isolation" ON "invoices";
CREATE POLICY "invoices_tenant_isolation" ON "invoices"
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "invoice_lines_tenant_isolation" ON "invoice_lines";
CREATE POLICY "invoice_lines_tenant_isolation" ON "invoice_lines"
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "payments_tenant_isolation" ON "payments";
CREATE POLICY "payments_tenant_isolation" ON "payments"
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "projects_tenant_isolation" ON "projects";
CREATE POLICY "projects_tenant_isolation" ON "projects"
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

-- ── Email tracking ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "email_tracks_tenant_isolation" ON "email_tracks";
CREATE POLICY "email_tracks_tenant_isolation" ON "email_tracks"
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

-- ── Tier B/C feature tables (10 of them, all using `p_tenant_isolation`) ──
DROP POLICY IF EXISTS p_tenant_isolation ON chatter_posts;
CREATE POLICY p_tenant_isolation ON chatter_posts
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS p_tenant_isolation ON commission_plans;
CREATE POLICY p_tenant_isolation ON commission_plans
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS p_tenant_isolation ON commissions;
CREATE POLICY p_tenant_isolation ON commissions
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS p_tenant_isolation ON customer_subscriptions;
CREATE POLICY p_tenant_isolation ON customer_subscriptions
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS p_tenant_isolation ON events;
CREATE POLICY p_tenant_isolation ON events
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS p_tenant_isolation ON formula_fields;
CREATE POLICY p_tenant_isolation ON formula_fields
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS p_tenant_isolation ON product_bundles;
CREATE POLICY p_tenant_isolation ON product_bundles
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS p_tenant_isolation ON product_variants;
CREATE POLICY p_tenant_isolation ON product_variants
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS p_tenant_isolation ON territories;
CREATE POLICY p_tenant_isolation ON territories
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS p_tenant_isolation ON validation_rules;
CREATE POLICY p_tenant_isolation ON validation_rules
  USING (current_tenant_id() IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (current_tenant_id() IS NULL OR tenant_id = current_tenant_id());
