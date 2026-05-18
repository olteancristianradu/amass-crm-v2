-- Phase 2 — `app_worker` Postgres role for cron / scheduler jobs that need
-- to scan across tenants (Phase 2 schema review BLOCKER 3 / §8.4).
--
-- WHY a new role:
--   The `contracts:signing-expire`, `approvals:request-expire`, and
--   `contracts:audit-chain-verify` workers run WITHOUT a tenant context
--   (they iterate every tenant in one cron tick). Under `app_user` + RLS,
--   `current_tenant_id()` returns the deny-sentinel and the scan returns
--   zero rows. Bypassing RLS for `app_user` is unacceptable — that would
--   defeat defense-in-depth for the entire request path.
--
-- DESIGN:
--   - `app_worker` is NOLOGIN + NOBYPASSRLS (same hardening as app_user).
--   - Per-table additive policies grant SELECT-only across all tenants to
--     this role specifically. The existing tenant_isolation_* policy is
--     unchanged (we don't broaden existing policies).
--   - Workers MUST set `SET LOCAL app.tenant_id = '<id>'` before INSERT/UPDATE
--     — the global SELECT is for the cross-tenant SCAN, not a write bypass.
--   - Connection string: `DATABASE_URL_WORKER=postgresql://app_worker:...`
--     plumbed via PrismaService.runAsWorker() (separate PR per schema review
--     §13 action item; the env var is wired now so the migration is complete).
--
-- SCOPED ACCESS (allow-list, NOT a blanket BYPASSRLS):
--   contract_signatures           — for `contracts:signing-expire` cron
--   contract_audit_entries        — for `contracts:audit-chain-verify` cron
--   approval_requests             — for `approvals:request-expire` cron
--   approval_steps                — same cron (cascade EXPIRED to step rows)
--   outbox_events                 — existing outbox poller (migration prep)
--   webhook_deliveries            — existing webhook retry processor (prep)
--   email_tracks                  — PII-purge cron (prep for global purge)
--
-- ORDER: this migration runs AFTER the Phase 2 table creates (170100,
--        170500, 171000, 172100, 173000) so we can name the policies
--        against tables that exist. Older Phase 1 tables (outbox_events,
--        webhook_deliveries, email_tracks) were already in place.

DO $APP_WORKER_ROLE$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $APP_WORKER_ROLE$;

GRANT USAGE ON SCHEMA public TO app_worker;

-- Per-table SELECT grants. We intentionally do NOT grant UPDATE/DELETE here —
-- workers that need to mutate a row do so under app_user inside a per-tenant
-- runWithTenant() transaction. This keeps the cross-tenant scan strictly
-- read-only at the role level.
GRANT SELECT ON "contract_signatures"       TO app_worker;
GRANT SELECT ON "contract_audit_entries"    TO app_worker;
GRANT SELECT ON "approval_requests"         TO app_worker;
GRANT SELECT ON "approval_steps"            TO app_worker;
GRANT SELECT ON "outbox_events"             TO app_worker;
GRANT SELECT ON "webhook_deliveries"        TO app_worker;
GRANT SELECT ON "email_tracks"              TO app_worker;

-- Per-table additive policies: when current_user = 'app_worker', allow the
-- cross-tenant scan. The existing tenant_isolation_* policies still apply
-- to app_user (unchanged) — additive, not replacement.
--
-- IMPORTANT: RLS is OR-combined across policies of the same command (SELECT
-- here), so adding `worker_global_select_*` does NOT loosen the tenant
-- isolation policy for app_user — it only opens a new path for app_worker.

CREATE POLICY worker_global_select_contract_signatures
  ON "contract_signatures"
  FOR SELECT
  TO app_worker
  USING (TRUE);

CREATE POLICY worker_global_select_contract_audit_entries
  ON "contract_audit_entries"
  FOR SELECT
  TO app_worker
  USING (TRUE);

CREATE POLICY worker_global_select_approval_requests
  ON "approval_requests"
  FOR SELECT
  TO app_worker
  USING (TRUE);

CREATE POLICY worker_global_select_approval_steps
  ON "approval_steps"
  FOR SELECT
  TO app_worker
  USING (TRUE);

CREATE POLICY worker_global_select_outbox_events
  ON "outbox_events"
  FOR SELECT
  TO app_worker
  USING (TRUE);

CREATE POLICY worker_global_select_webhook_deliveries
  ON "webhook_deliveries"
  FOR SELECT
  TO app_worker
  USING (TRUE);

CREATE POLICY worker_global_select_email_tracks
  ON "email_tracks"
  FOR SELECT
  TO app_worker
  USING (TRUE);
