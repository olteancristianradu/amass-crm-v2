# RELEASE_CHECKLIST.md

Last updated: 2026-05-05 22:00 EEST

This is the **single authoritative launch gate** for AMASS CRM. The older
`LAUNCH_CHECKLIST.md` is kept as historical S12/S13 reference but is
deprecated; do not add new items there.

Do not mark production items complete unless they were verified in the
current production/release context. Each item must reference an evidence
file (commit, log, screenshot URL).

## Production Readiness

### Infra (blocked by user — provider/hosting choice)

- [ ] Domain configured (registrar + DNS)
- [ ] VPS/server provisioned (Hetzner/Railway/Fly recommended)
- [ ] HTTPS configured (Caddy auto-https, certs renew)
- [ ] `.env.production` complete with all required values from `env.ts`
- [ ] backups configured (Postgres dump cadence, MinIO bucket replication)
- [ ] monitoring/logging configured (Sentry DSN, Pino → log shipper)

### Secrets & cryptography (operator-generated)

- [ ] `JWT_SECRET` and `JWT_REFRESH_SECRET` ≥ 32 chars, distinct, fresh for prod (NOT dev values)
- [ ] `ENCRYPTION_KEY` 64-hex regenerated for prod
- [ ] `AI_WORKER_SECRET` 64-hex regenerated for prod
- [ ] `METRICS_AUTH_TOKEN` set OR `METRICS_ALLOWED_IPS` set (env validation enforces this in prod)
- [ ] `CORS_ALLOWED_ORIGINS` does NOT contain `*` (env validation enforces this in prod)
- [ ] `WEBHOOK_TRUSTED_HOSTS` empty in prod (env validation enforces — `6a6fc4c`)

### Database / RLS / migrations

- [ ] `prisma migrate deploy` applied successfully on prod DB (and Prisma client regenerated in image)
- [ ] RLS deny-by-default applied (migration `20260504065000_rls_deny_missing_tenant`, `4415c21`) — verify with `BEGIN; SET LOCAL ROLE app_user; SELECT count(*) FROM companies; ROLLBACK;` → `0`
- [ ] All 83 tenant-scoped tables show `rowsecurity=t` AND `forcerowsecurity=t` in `pg_tables`
- [ ] PgBouncer (if used) configured with transaction pooling and `?pgbouncer=true&statement_cache_size=0`

### Smoke tests on production/stable demo URL

- [ ] API `/api/v1/health` → 200
- [ ] Web root → 200
- [ ] Auth: register, login, refresh, logout
- [ ] Companies CRUD
- [ ] Contacts CRUD
- [ ] Clients CRUD
- [ ] Deals + pipeline DnD
- [ ] Tasks (linked to deal, linked to subject, standalone) + complete + reopen
- [ ] Reminders (linked + `/reminders/me`) + dismiss + WS realtime push verified
- [ ] Notes + timeline
- [ ] Attachments upload + presigned download with byte-comparison
- [ ] Email account add + send + tracking pixel + reply detection
- [ ] Calls outbound + status webhook + recording webhook + AI callback
- [ ] Notifications WS connection joins correct `tenant:{tid}:user:{sub}` room (`2c2a68a`)
- [ ] Adversarial multi-tenant test: tenant B 404 on tenant A entity IDs

### Integrations (each blocks only its own feature)

- [ ] Email SMTP — real provider (Mailgun/SendGrid/Postmark) with from-domain SPF+DKIM+DMARC
- [ ] Twilio — real SID/token, phone number purchased, webhook URL in console = prod
- [ ] Stripe — real keys, webhook signing secret, prices created with matching IDs in env
- [ ] Google OAuth — real client ID/secret, redirect URI = `{API_BASE_URL}/api/v1/calendar/callback/google`
- [ ] Microsoft Graph — real app registration with Mail.Send + Calendars.ReadWrite scopes
- [ ] Anthropic — real API key (or Gemini fallback) — verify deal AI suggestions return real text
- [ ] ANAF e-Factura — real OAuth credentials, sandbox→prod cutover, fiscal data populated

## Local Runtime Readiness Snapshot

- [x] Local Docker web rebuilt after web source changes
- [x] Local web container restarted and healthy
- [x] Local web root via Caddy returned `200`
- [x] Local API health via Caddy returned `200`
- [x] Cloudflare quick tunnel web root returned `200` after web restart
- [x] Cloudflare quick tunnel API health returned `200` after web restart
- [x] Auth browser smoke passed
- [x] Critical CRM browser smoke passed: company, attachment upload/download content, task, reminder, cleanup
- [x] Local smoke data cleanup checked

## Push/Release Protocol

Before push:

- [x] `git status` reviewed
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] focused tests for changed web code
- [x] affected Docker service rebuilt if needed (`web`)
- [x] smoke tests for affected browser/runtime flows

After push:

- [ ] `git fetch origin`
- [ ] remote HEAD matches expected commit
- [ ] GitHub Actions checked, if available
- [ ] if no CI, this is explicitly stated
- [ ] demo URL health checked if runtime affected
- [ ] `STATUS.md` updated
- [ ] `TEST_REPORT.md` updated

## Current Readiness — 2026-05-05

- Status: **not release-ready**.
- Reason: production infrastructure, real provider credentials, backups, and monitoring still open. Code quality is high; deploy gate isn't.
- Locally verified now: lint, typecheck, API 983/983 + web 52/52 unit tests, RLS DB-level deny-by-default, `pnpm audit --prod --audit-level=high` clean, local + Cloudflare health 200, recent (2026-05-04) auth + critical-crm Playwright smokes.
- Not verified now: production deployment, real providers, backup/restore drill, monitoring, performance budgets.
- Security findings open: SEC-001 (prod readiness), SEC-002 (dev-only moderate advisories).
- Security findings closed in this session: SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-AXIOS-PROTO-POLLUTION.

| Bucket | % |
|---|---:|
| Verified real (code, lint, types, unit/integration tests, RLS, security findings closed) | 80% |
| Unverified (production deploy, monitoring, backups, performance budgets, real provider integrations end-to-end) | 12% |
| Blocked (real provider credentials, hosting/domain decisions) | 8% |
