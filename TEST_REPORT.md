# TEST_REPORT.md

Last updated: 2026-05-04 06:45 Europe/Bucharest

## Latest Verification

| Check | Command | Result | Notes |
|---|---|---:|---|
| git fetch | `git fetch origin` | pass | exit code 0 |
| local/remote compare | `git rev-list --left-right --count HEAD...origin/main` | pass | `0 0` |
| GitHub recent CI | `gh run list --limit 5` | pass for remote only | latest checks are green for `85e74e3`; no CI for current uncommitted changes |
| Docker web build | `docker compose -f infra/docker-compose.yml build web` | pass | pre-push rerun; Docker cache used |
| Docker web restart | `docker compose -f infra/docker-compose.yml up -d web` | pass | `amass-web` recreated and healthy |
| Docker health | `docker compose -f infra/docker-compose.yml ps web caddy api` | pass | web/API healthy; caddy still running; rechecked at 06:45 |
| web local via Caddy | `curl -s -o /dev/null -w '%{http_code}' http://localhost/` | pass | `200`; rechecked at 06:45 |
| API health via Caddy | `curl -s -o /dev/null -w '%{http_code}' http://localhost/api/v1/health` | pass | `200`; rechecked at 06:45 |
| web tunnel | `curl -s -o /dev/null -w '%{http_code}' https://affiliation-rated-tattoo-exports.trycloudflare.com/` | pass | `200` after web rebuild; rechecked at 06:45 |
| API tunnel | `curl -s -o /dev/null -w '%{http_code}' https://affiliation-rated-tattoo-exports.trycloudflare.com/api/v1/health` | pass | `200` after web rebuild; rechecked at 06:45 |
| web lint | `pnpm --filter @amass/web lint` | pass | earlier focused run; repo lint rerun pre-push |
| web typecheck | `pnpm --filter @amass/web typecheck` | pass | earlier focused run; repo typecheck rerun pre-push |
| attachment regression | `pnpm --filter @amass/web test -- src/features/attachments/AttachmentsTab.test.tsx` | pass | rerun after final attachment test typing cleanup; `1` test passed |
| web tests | `pnpm --filter @amass/web test` | pass | `11` files / `52` tests passed |
| repo lint | `pnpm lint` | pass | Turbo `3 successful, 3 total` |
| repo typecheck | `pnpm typecheck` | pass | Turbo `4 successful, 4 total` |
| repo tests | `pnpm test` | pass | Turbo `4 successful, 4 total`; API result replayed from cache, web reran with `52` tests |
| auth browser smoke | from `apps/web`: `PLAYWRIGHT_BASE_URL=http://localhost SMOKE_TENANT_SLUG=demo SMOKE_EMAIL=admin@amass-demo.ro SMOKE_PASSWORD='AmassCRM2026!' pnpm exec playwright test e2e/auth-smoke.e2e.ts` | pass | after web rebuild; `1` test passed |
| critical CRM browser smoke | from `apps/web`: `PLAYWRIGHT_BASE_URL=http://localhost SMOKE_TENANT_SLUG=demo SMOKE_EMAIL=admin@amass-demo.ro SMOKE_PASSWORD='AmassCRM2026!' pnpm exec playwright test e2e/critical-crm-smoke.e2e.ts` | pass | after web rebuild; `1` test passed |
| smoke cleanup | `docker exec amass-postgres psql ... SELECT count(*) ...` | pass | live `Smoke Company %` rows = `0` |
| RLS no-tenant query | `docker exec amass-postgres psql ... SET LOCAL ROLE app_user; SELECT ... FROM companies` | fail/security | returned `122` rows without `app.tenant_id`; see `SEC-004` |
| AI worker unauth manual process | `curl ... http://localhost:8000/process/call` | pass for auth gate | valid-shape unauth request returned `401`; SSRF hardening remains open |

## Smoke Tests

### Auth

Date: 2026-05-04
Result: pass

Steps:

1. Open `http://localhost/login`.
2. Fill demo email/password.
3. Submit login.
4. Verify authenticated `/app` or `/app/welcome` shell renders.

Evidence:

