# TEST_REPORT.md

Last updated: 2026-05-03 23:53 Europe/Bucharest

## Latest full verification

| Check | Command | Result | Notes |
|---|---|---:|---|
| git fetch | `git fetch origin` | pass | exit code 0 |
| local/remote compare | `git rev-list --left-right --count HEAD...origin/main` | pass | `0 0` |
| GitHub access | `gh auth status` | pass | logged in as `olteancristianradu`; scopes include `repo`, `workflow` |
| GitHub recent CI | `gh run list --limit 5` | pass for remote only | latest `main` CI and CodeQL for `d325637` completed success; no CI has run for current uncommitted changes |
| Docker daemon | `docker info --format '{{.ServerVersion}}'` | pass | Docker server `29.4.0` |
| Docker health | `docker compose -f infra/docker-compose.yml ps` | pass | local stack listed; API/web/AI worker/Postgres/Redis/MinIO healthy |
| build api | `docker compose -f infra/docker-compose.yml build api` | pass | image `amass-crm-api:latest` built after source change |
| restart api | `docker compose -f infra/docker-compose.yml up -d api` | pass | `amass-api` recreated and started; dependencies healthy |
| lint | `pnpm lint` | pass | rerun at 23:49; Turbo `3 successful, 3 total` |
| typecheck | `pnpm typecheck` | pass | rerun at 23:49; Turbo `4 successful, 4 total` |
| tests | `pnpm test` | pass | rerun at 23:49; Turbo `4 successful, 4 total`; API `92` files / `973` tests; web `10` files / `51` tests |
| focused logging test | `pnpm --filter @amass/api exec vitest run --config vitest.config.unit.ts src/config/logging.spec.ts` | pass | rerun at 23:52; `1` file / `3` tests passed |
| focused calls e2e | `pnpm --filter @amass/api exec vitest run test/calls.e2e.spec.ts` | pass | rerun at 23:52; `1` file / `9` tests passed after test setup fix |
| API e2e | `pnpm --filter @amass/api test:e2e` | pass | rerun at 23:52-23:53; `105` files / `1086` tests passed |
| Prisma generate | `pnpm --filter @amass/api exec prisma generate` | pass | generated API Prisma client |
| Prisma migrate deploy | `DATABASE_URL='postgresql://postgres:postgres@localhost:5432/amass_crm?schema=public' pnpm --filter @amass/api exec prisma migrate deploy` | pass | no pending migrations |
| Prisma drift | `DATABASE_URL='postgresql://postgres:postgres@localhost:5432/amass_shadow?schema=public' SHADOW_DATABASE_URL='postgresql://postgres:postgres@localhost:5432/amass_shadow?schema=public' pnpm --filter @amass/api exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url 'postgresql://postgres:postgres@localhost:5432/amass_shadow?schema=public' --exit-code` | pass | no difference detected |
| production dependency audit | `pnpm audit --prod --audit-level=high` | pass | no known vulnerabilities found |
| full dependency audit | `pnpm audit --audit-level=high` | pass with warnings | exit `0`; 3 moderate advisories remain (`vite`, `esbuild`, `postcss`) |
| dependency audit details | `pnpm audit --json` | fail | exit `1`; details documented in `SECURITY_FINDINGS.md` |
| RLS local state | `docker exec amass-postgres psql -U postgres -d amass_crm -c "SELECT count(*) FILTER ..."` | pass | `83` RLS enabled/forced of `87` public tables |
| RLS local exceptions | `docker exec amass-postgres psql -U postgres -d amass_crm -c "SELECT relname ... AND NOT relrowsecurity"` | pass | non-RLS tables: `_prisma_migrations`, `email_verification_tokens`, `password_reset_tokens`, `tenants` |
| service worker API cache | `sed -n '1,140p' apps/web/public/sw.js` | pass | `/api/` GET requests return before `respondWith`, so SW does not cache authenticated API responses |
| local gitleaks availability | `command -v gitleaks` | fail | tool not installed; no local gitleaks scan was run |
| build web | `docker compose -f infra/docker-compose.yml build web` | not run | no web code/runtime image change in this task |
| health local | `curl -fsS http://localhost:3000/api/v1/health` | pass | rerun at 23:53; returned JSON `status: ok` |
| readiness local | `curl -fsS http://localhost:3000/api/v1/health/ready` | pass | rerun at 23:53; returned JSON `status: ok`, `db: connected` |
| detailed health auth | `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/v1/health/detailed` | pass | returned `401` without token |
| web local | `curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/` | pass | returned `200` |
| AI worker local | `curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/health` | pass | returned `200` |
| health tunnel | `curl -s -o /dev/null -w '%{http_code}' https://affiliation-rated-tattoo-exports.trycloudflare.com/api/v1/health` | pass | rerun at 23:53; returned `200` after API rebuild |
| web tunnel | `curl -s -o /dev/null -w '%{http_code}' https://affiliation-rated-tattoo-exports.trycloudflare.com/` | pass | rerun at 23:53; returned `200` after API rebuild |
| diff whitespace | `git diff --check` | pass | no whitespace errors reported |
| product/design repo inspection | `rg -n "Design system v2|frosted|glass|radius" apps/web/src/styles.css`; `rg -n "CommandPalette|command palette|/ai/search|semantic" apps/web/src -S`; `rg -n "dashboard|KPI|AI|pipeline|activity" apps/web/src/routes apps/web/src/components -S` | pass | used for roadmap proposal; not a functional test |

