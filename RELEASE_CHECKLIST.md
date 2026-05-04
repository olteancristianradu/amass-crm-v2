# RELEASE_CHECKLIST.md

Last updated: 2026-05-04 06:45 EEST

This checklist is the release gate for AMASS CRM. Do not mark production items complete unless they were verified in the current production/release context.

## Production Readiness

### Required

- [ ] Domain configured
- [ ] VPS/server configured
- [ ] HTTPS configured
- [ ] `.env.production` complete
- [ ] strong JWT secrets
- [ ] encryption key generated
- [ ] database migrations applied in production
- [ ] Prisma client generated in production image
- [ ] RLS deny-by-default checked in production
- [ ] API health green on production/stable demo
- [ ] web health green on production/stable demo
- [ ] attachments upload/download verified on production/stable demo
- [ ] tasks verified on production/stable demo
- [ ] reminders verified on production/stable demo
- [ ] auth verified on production/stable demo
- [ ] tenant isolation verified with adversarial tests
- [ ] email SMTP verified with real provider
- [ ] Twilio verified if calls/SMS are part of launch
- [ ] Stripe verified if billing is part of launch
- [ ] Google OAuth verified if calendar/email integrations launch
- [ ] Microsoft Graph verified if Microsoft integrations launch
- [ ] ANAF verified if e-Factura launches
- [ ] backups configured
- [ ] monitoring/logging configured

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

## Current Readiness

- Status: not release-ready.
- Reason: production/stable demo infrastructure, real provider credentials, backups, monitoring, and RLS deny-by-default hardening remain open.
- Locally verified now: lint, typecheck, tests, web build/restart, local/Cloudflare health, auth browser smoke, critical CRM browser smoke.
- Not verified now: production deployment, CI for uncommitted changes, real providers, backup/restore, monitoring.
- Verified real: 75%
- Unverified: 15%
- Blocked: 10%