```bash
cd apps/web
PLAYWRIGHT_BASE_URL=http://localhost SMOKE_TENANT_SLUG=demo SMOKE_EMAIL=admin@amass-demo.ro SMOKE_PASSWORD='AmassCRM2026!' pnpm exec playwright test e2e/auth-smoke.e2e.ts
# 1 passed
```

### Critical CRM Browser Flow

Date: 2026-05-04
Result: pass

Steps:

1. Seed browser session from one API login.
2. Create a company in UI.
3. Open company detail.
4. Upload text attachment in UI.
5. List attachment via API, fetch presigned download URL, download bytes, compare content.
6. Create and complete linked task in UI.
7. Create and dismiss linked reminder in UI.
8. Delete smoke company via API cleanup.

Evidence:

```bash
cd apps/web
PLAYWRIGHT_BASE_URL=http://localhost SMOKE_TENANT_SLUG=demo SMOKE_EMAIL=admin@amass-demo.ro SMOKE_PASSWORD='AmassCRM2026!' pnpm exec playwright test e2e/critical-crm-smoke.e2e.ts
# 1 passed
```

### Attachments

Date: 2026-05-04
Result: pass

Evidence:

```bash
pnpm --filter @amass/web test -- src/features/attachments/AttachmentsTab.test.tsx
# 1 passed

PLAYWRIGHT_BASE_URL=http://localhost ... pnpm exec playwright test e2e/critical-crm-smoke.e2e.ts
# upload + presigned download content comparison passed
```

### Tasks

Date: 2026-05-04
Result: pass

Evidence:

```bash
PLAYWRIGHT_BASE_URL=http://localhost ... pnpm exec playwright test e2e/critical-crm-smoke.e2e.ts
# linked task created and completed in UI
```

### Reminders

Date: 2026-05-04
Result: pass

Evidence:

```bash
PLAYWRIGHT_BASE_URL=http://localhost ... pnpm exec playwright test e2e/critical-crm-smoke.e2e.ts
# linked reminder created and dismissed in UI
```

## Failed Tests / Failures History

| Date | Failure | Root cause | Fix | Regression test added |
|---|---|---|---|---|
| 2026-05-04 | Playwright reported `No tests found` for `e2e/auth-smoke.e2e.ts`. | Playwright default `testMatch` did not include `*.e2e.ts`. | Added `testMatch: '**/*.e2e.ts'` in `apps/web/playwright.config.ts`. | Existing auth smoke now runs. |
| 2026-05-04 | Auth smoke waited for non-existent tenant/slug field. | Login UI was simplified; backend resolves tenant from email unless picker is needed. | Updated auth smoke to fill email/password and handle tenant picker only if shown. | `e2e/auth-smoke.e2e.ts` passed. |
| 2026-05-04 | Auth smoke waited for button regex that missed `Conectare`. | Selector matched `login/autentific`, not actual Romanian button label. | Added `conectare` to regex. | `e2e/auth-smoke.e2e.ts` passed. |
| 2026-05-04 | Critical smoke aborted login and got redirected to `/login`. | Test navigated to `/app/companies` before async UI login finished. | Critical smoke now uses one API login and seeded browser session; auth UI is covered separately. | `e2e/critical-crm-smoke.e2e.ts` added. |
| 2026-05-04 | Critical smoke hit `429 Too Many Requests`. | Test performed API login plus UI login in same flow, tripping auth limiter. | Removed second login from critical flow; only auth smoke performs UI login. | `e2e/critical-crm-smoke.e2e.ts` passed. |
| 2026-05-04 | Critical smoke hung on reminder action. | Cookie banner remained open and could intercept lower-page actions. | Added `dismissCookieBanner()` to browser smoke. | `e2e/critical-crm-smoke.e2e.ts` passed. |
| 2026-05-04 | Attachment download UI would open `undefined`. | Web client expected `{ url }`, API returns `{ downloadUrl }`. | Updated web client/component to use `downloadUrl`. | `AttachmentsTab.test.tsx` added and passed. |
| 2026-05-04 | Root-level Playwright command failed with `Command "playwright" not found`. | Playwright is a dev dependency of `@amass/web`, not the repo root package. | Reran from `apps/web` with `pnpm exec playwright ...`. | Auth and critical CRM smoke both passed from `apps/web`. |

## Current Percentage Report

- Verified real: 75%
- Unverified: 15%
- Blocked: 10%
