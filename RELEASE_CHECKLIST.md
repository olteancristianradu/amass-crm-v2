# RELEASE_CHECKLIST.md

Last updated: 2026-05-14 16:00 EEST

This is the **single authoritative launch gate** for AMASS CRM. The older
`LAUNCH_CHECKLIST.md` was removed 2026-05-11 (its content was absorbed
here months earlier).

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
- [ ] `CHANGELOG.md` updated for user-visible changes
- [ ] `LESSONS.md` updated if anything surprised or broke

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

## Current Readiness — 2026-05-14 (demo session, pre-pitch with Dana)

- Status: **not release-ready** (same blocker — production infra). Demo-ready on Cloudflare quick tunnel.
- Twilio integration: real Trial credentials wired (`AC17ff…`), purchased US number `+19786277500`, voice + status + recording webhooks pointed at the tunnel. One outgoing caller ID verified (`+40754070368`). Live call test: 13s, $0.028, full webhook lifecycle observed, recording downloaded, Whisper transcribe + attachment auto-create end-to-end. Trial restriction (only verified caller IDs can be dialled) acknowledged — `$20` Pay-As-You-Go upgrade needed to dial arbitrary RO numbers.
- Whisper transcription: `large-v3` activated (96-98% RO accuracy, ~0.7× real-time on CPU). 30-min call → ~45-min processing; acceptable for async pipeline, not for thousands of concurrent calls without GPU.
- Pipeline AI end-to-end: verified live on call `cmp5gzwi0…`: Twilio → recording webhook → MinIO upload → Whisper transcribe → `/ai-result` POST → `Call.recordingStorageKey` + `Attachment` row + `call.transcribed` activity log all created automatically.
- Daily agent calls report: new `/reports/agent-calls` endpoint + `Desfășurător apeluri zi` tab on `/app/reports`. Format MM:SS, grouped per agent, contact name lookup across CONTACT/CLIENT/COMPANY.
- 4 P1 contract bugs fixed: Custom Field create (missing `label`), Webhook create (events min(1) → events allowed empty), Forecasting periodType (FE/BE enum mismatch), Custom Fields list path (`/defs` sub-route).
- 1 P1 UX bug fixed: Company detail had no Delete button (added Trash2 button + confirm + toast).
- 1 P1 webhook bug fixed: `Activity dropped — no tenant context` when Twilio status_callback hit, because webhook runs outside JWT/ALS. `ActivityEntry` now accepts explicit `tenantId`.
- 1 P1 importer bug fixed: real GestCom PDF (149 pages) imported with 96/96 records OK (previously 6376 false rows, 0 success) — root cause was `ImportProcessor` bypassing the adapter chain.
- Docker bloat fix: `amass-ai-worker` 9.02 GB → 1.96 GB by pinning CPU-only torch.
- Locally verified now (this session): API rebuild + recreate verified, 3 parallel sub-agent A-Z UI smokes covered ~41 pages across VÂNZĂRI / SERVICE / MARKETING / OPERAȚIONAL / INSIGHTS / ADMINISTRARE / CLIENȚI with zero JS crashes, custom-field/webhook/company-delete fixes verified via tunnel.
- Demo data live: 96 GestCom clients (Ioana Podina, Ion Deaconu, etc.), Mihai Ionescu contact with 4 calls + 1 recording mp3, 4 OPEN deals (3 in Cockpit "deals-in-danger"), Dashboard + Reports + Cockpit all populated.
- Demo URL: `https://thumbnails-arm-change-mai.trycloudflare.com` (Cloudflare quick tunnel; URL changes on restart — NOT stable for non-demo use).
- Demo creds: `danarulea@test.ro` / `Dana2026!` / tenant `Dana Test` (`dana-test`).
- Documentation hygiene: control docs updated at session end (back-filled in one batch — see 2026-05-14 entry in `LESSONS.md`).

### Open from RELEASE_CHECKLIST that this session did NOT close

- Production hosting (still on Mac mini + Cloudflare quick tunnel — not stable).
- Real domain (still `*.trycloudflare.com`).
- `.env.production` with real credentials for Stripe, Mailgun/SendGrid, Google OAuth, Microsoft Graph, ANAF (currently all dev/mock except Twilio Trial).
- Backups: no automated Postgres dump / MinIO replication.
- Monitoring: Sentry DSN unset, Grafana running locally only.
- Performance budgets: not enforced in CI.
- Adversarial multi-tenant penetration test on production-like host: not done.

### What's safe to demo tomorrow (verified path)

1. Login Dana → Dashboard.
2. Pro Cockpit → 3 deals-in-danger.
3. Contacts → Mihai Ionescu → tab Apeluri (4 calls), tab Fișiere (recording mp3).
4. Reports → Desfășurător apeluri zi → 4 calls MM:SS.
5. Click-to-call live: edit a contact's phone to `+40754070368`, click "Sună" — telefonul tău sună (caller-ID = US Twilio number), recording + transcript + attachment appear automatically after ~1-2 min.
6. Clients → 50+ GestCom clients visible.

### What to avoid in demo

- Calling any number other than `+40754070368` (Trial blocks unverified destinations).
- Demonstrating live transcription as a wow factor (large-v3 takes 30-45 min for a 30-min call; demo seed is faster).
- Settings → Email (path is `/app/email-settings` not `/app/settings/email`).
- Imports history page (doesn't exist as a separate route; view results via `/app/clients`).
