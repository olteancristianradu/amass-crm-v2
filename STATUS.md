# STATUS.md

Last updated: 2026-05-03 23:53 Europe/Bucharest
Updated by: Codex
Branch: `main`
Local HEAD: `d325637`
Remote HEAD: `origin/main` = `d325637`
Local ahead/behind: `0 / 0`
Working tree: dirty; uncommitted source/test/doc changes exist pending commit
Runtime checked: yes, local Docker runtime only

## Current reality

- App status: local Docker stack is running; API image was rebuilt and API service was recreated after the local source change. Web image was not rebuilt because no web source changed.
- Product/design status: strategy proposal prepared from current repo inspection and current official competitor sources; no product feature implementation started.
- API status: local API responded on `http://localhost:3000/api/v1/health` and `http://localhost:3000/api/v1/health/ready`.
- Web status: local web root `http://localhost:5173/` returned HTTP `200`.
- Docker status: `docker compose -f infra/docker-compose.yml ps` listed API, web, AI worker, Postgres, Redis, MinIO, Caddy, mocks, Mailpit, and Stripe mock as running; API/web/AI worker/Postgres/Redis/MinIO reported healthy.
- Cloudflare tunnel: quick tunnel URL from `.env` was checked after API rebuild.
- Demo URL: `https://affiliation-rated-tattoo-exports.trycloudflare.com/` returned HTTP `200` after API rebuild.
- Demo credentials status: not verified in this session.
- Database status: API readiness returned `db: connected`; Prisma migrations are applied locally; migration drift check reported no diff; local RLS query showed `83/87` public tables with RLS enabled and forced.
- MinIO/attachments: MinIO container reported healthy; API e2e attachment flow passed, but no browser/manual upload-download comparison was run.
- Mailpit/email: Mailpit container is running; email smoke was not run.
- Redis/queues: Redis container reported healthy; API e2e and unit tests exercised queue-backed paths, but no manual queue dashboard/job smoke was run.

## Verified in this session

| Area | Result | Evidence |
|---|---:|---|
| git branch | pass | `git branch --show-current` -> `main` |
| git remote | pass | `git remote -v` -> `origin https://github.com/olteancristianradu/amass-crm-v2.git` |
| git fetch | pass | `git fetch origin` exit code 0 |
| local vs remote | pass | `git rev-list --left-right --count HEAD...origin/main` -> `0 0` |
| GitHub access | pass | `gh auth status` logged in as `olteancristianradu` with `repo`, `workflow` scopes |
| latest GitHub checks | pass for remote only | `gh run list --limit 5` showed latest `main` CI and CodeQL success for `d325637`; no CI has run for current uncommitted changes |
| Docker access | pass | `docker info --format '{{.ServerVersion}}'` -> `29.4.0` |
| Docker health | pass | `docker compose -f infra/docker-compose.yml ps` |
| API Docker build | pass | `docker compose -f infra/docker-compose.yml build api` |
| API Docker restart | pass | `docker compose -f infra/docker-compose.yml up -d api` |
| API health | pass | `curl -fsS http://localhost:3000/api/v1/health` rerun at 23:53 -> `status: ok` |
| API readiness | pass | `curl -fsS http://localhost:3000/api/v1/health/ready` rerun at 23:53 -> `status: ok`, `db: connected` |
| Cloudflare API health | pass | `curl -s -o /dev/null -w '%{http_code}' https://affiliation-rated-tattoo-exports.trycloudflare.com/api/v1/health` rerun at 23:53 -> `200` |
| Cloudflare web root | pass | `curl -s -o /dev/null -w '%{http_code}' https://affiliation-rated-tattoo-exports.trycloudflare.com/` rerun at 23:53 -> `200` |
| detailed health auth | pass | `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/v1/health/detailed` -> `401` without token |
| web health | pass | `curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/` -> `200` |
| AI worker health | pass | `curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/health` -> `200` |
| lint | pass | `pnpm lint` rerun at 23:49 -> Turbo `3 successful, 3 total` |
| typecheck | pass | `pnpm typecheck` rerun at 23:49 -> Turbo `4 successful, 4 total` |
| tests | pass | `pnpm test` rerun at 23:49 -> API `92` files / `973` tests, web `10` files / `51` tests |
| focused logging test | pass | `pnpm --filter @amass/api exec vitest run --config vitest.config.unit.ts src/config/logging.spec.ts` rerun at 23:52 -> `1` file / `3` tests passed |
| focused calls e2e | pass | `pnpm --filter @amass/api exec vitest run test/calls.e2e.spec.ts` rerun at 23:52 -> `1` file / `9` tests passed |
| API e2e | pass | `pnpm --filter @amass/api test:e2e` rerun at 23:52-23:53 -> `105` files / `1086` tests passed |
| Prisma generate | pass | `pnpm --filter @amass/api exec prisma generate` |
| Prisma migrate deploy | pass | `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/amass_crm?schema=public pnpm --filter @amass/api exec prisma migrate deploy` -> no pending migrations |
| Prisma drift | pass | `pnpm --filter @amass/api exec prisma migrate diff ... --exit-code` against local shadow DB -> no difference detected |
| prod dependency audit high | pass | `pnpm audit --prod --audit-level=high` -> no known vulnerabilities |
| full dependency audit high | pass with warnings | `pnpm audit --audit-level=high` exit `0`, but moderate advisories remain |
| RLS state | pass local | `docker exec amass-postgres psql ...` -> `83` RLS enabled/forced of `87` public tables; non-RLS tables: `_prisma_migrations`, `email_verification_tokens`, `password_reset_tokens`, `tenants` |
| service worker API cache | pass code inspection | `apps/web/public/sw.js` returns before `respondWith` for `/api/` GET requests |
| frontend build | not run | no frontend code changed in this task |
| attachments | pass API e2e only | covered by `pnpm --filter @amass/api test:e2e`; browser/manual compare not run |
| tasks | pass API e2e only | covered by `pnpm --filter @amass/api test:e2e`; browser/manual smoke not run |
| reminders | pass API e2e only | covered by `pnpm --filter @amass/api test:e2e`; notification/job smoke not separately run |

