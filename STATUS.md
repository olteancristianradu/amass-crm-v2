# STATUS.md

Last updated: 2026-05-04 06:45 Europe/Bucharest
Updated by: Codex
Branch: `main`
Local HEAD: `85e74e3`
Remote HEAD: `origin/main` = `85e74e3`
Local ahead/behind: `0 / 0`
Working tree: dirty; uncommitted web/test/doc changes exist
Runtime checked: yes, local Docker runtime + current Cloudflare quick tunnel

## Current Reality

- App status: local Docker stack is running. Web image was rebuilt and `amass-web` was recreated after web source changes.
- API status: local API health via Caddy returned HTTP `200` at `http://localhost/api/v1/health`.
- Web status: local web root via Caddy returned HTTP `200` at `http://localhost/`.
- Docker status: `amass-api` healthy, `amass-web` healthy after rebuild, `amass-caddy` still running. Caddy/tunnel were not recreated; rechecked at 06:45.
- Cloudflare tunnel: `https://affiliation-rated-tattoo-exports.trycloudflare.com/` and `/api/v1/health` both returned HTTP `200` after web rebuild/restart; rechecked at 06:45.
- Demo URL: same quick tunnel URL remained reachable after web rebuild.
- Demo credentials status: seed demo credentials were verified locally: tenant `demo`, user `admin@amass-demo.ro`, password from seed file. These are demo seed credentials, not real provider credentials.
- Database status: local Postgres reachable; smoke test cleanup verified no live `Smoke Company %` rows remain.
- MinIO/attachments: browser smoke verified upload through UI and download through presigned URL with content comparison after web rebuild.
- Mailpit/email: not verified in this task.
- Redis/queues: Redis container healthy previously; queue/job behavior not separately smoked in this task.

## Verified In This Session

| Area | Result | Evidence |
|---|---:|---|
| git branch | pass | `git branch --show-current` -> `main` |
| git remote | pass | `git remote -v` -> GitHub origin |
| git fetch | pass | `git fetch origin` exit code 0 |
| local vs remote | pass | `git rev-list --left-right --count HEAD...origin/main` -> `0 0` |
| GitHub access | pass | `gh auth status`; `gh run list --limit 5` showed latest remote checks green for `85e74e3` |
| Docker access | pass | Docker compose stack inspected; web rebuilt/restarted |
| Docker web build | pass | `docker compose -f infra/docker-compose.yml build web` |
| Docker web restart | pass | `docker compose -f infra/docker-compose.yml up -d web` |
| Docker health | pass | `docker compose -f infra/docker-compose.yml ps web caddy api`; rechecked at 06:45 |
| API health | pass | `curl -s -o /dev/null -w '%{http_code}' http://localhost/api/v1/health` -> `200`; rechecked at 06:45 |
| web health | pass | `curl -s -o /dev/null -w '%{http_code}' http://localhost/` -> `200`; rechecked at 06:45 |
| Cloudflare API health | pass | `curl ... https://affiliation-rated-tattoo-exports.trycloudflare.com/api/v1/health` -> `200`; rechecked at 06:45 |
| Cloudflare web root | pass | `curl ... https://affiliation-rated-tattoo-exports.trycloudflare.com/` -> `200`; rechecked at 06:45 |
| lint | pass | `pnpm lint` -> Turbo `3 successful, 3 total` |
| typecheck | pass | `pnpm typecheck` -> Turbo `4 successful, 4 total` |
| tests | pass | `pnpm test` -> Turbo `4 successful, 4 total`; API cached `92` files / `973` tests, web `11` files / `52` tests |
| web lint | pass | `pnpm --filter @amass/web lint` |
| web typecheck | pass | `pnpm --filter @amass/web typecheck`; rerun after final attachment test typing cleanup |
| web unit tests | pass | `pnpm --filter @amass/web test` -> `11` files / `52` tests |
| attachment regression | pass | `pnpm --filter @amass/web test -- src/features/attachments/AttachmentsTab.test.tsx`; rerun after final attachment test typing cleanup |
| auth browser smoke | pass | from `apps/web`: `PLAYWRIGHT_BASE_URL=http://localhost ... pnpm exec playwright test e2e/auth-smoke.e2e.ts` after web rebuild |
| critical CRM browser smoke | pass | from `apps/web`: `PLAYWRIGHT_BASE_URL=http://localhost ... pnpm exec playwright test e2e/critical-crm-smoke.e2e.ts` after web rebuild |
| smoke cleanup | pass | `SELECT count(*) ... WHERE name LIKE 'Smoke Company %' AND "deletedAt" IS NULL` -> `0` |
| RLS fail-open check | fail/security finding | As `app_user` without `app.tenant_id`, `companies` returned `122` rows |
| AI worker manual endpoint auth | pass but hardening finding remains | unauth valid-shape `POST http://localhost:8000/process/call` -> `401` |

## Confirmed Working

- Local repo is on `main`, matching `origin/main` at `85e74e3`.
- Local Docker web/API stack is reachable through Caddy at `http://localhost`.
- Rebuilding/restarting only `web` did not change the Cloudflare quick tunnel URL; the tunnel returned HTTP `200` after restart.
- Auth smoke passed in a real browser against the rebuilt web container.
- Critical CRM smoke passed in a real browser against the rebuilt web container: company create/read, attachment upload/download content check, task complete, reminder create/dismiss, cleanup.
- Attachment download client contract is now aligned to API response field `downloadUrl`, with a regression test.

## Known Broken / Open Risks

- RLS policy is fail-open when `app.tenant_id` is missing: local query as `app_user` without tenant context returned tenant rows. This is now tracked as `SEC-004`.
- Notifications Socket.IO gateway uses `origin: '*'` and expects JWT payload `tenantId`, while issued JWTs use `tid`. Tracked as `SEC-005`.
- AI worker manual `/process/call` endpoint is bearer-protected locally, but source allows arbitrary `recordingUrl` fetch after auth. Tracked as `SEC-006`.
- `WEBHOOK_TRUSTED_HOSTS` can bypass webhook DNS/IP SSRF checks and is not production-rejected by env validation. Tracked as `SEC-007`.
- Webhook creation returns raw `secret`; policy needs explicit decision. Tracked as `SEC-008`.
- Full dependency audit still has moderate dev/transitive advisories (`vite`, `esbuild`, `postcss`).
- No local secret scanner was run; `gitleaks` is not installed locally.
- No CI has run for the current uncommitted changes.

## Blocked By Missing Real Credentials

- Twilio: not verified with real SID/token/phone number/webhook setup.
- Stripe: not verified with real keys/webhook secret.
- Google OAuth: not verified with real client ID/secret.
- Microsoft Graph: not verified with real app credentials/scopes.
- Anthropic: not verified with real API key.
- SMTP real: not verified with real SMTP credentials.
- ANAF: not verified with real/sandbox ANAF credentials and fiscal test data.

## Do Not Claim Verified Yet

- Production readiness.
- Stable production domain/HTTPS/VPS.
- CI for current uncommitted changes.
- Real provider integrations.
- Production RLS state.
- Tenant isolation with adversarial cross-tenant browser/API tests after RLS policy hardening.
- Backup/restore.
- Monitoring/alerting.
- Email SMTP delivery with a real provider.

## Percentage Report

- Verified real: 75%
- Unverified: 15%
- Blocked: 10%