## Smoke tests

### Attachments

Date: 2026-05-03
Result: pass via API e2e; browser/manual compare not run
Steps:

1. login
2. create/pick entity
3. presign
4. PUT file
5. register attachment
6. list
7. download
8. compare content

Evidence:

```bash
# Covered by: pnpm --filter @amass/api test:e2e
# Result: 105 files / 1086 tests passed.
# Manual browser upload/download and byte-for-byte compare: not run.
```

### Tasks

Date: 2026-05-03
Result: pass via API e2e; browser/manual smoke not run
Steps:

1. create standalone task
2. create linked task
3. complete
4. reopen if applicable

Evidence:

```bash
# Covered by: pnpm --filter @amass/api test:e2e
# Result: 105 files / 1086 tests passed.
# Browser/manual task smoke: not run.
```

### Reminders

Date: 2026-05-03
Result: pass via API e2e; notification/job smoke not separately run
Steps:

1. create reminder
2. list reminder
3. verify notification/job if tested

Evidence:

```bash
# Covered by: pnpm --filter @amass/api test:e2e
# Result: 105 files / 1086 tests passed.
# Separate notification/job smoke: not run.
```

### Auth

Date: 2026-05-03
Result: pass via API e2e; browser/manual auth smoke not run
Steps:

1. login
2. refresh
3. logout
4. invalid token
5. tenant picker if applicable

Evidence:

```bash
# Covered by: pnpm --filter @amass/api test:e2e
# Result: 105 files / 1086 tests passed.
# Browser/manual auth smoke: not run.
```

## Failed tests history

| Date | Failure | Root cause | Fix | Regression test added |
|---|---|---|---|---|
| 2026-05-03 | Initial smoke attempts to `http://localhost:3000/health` and `/health/ready` returned 404. | API uses global prefix `/api/v1`. | Re-ran smoke against `http://localhost:3000/api/v1/health` and `/api/v1/health/ready`; both passed. | Not applicable; process trap documented in `LESSONS.md`. |
| 2026-05-03 | `pnpm --filter @amass/api test:e2e` failed: `test/calls.e2e.spec.ts > AI result callback saves transcript`, expected `200` got `403`. | `AI_WORKER_SECRET` was set in `beforeAll`, after module import-time `loadEnv()` had already cached env without the test secret. | Set deterministic `AI_WORKER_SECRET` in Vitest setup files before module import. | Yes: focused `test/calls.e2e.spec.ts` passed and full `test:e2e` passed. |
| 2026-05-03 | Initial `pnpm --filter @amass/api test:e2e` failed at startup with Pino `default level: must be included in custom levels`. | Local `.env` had empty `LOG_LEVEL`; app used `process.env.LOG_LEVEL ?? fallback`, so empty string bypassed fallback. | Added `resolveLogLevel()` to trim and fall back for empty values; `AppModule` now uses it. | Yes: `src/config/logging.spec.ts` added and passed. |

## Current percentage report

- Verified real: 70%
- Unverified: 20%
- Blocked: 10%