## Confirmed working

- Local git access and remote fetch.
- GitHub CLI access for repository and workflow inspection.
- Local Docker daemon access.
- Local Docker stack visibility with `infra/docker-compose.yml`.
- Local API liveness and readiness endpoints under `/api/v1`.
- Local web root responds HTTP `200`.
- Cloudflare quick tunnel URL still responds after API rebuild.
- Local AI worker health endpoint responds HTTP `200`.
- Baseline repo checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- API e2e suite after local fixes: `105` files / `1086` tests.
- Local Prisma migrate/drift check.
- Local RLS state query for public tables.

## Known broken

- Direct `http://localhost:3000/health` and `/health/ready` returned 404 because the API global prefix is `/api/v1`. This is a workflow gotcha, not confirmed application breakage.
- `pnpm audit --json` reports moderate advisories in dev/transitive dependencies: `vite`, `esbuild`, and `postcss`. `pnpm audit --prod --audit-level=high` passed.
- `gitleaks` is not installed locally, so no local gitleaks scan was run.
- Web image was not rebuilt because no web source changed.
- Product/design roadmap is not implemented; `UNFINISHED.md` now tracks the AMASS Pro Cockpit, Entity 360, Command Palette V2, UX performance budgets, and Romania/EU vertical packs as open work.

## Blocked by missing real credentials

- Twilio: not verified with real SID/token/phone number.
- Stripe: not verified with live or real test keys/webhook secret in this session.
- Google OAuth: not verified with real client ID/secret in this session.
- Microsoft Graph: not verified with real app credentials/scopes in this session.
- Anthropic: not verified with real API key in this session.
- SMTP real: not verified with real SMTP credentials in this session.
- ANAF: not verified with real OAuth/client credentials in this session.

## Do not claim verified yet

- Production readiness.
- Stability of the Cloudflare quick tunnel after process restart.
- Demo credentials.
- Authenticated browser UI flows.
- Tenant isolation with real data.
- Production RLS state.
- Attachment upload/download through browser/demo URL.
- Tasks and reminders through browser/demo URL.
- Email sending with real SMTP.
- Twilio calls/SMS/WhatsApp.
- Stripe billing/webhooks.
- Google OAuth and Microsoft Graph integrations.
- Anthropic/OpenAI/Gemini behavior with real keys.
- ANAF/e-Factura real integration.
- Backup/restore.
- Monitoring/alerting.

## Percentage report

- Verified real: 70%
- Unverified: 20%
- Blocked: 10%
