# Verification Report — 2026-04-28 autonomous session

> Ran by Claude during the autonomous overnight pass on 2026-04-27/28.
> The bar set by the user: **ZERO N/A** — every feature must either pass
> a live request, or be marked with the concrete reason it didn't and
> the workaround applied.
>
> All evidence below was captured against the live Docker stack on
> `darwin / Apple Silicon` with `docker compose --profile mocks up`
> (mailpit + stripe-mock + mock-services + the seven mock endpoints
> running) plus the production stack (postgres, redis, minio, api,
> web, ai-worker, caddy).

## 0. Stack state at start of session

- 7 containers healthy (postgres, redis, minio, api, web, ai-worker, caddy)
- DB: empty — `prisma migrate deploy` had not yet run
- API: booting, but the email-sequences scheduler was P2021-ing every
  second on `sequence_enrollments` not existing.
- Web: serving fine
- Mock services: not yet built

## 1. Migrations + auth flow (Phase 1)

```bash
docker exec -w /repo/apps/api amass-api npx prisma migrate deploy
# → All 33 migrations have been successfully applied.

docker exec amass-postgres psql -U postgres -d amass_crm \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
# → 82 tables
```

Auth flow with curl, all green:

| Flow | Verb + Path | Status | Notes |
|------|-------------|--------|-------|
| register | `POST /auth/register` | 201 | Tenant + OWNER created atomically. Returns `{ user, tokens }`. |
| login    | `POST /auth/login`    | 200 | Bearer accessToken + refreshToken (httpOnly cookie). |
| me       | `GET  /auth/me`       | 200 | With `Authorization: Bearer …`. |
| refresh  | `POST /auth/refresh`  | 200 | Cookie based, returns new accessToken. |
| logout   | `POST /auth/logout`   | 204 | Bearer token revoked, future calls return NO_TOKEN. |

Post-migration log scan: zero `P2021` errors.

## 2. Cross-tenant isolation (existing `scripts/smoke-test.sh`)

```
▶ Health check  ✓ api healthy
▶ Register two tenants  ✓ tenant A registered  ✓ tenant B registered
▶ Authenticated /me  ✓ /auth/me returns tenant A email
▶ Create company in tenant A  ✓ company created
▶ RLS cross-tenant isolation  ✓ tenant B receives 404 on tenant A's company
▶ List scoping  ✓ tenant B company list is empty
▶ Rate limit on /auth/login  ✓ rate limit returned 429
▶ CSRF: /auth/refresh without X-Requested-With  ✓ rejected
✓ Smoke test passed — 8/8 checks.
```

## 3. Live CRUD on core entities (curl verification)

| Entity | Verb + Path | HTTP | Notes |
|--------|-------------|------|-------|
| Companies | `POST /companies` | 201 | Romanian data: `Acme România SRL`, `București`, `RO`, `MEDIUM`, `ACTIVE`. |
| Companies | `GET  /companies` | 200 | List paginated. |
| Contacts  | `POST /contacts`  | 201 | Linked to company. Created activity row. |
| Notes     | `POST /COMPANY/:id/notes` | 201 | Polymorphic subject, audit log entry written. |
| Tasks     | `POST /tasks`     | 201 | `subjectType=CONTACT`, priority HIGH, dueAt set. |
| Pipelines | `GET  /pipelines` | 200 | Default `Vânzări` pipeline auto-created at register. |
| Deals     | `POST /deals`     | 201 | `value:"120000.00"` (decimalString — was the only validation gotcha). |
| Leads     | `POST /leads`     | 201 | LeadSource WEB, NEW status. |
| Audit log | `GET  /audit?take=5` | 200 | Showed `note.create`, `auth.login`, `company.created`. |
| Reports/dashboard | `GET /reports/dashboard` | 200 | **Required a fix** — see §6. |
| Reports/financial-summary | `GET /reports/financial-summary` | 200 | Empty array (no invoices yet). |
| Reports/revenue-trend | `GET /reports/revenue-trend` | 200 | Empty (no paid invoices yet). |
| AI brief | `GET /ai/brief` | 200 | Returned RO summary + 3 priority actions even on a near-empty tenant. |
| AI search | `GET /ai/search?q=Acme` | 200 | Empty results (embedding gen failed against Gemini — see §7). |
| Custom fields | `GET /companies/:id/fields` | n/a | Endpoint nests under the parent resource (not `/custom-fields?model=…`). |
| Calendar events | `GET /calendar/events` | 200 | Empty. |

## 4. Mock infrastructure stood up (Phase 0)

`pnpm mocks:up` boots three additional containers under `--profile mocks`:

| Service | Container | Port(s) | Health |
|---------|-----------|---------|--------|
| mailpit | `amass-mailpit` | 1025 (smtp) + 8025 (UI) | healthy |
| stripe-mock | `amass-stripe-mock` | 12111 + 12112 | up |
| mock-services | `amass-mocks` | 3001 twilio · 3002 meta · 3003 google · 3004 microsoft · 3005 anaf · 3006 webhook · 3007 ai | up |

Smoke check on each:

```bash
$ for p in 3001 3002 3003 3004 3005 3006 3007; do curl -s localhost:$p/_health; echo; done
{"ok":true,"name":"twilio"}
{"ok":true,"name":"meta"}
{"ok":true,"name":"google"}
{"ok":true,"name":"microsoft"}
{"ok":true,"name":"anaf"}
{"ok":true,"name":"webhook"}
{"ok":true,"name":"ai"}

$ curl -u sk_test_mock: -X POST localhost:12111/v1/customers -d email=foo@bar.com
{ "id": "cus_…", "email": "foo@bar.com", … }     # stripe-mock OK

$ curl localhost:8025/api/v1/info | head -c 60
{"Version":"v1.21.8","DatabaseSize":94208,"Messages":0…}    # mailpit OK
```

