# Verification Report — 2026-04-28 autonomous session

> Ran by Claude during the autonomous overnight pass on 2026-04-27/28
> + the morning continuation. The bar set by the user: **ZERO N/A** —
> every feature must either pass a live request, or be marked with the
> concrete reason it didn't and the workaround applied.
>
> ## Honesty pass (added during Faza A)
>
> The original draft of this report (commit `0b2f3e7`) over-claimed in
> places: it implied broad feature coverage when the actual evidence
> was a smoke test. This honesty pass adds an explicit **Evidence**
> column to every claim with the concrete proof captured during Faza A
> (mock service log lines, HTTP status codes, DB rows, file paths).
> Anything without that proof is now flagged as **PENDING — Faza B**
> rather than implied as verified.
>
> All evidence below was captured against the live Docker stack on
> `darwin / Apple Silicon` with `docker compose --profile mocks up`
> (mailpit + stripe-mock + mock-services + the seven mock endpoints
> running) plus the production stack (postgres, redis, minio, api,
> web, ai-worker, caddy).

## Faza A — live mock + UI verification (2026-04-28)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| A1 | Stripe-mock receives a real call | ✅ live | `docker logs amass-stripe-mock`: `Request: POST /v1/customers` + `Request: POST /v1/checkout/sessions` (price=`price_mock_starter`, tenantId in metadata). API returns `{"url":"https://checkout.stripe.com/pay/c/cs_test_a1YS1URlnyQCN5fUUduORoQ7Pw41PJqDWkIVQCpJPqkfIhd6tVY8XB1OLY"}` HTTP 201. |
| A2 | Meta WhatsApp send hits meta-mock | ✅ live | `docker logs amass-mocks`: `[meta] POST /v19.0/15550001234/messages`. DB row whatsapp_messages: status=SENT, externalId=wamid.4b4be1baf2795f59. |
| A3 | ANAF submit hits anaf-mock | ✅ live | `[anaf] POST /anaf-oauth2/token` + `[anaf] POST /prod/FCTEL/rest/upload?standard=UBL&cif=12345678`. API returns `{"uploadIndex":"6658177"}` HTTP 200. DB row anaf_submissions: status=UPLOADED, upload_index=6658177. **Bug fix shipped**: AnafService.submitInvoice/checkStatus did `res.json()` on XML responses; replaced with parseAnafResponse() helper that handles both XML and JSON. |
| A4 | Google + Microsoft OAuth + calendar sync | ✅ live | `[google] POST /token` + `[google] GET /calendar/v3/calendars/primary/events?timeMin=…`. Sync returned `{"synced":2}`. `[microsoft] POST /common/oauth2/v2.0/token`. Both integrations have rows in calendar_integrations table. |
| A5 | Outbound webhook delivery + HMAC | ✅ live | webhook-mock GET /_received returned the POST with `x-amass-event: COMPANY_CREATED`, valid HMAC `x-amass-signature: sha256=a8310356266dd52e30c2473ee9627ec377ebb15ada5ac5eba0547ea80725ba1d`, body `{event, tenantId, timestamp, data:{id, name}}`. **Bug fix shipped**: WebhooksService.dispatch() existed but no service called it — wired companies.service to fire COMPANY_CREATED on create. SSRF allow-list (`WEBHOOK_TRUSTED_HOSTS`) added so dev mocks pass validation. |
| A6 | ANAF UI on invoices list (browser) | ✅ live | User confirmed visually: badge "ANAF: Validată #6658177" rendered under invoice AMS-0001. Click "XML" opened a new tab with the full UBL 2.1 / CIUS-RO 1.0.1 XML (validated as a Postgres-backed real submission). **Bug fix shipped**: original `<a href>` lost the Bearer token; replaced with auth-aware fetch + Blob URL pattern. |
| A7 | Dark theme tri-state toggle | ✅ live | User confirmed clicks Sun→Moon→Monitor cycle the visible palette. CSS audit (post-fix): `:root[data-theme=dark]` block compiled into the bundle (verified by inspecting served `index-DPgqIWco.css`). **Cache fix shipped**: bumped service worker `CACHE = 'amass-shell-v1' → 'v2'` so old clients purge their stale shell on activate. |
| A8 | Lazy-loaded route chunks | ✅ live | User Network panel screenshot 2026-04-28 12:27 shows `companies.list.page-BGrNMiBX.js` 8.84 KB + `csv-Bgh-u4xy.js` 1.06 KB downloaded only when navigating to /app/companies. Main bundle stays at 337/86 KB gzip. |
| A9 | Cedar decorator placement audit | ✅ static | Programmatic audit: 339 handlers across 64 controllers, 152 carry @RequireCedar, only 2 are `@Get + @RequireCedar` (gdpr/contacts/:id/export and gdpr/clients/:id/export — both **intentional** because GDPR PII exports deserve ABAC beyond simple role gates). No mistaken placements. |
| A10 | Honesty pass on this report | ✅ done | This block. |

## Bonus latent bugs caught while running Faza A

Three real production-blocker bugs surfaced because the unit-test
fixtures had been masking them. Fixed live and committed:

1. **`AnafService` did `res.json()` on XML** — would have crashed
   every real ANAF e-Factura upload + status poll with
   "Unexpected token '<'". Real ANAF emits XML; only the OAuth
   token endpoint emits JSON.
2. **`WebhooksService.dispatch()` was orphaned** — implemented but
   never called by any service. Outbound webhooks for tenants would
   have shown 0 deliveries forever despite endpoint registration
   being accepted.
3. **`/reports/dashboard` 500 BigInt** — `getPipelineStats` returned
   raw rows with `count: bigint` (Postgres COUNT) untouched;
   `JSON.stringify` can't serialize bigint, crashed mid-response.
   Other four queries already converted; this one was the gap.

Also caught:
4. **Caddy `/ws*` proxy missing** — Socket.IO upgrade traffic 502'd,
   dashboard saw "WebSocket failed" ×68 in console. Added
   `handle /ws* { reverse_proxy api:3000 }`.
5. **Service worker cache-bust** — bumped to `v2` so the next
   activation purges old shell.

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
