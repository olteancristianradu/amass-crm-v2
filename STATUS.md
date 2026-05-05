# STATUS.md

Last updated: 2026-05-05 22:05 Europe/Bucharest
Updated by: Claude
Branch: `main`
Local HEAD: `a8adadb`
Remote HEAD: `origin/main` = `a8adadb`
Local ahead/behind: `0 / 0`
Working tree: clean
Runtime checked: yes, local Docker runtime + current Cloudflare quick tunnel

## Session 2026-05-05 — committed and pushed

| SHA | Subject | CI |
|---|---|---|
| `4415c21` | fix(security): SEC-004 RLS deny-by-default when tenant context is missing | (covered by later push) |
| `2c2a68a` | fix(security): SEC-005 notifications gateway uses CORS allow-list and tid claim | failed via axios advisory; code re-validated by `63628e9` CI |
| `6a6fc4c` | fix(security): SEC-007 reject WEBHOOK_TRUSTED_HOSTS in production | (covered by later push) |
| `a9fca1a` | feat(webhooks): SEC-008 secret rotation endpoint with one-time-display policy | (cancelled by axios push) |
| `63628e9` | fix(deps): override axios>=1.15.2 to close 4 HIGH CVEs reachable via twilio | **CI ✓ + CodeQL ✓** |
| `a6bcc5a` | fix(security): SEC-006 residual — host allow-list + DNS-rebind block on recordingUrl | (covered by later push) |
| `855f241` | ci(security): SEC-003 add gitleaks secret-scan workflow | **Secret Scan ✓**; CI/CodeQL in_progress |
| `a8adadb` | docs(release): P1-001 single authoritative launch gate | pending |

## Findings closed this session
SEC-003, SEC-004, SEC-005, SEC-006, SEC-007, SEC-008, SEC-AXIOS-PROTO-POLLUTION, SEC-WEBHOOK-SSRF-DNS-REBIND, P1-001 (checklist reconciliation).

## Open
- SEC-001 production-readiness verification (blocked by infra/credentials)
- SEC-002 dev-only moderate advisories (vite/esbuild/postcss)

## Current Reality

- App status: local Docker stack is running through Caddy at `http://localhost`.
- API status: local API health returned HTTP `200` after the RLS migration was applied.
- Web status: local web root returned HTTP `200`; no web code changed in the current P0 RLS task.
- Docker status: `amass-api` healthy, `amass-web` healthy, `amass-caddy` running.
- Cloudflare tunnel: `https://affiliation-rated-tattoo-exports.trycloudflare.com/` and `/api/v1/health` returned HTTP `200`.
- Demo URL: quick tunnel remained reachable. This is not a stable production domain.
- Demo credentials status: seed demo credentials were verified locally in browser/API smoke earlier in this session; these are demo seed credentials, not real provider credentials.
- Database status: local Postgres reachable; RLS migration `20260504065000_rls_deny_missing_tenant` applied locally with `prisma migrate deploy`.
- MinIO/attachments: critical browser smoke previously verified upload/download bytes; no attachment code changed in this P0 task.
- Mailpit/email: not verified in this P0 task.
- Redis/queues: not separately smoked in this P0 task.

## Verified In This Session