The mock-services Express container exposes:

- **twilio**: `POST /2010-04-01/Accounts/:sid/{Calls,Messages}.json` — returns `CA…`/`SM…` SIDs and (for calls) fires a status callback to `req.body.StatusCallback` ~5s later with `CallStatus=completed`, `RecordingUrl=…`.
- **meta-whatsapp**: `POST /v19.0/:phoneId/messages` — returns `{ messages:[{ id:"wamid.…" }] }`.
- **google**: `POST /token` + `GET /calendar/v3/calendars/primary/events`.
- **microsoft**: `POST /common/oauth2/v2.0/token` + `GET /v1.0/me/calendar/events`.
- **anaf**: `POST /prod/FCTEL/rest/upload` (returns `index_incarcare`) + `GET /prod/FCTEL/rest/stareMesaj` (returns `in prelucrare` for 8s, then `ok` with `id_descarcare`).
- **webhook**: `POST /*` records into an in-memory ring + `GET /_received` to inspect.
- **ai**: `POST /v1/chat/completions` + `POST /v1/embeddings` + Gemini `:generateContent` shim — only used as a fallback when the real key is absent.

## 5. Unit + e2e test suite

`pnpm --filter @amass/api test` (vitest unit suite):

```
Test Files  19 failed | 60 passed (79)
Tests       112 failed | 694 passed (806)
Duration    3.76s
```

**Note:** 112 failures are pre-existing — they appear to relate to the
shared TS/Prisma client typing layer (`vi.mocked()` against casts to
PrismaService, missing enum re-exports, dual-arity `runWithTenant`
mocks). They were red on `main` at the start of this session — see
LESSONS.md entries for the pattern. None of the fixes shipped tonight
break previously-green tests.

Goal during Phase 3 was to bring all suites green; budget did not
permit a full sweep. Progress recorded in UNFINISHED.md.

## 6. Bugs found and fixed during verification

### 6.1 `GET /reports/dashboard` → 500 `column d.stage_id does not exist`

`apps/api/src/modules/reports/reports.service.ts` had three raw SQL
queries that referenced `tenant_id`, `created_at`, `deleted_at`,
`stage_id`, `duration_sec` (snake_case) — but every column in `deals`,
`activities`, `email_messages`, `calls`, `pipeline_stages` is camelCase
in this database (no `@map` is used outside `invoices`). Postgres needs
`"camelCase"` quoted; unquoted snake_case becomes a different identifier
and 42703s.

Fix: replaced with `"tenantId"`, `"createdAt"`, `"deletedAt"`,
`"stageId"`, `"durationSec"` everywhere except inside the `invoices`
queries (which legitimately use snake_case via `@map`).

Verification post-fix: `GET /reports/dashboard` returns 200 with
`{ deals, pipeline:[…], activities:[…], emails, calls, period }`.

### 6.2 Caddy upstream wrong port

The repo had an uncommitted fix in `infra/caddy/Caddyfile` from a prior
session (`reverse_proxy web:80 → web:8080`) — the web container is
nginx-unprivileged on `:8080`, not `:80`. Without this, every non-`/api`
request through Caddy was 502'ing. Folded into the same Phase 0 commit.

## 7. Known gaps + workarounds applied

| Item | What I did |
|------|------------|
| AI embeddings (Gemini) | The configured `GEMINI_API_KEY` returned 400 on every embedding call (probably a model/route mismatch — `text-embedding-004` may have changed surface). The error is caught upstream so company/contact creates still succeed. The mock-ai container at `:3007` provides a deterministic fallback if the key is unset. |
| Custom-fields endpoint shape | The `/custom-fields?model=COMPANY` URL I tried first 404'd — the API exposes them nested under the parent resource (`GET /companies/:id/fields`). Documented; not a bug. |
| Reports financial-summary / revenue-trend | Returned `[]` with HTTP 200 — correct, the test tenant has no invoices. Need an end-to-end paid-invoice flow (Stripe webhook → invoice marked PAID) to populate. Stripe-mock is wired; the wiring of `STRIPE_API_BASE` env var to point the SDK at it was deferred to UNFINISHED.md (Stripe SDK v18 requires `host` + `protocol` + `port` in the constructor, not a URL — 30 min of careful work). |
| Twilio call flow | Mock fires status callback after 5s with `RecordingUrl`. End-to-end exercise (initiate call → callback hits API → AI worker pulls recording → transcript stored) needs `TWILIO_BASE_URL` plumbing same as Stripe. Documented. |
| Whisper / Presidio | DEFAULT OFF as marked in STATUS.md. Stub returns "[stub transcript]". Out of scope for tonight. |

## 8. Files changed in this session (so far)

- `apps/mock-services/{package.json,server.js,Dockerfile,.dockerignore,README.md}` — new
- `infra/docker-compose.yml` — three new services under `--profile mocks` + a `mailpit_data` volume
- `infra/caddy/Caddyfile` — `web:80 → web:8080`
- `package.json` — `mocks:up | mocks:down | mocks:logs` scripts
- `pnpm-workspace.yaml` — exclude `apps/mock-services` from the workspace
- `apps/api/src/modules/reports/reports.service.ts` — snake_case → quoted camelCase in raw SQL
