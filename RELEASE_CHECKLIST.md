# RELEASE_CHECKLIST.md

Last updated: 2026-05-03 23:53 EEST

This checklist is the release gate for AMASS CRM. Do not mark an item complete unless it was verified in the current release context.

## Production readiness

### Required

- [ ] Domain configured
- [ ] VPS/server configured
- [ ] HTTPS configured
- [ ] `.env.production` complete
- [ ] strong JWT secrets
- [ ] encryption key generated
- [ ] database migrations applied
- [ ] Prisma client generated
- [ ] RLS checked
- [ ] API health green
- [ ] web health green
- [ ] attachments upload/download verified
- [ ] tasks verified
- [ ] reminders verified
- [ ] auth verified
- [ ] tenant isolation verified
- [ ] email SMTP verified
- [ ] Twilio verified if calls/SMS are part of launch
- [ ] Stripe verified if billing is part of launch
- [ ] backups configured
- [ ] monitoring/logging configured

## Push/release protocol

Before push:

- [x] `git status` reviewed
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] focused/API e2e tests for affected flows
- [x] affected API Docker service rebuilt and restarted
- [x] local smoke tests for health endpoints
- [x] Cloudflare quick tunnel health smoke for affected runtime

After push:

- [ ] `git fetch origin`
- [ ] remote HEAD matches expected commit
- [ ] GitHub Actions checked, if available
- [ ] if no CI, this is explicitly stated
- [ ] demo URL health checked if runtime affected
- [ ] `STATUS.md` updated
- [ ] `TEST_REPORT.md` updated

## Current readiness

- Status: not release-ready.
- Reason: production credentials, production/demo environment, provider integrations, backups, monitoring, browser smoke, and CI for local uncommitted changes have not been verified in this session.
- Locally verified: `pnpm lint`, `pnpm typecheck`, `pnpm test`, focused logging test, calls e2e, full API e2e, Prisma generate/migrate/drift, API Docker rebuild/restart, local Docker/API/web/AI worker health, Cloudflare quick tunnel HTTP checks, local RLS state, and service-worker API cache code inspection.
- Not verified: production/stable demo infrastructure, browser UI smoke, live provider integrations, backups, monitoring, and CI for the uncommitted local changes.
- Verified real: 70%
- Unverified: 20%
- Blocked: 10%