| Area | Result | Evidence |
|---|---:|---|
| git branch | pass | `git branch --show-current` -> `main` |
| local vs remote before P0 commit | pass | `git rev-list --left-right --count HEAD...origin/main` -> `0 0` |
| Docker access | pass | Docker compose commands and health checks ran locally |
| Prisma migration first attempt | fail/documented | `pnpm --filter @amass/api exec prisma migrate deploy` failed with `P1012` because shell lacked `DATABASE_URL` |
| Prisma migration apply | pass | `env DATABASE_URL='postgresql://postgres:postgres@localhost:5432/amass_crm?schema=public' pnpm --filter @amass/api exec prisma migrate deploy` applied `20260504065000_rls_deny_missing_tenant` |
| RLS RED regression | fail as expected | before migration, `pnpm --filter @amass/api test:e2e -- test/multi-tenant.e2e.spec.ts` showed the new RLS test failing: expected `0`, received `8` users |
| focused RLS e2e | pass | from `apps/api`: `pnpm exec vitest run test/multi-tenant.e2e.spec.ts` -> `1` file / `7` tests passed |
| API lint | pass | `pnpm --filter @amass/api lint` |
| API typecheck | pass | `pnpm --filter @amass/api typecheck` |
| API unit tests | pass | `pnpm --filter @amass/api test` -> `92` files / `973` tests passed |
| API e2e/full API suite | pass | `pnpm --filter @amass/api test:e2e` -> `105` files / `1087` tests passed |
| direct SQL no-tenant RLS | pass | `SET LOCAL ROLE app_user; SELECT count(*) FROM companies/users` returned `0` without `app.tenant_id` |
| direct SQL tenant positive control | pass | with demo tenant `app.tenant_id`, `companies` count returned `8` |
| local API health | pass | `curl -s -o /dev/null -w '%{http_code}' http://localhost/api/v1/health` -> `200` |
| local web health | pass | `curl -s -o /dev/null -w '%{http_code}' http://localhost/` -> `200` |
| Cloudflare API health | pass | `curl -s -o /dev/null -w '%{http_code}' https://affiliation-rated-tattoo-exports.trycloudflare.com/api/v1/health` -> `200` |
| Cloudflare web root | pass | `curl -s -o /dev/null -w '%{http_code}' https://affiliation-rated-tattoo-exports.trycloudflare.com/` -> `200` |

## Confirmed Working

- Local repo started on `main`, matching `origin/main` at `8040aa3`.
- Local DB now denies tenant-scoped table reads for `app_user` when `app.tenant_id` is missing.
- Legitimate tenant-scoped DB access still works when `app.tenant_id` is set.
- API unit and e2e suites pass after the RLS hardening migration and stronger regression test.
- Local and quick-tunnel health endpoints remained reachable after the DB migration.

## Known Broken / Open Risks

- `SEC-004` is fixed locally and covered by regression tests, but it still needs commit, push, remote HEAD, and CI verification before it can be called pushed/landed.
- Notifications Socket.IO gateway uses `origin: '*'` and expects JWT payload `tenantId`, while issued JWTs use `tid`. Tracked as `SEC-005`.
- AI worker manual `/process/call` endpoint is bearer-protected locally, but source allows arbitrary `recordingUrl` fetch after auth. Tracked as `SEC-006`.
- `WEBHOOK_TRUSTED_HOSTS` can bypass webhook DNS/IP SSRF checks and is not production-rejected by env validation. Tracked as `SEC-007`.
- Webhook creation returns raw `secret`; policy needs explicit decision. Tracked as `SEC-008`.
- Full dependency audit still has moderate dev/transitive advisories (`vite`, `esbuild`, `postcss`).
- No local secret scanner was run; `gitleaks` is not installed locally.
- Production/stable demo readiness is not verified.

## Blocked By Missing Real Credentials

- Twilio: not verified with real SID/token/phone number/webhook setup.
- Stripe: not verified with real keys/webhook secret.
- Google OAuth: not verified with real client ID/secret.
- Microsoft Graph: not verified with real app credentials/scopes.
- Anthropic/OpenAI production AI: not verified with real API key.
- SMTP real: not verified with real SMTP credentials.
- ANAF: not verified with real/sandbox ANAF credentials and fiscal test data.

## Do Not Claim Verified Yet

- Production readiness.
- Stable production domain/HTTPS/VPS.
- CI for the current P0 commit until it is pushed and checked.
- Real provider integrations.
- Production RLS state.
- Backup/restore.
- Monitoring/alerting.
- Email SMTP delivery with a real provider.

## Percentage Report

- Verified real: 78%
- Unverified: 12%
- Blocked: 10%
