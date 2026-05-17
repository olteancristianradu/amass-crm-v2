# Phase 0 — Acceptance Criteria (Gherkin)

> **Status:** APPROVED · **Owner:** `product-manager` sub-agent · **Date:** 2026-05-17
> **For:** `backend-engineer` + `frontend-engineer` + `qa-automation` + `code-reviewer`
> **Source plan:** [`docs/ROADMAP_V2.md`](../ROADMAP_V2.md) §2 Phase 0 + §10 Sprint 1
> **Rule reference:** [`CLAUDE.md`](../../CLAUDE.md) #2 (proof of done), #3 (tenant isolation), #6 (no scope creep), #8 (coverage), #11 (lint+test)

Markeri inline folosiți pe parcurs:
- `[verificat]` — citit din cod/schema azi
- `[propus]` — nu există încă în repo, trebuie creat/instalat
- `[presupun]` — inferență; flagged for sign-off

Verificat 2026-05-17, 14:00:
- `SavedView` model exists at `apps/api/prisma/schema.prisma:2539` cu unique `(ownerId, resource, name)` `[verificat]`
- `Deal.value Decimal(14,2)` + `Deal.currency String @default("RON")` la `schema.prisma:617-618` `[verificat]` — **NOTE:** roadmap zice `amount`, schema zice `value`. Aliasul în controller poate fi `amount` for API, dar coloana DB rămâne `value`. Spec mai jos folosește `value`.
- `User` NU are field `locale` `[verificat:108-148]` — trebuie adăugat (migration nouă)
- `apps/api/src/modules/email/templates/` NU există ca dir `[verificat]` — module folosește `email.service.ts` + `email.processor.ts` flat. Localizarea templates presupune restructurare `[propus]`
- `decimal.js` NU e în deps `[verificat]` — se folosește `Prisma.Decimal` din `@prisma/client/runtime/library` (zero new dep)

---

## Feature 1: i18n EN

### Story 1.1 — Sales rep schimbă limba UI în engleză

**As a** sales rep cu cont `radu@acme.ro` în tenant `acme-ro`
**I want** să comut UI-ul în engleză din Settings
**So that** pot face onboarding la un coleg ne-român fără să creez cont separat

#### Scenario: Comutare locale din Settings page (happy path)
  Given user `radu@acme.ro` is logged in with `locale='ro-RO'` (default)
  And the user is on `/settings/preferences`
  When the user selects "English (United States)" from the `LanguageSwitcher` component
  And the user clicks "Save preferences"
  Then `PATCH /api/v1/users/me { locale: 'en-US' }` returns `200`
  And the user row in `users` table has `locale='en-US'`
  And all UI strings on the current page re-render in English within 300ms
  And the page does NOT do a full reload (no `window.location.reload` call)
  And on next navigation to `/deals`, all column headers, buttons, tooltips appear in English
  And after logout + login, the locale persists as `en-US`

#### Scenario: Lazy-load chunks (Vite split per locale)
  Given the user has `locale='en-US'`
  And the browser DevTools Network tab is open
  When the user loads `/deals`
  Then the response includes a chunk matching `i18n-en-US.*.js` (≤50 KB gzipped)
  And NO chunk matching `i18n-ro-RO.*.js` is loaded
  And the i18n init promise resolves before the first React render

#### Scenario: Welcome email respectă user.locale
  Given a new user `john@globex.com` registers via `POST /api/v1/auth/register` with body `{ locale: 'en-US' }`
  When the registration handler enqueues the BullMQ job `email.welcome`
  Then the job payload contains `{ userId, locale: 'en-US' }`
  And the rendered email subject is `"Welcome to Amass CRM"` (NOT `"Bun venit"`)
  And the email body uses the `welcome.en-US.hbs` template `[propus: trebuie creat docs/specs subdir templates]`
  And the email `Content-Language` header is `en-US`

#### Scenario: Fallback la RO dacă cheia EN lipsește
  Given the en-US catalog is missing the key `deals.list.emptyState`
  When the user with `locale='en-US'` opens `/deals` cu zero deals
  Then the empty-state copy renders the RO fallback string (no `[deals.list.emptyState]` raw key visible)
  And a warn log is emitted: `{ level: 'warn', msg: 'i18n.missing', key: 'deals.list.emptyState', locale: 'en-US' }`

#### Scenario: Format numere/date locale-aware
  Given user `mary@globex.com` with `locale='en-US'` views a deal of `value=1234567.89` `currency='USD'` and `expectedCloseAt='2026-12-31T10:00:00Z'`
  When the deal detail page renders
  Then the value displays as `"$1,234,567.89"` (Intl.NumberFormat en-US, comma thousand-sep, period decimal)
  And the date displays as `"12/31/2026"` (Intl.DateTimeFormat en-US short)
  Given the same user switches to `locale='ro-RO'`
  When the deal detail page renders again
  Then the value displays as `"1.234.567,89 USD"` (Intl ro-RO, period thousand-sep, comma decimal, currency code suffix)
  And the date displays as `"31.12.2026"`

#### Scenario: Service Worker cache bust pe build hash (PWA edge case from risk register)
  Given the user previously loaded the app at build `sha-abc123` cu `i18n-ro-RO.abc123.js` cached
  And a new build `sha-def456` ships with updated EN strings
  When the user reloads after deploy
  Then the SW serves `i18n-en-US.def456.js` (NEW hash), not the stale `abc123` chunk
  And `caches.keys()` shows the old `runtime-abc123` cache deleted

#### Scenario: A11y — language switcher keyboard navigable
  Given the user is on `/settings/preferences` using only keyboard
  When the user presses `Tab` until focus lands on the `LanguageSwitcher`
  Then the element has `aria-label="Select language"` (or `aria-label="Selectează limba"` în RO)
  And the active option has `aria-selected="true"`
  And pressing `ArrowDown` cycles options, `Enter` selects
  And focus remains visible (no `outline: none` without replacement)

#### Scenario: Cross-tenant denied — user cannot read another tenant's preferences
  Given user `radu@acme.ro` (tenant `acme-ro`) has `locale='ro-RO'`
  And user `john@globex.com` (tenant `globex`) has `locale='en-US'`
  When `radu@acme.ro` calls `GET /api/v1/users/<john-id>/preferences`
  Then the response is `404 NOT_FOUND` (not 403 — leak prevention)
  And the audit log records `{ action: 'CROSS_TENANT_READ_BLOCKED', actor: radu-id, resource: john-id }`

---

### Story 1.2 — Admin marchează texte cu key namespace consistent

**As a** dev / i18n-localization sub-agent
**I want** every UI string under `apps/web/src` to live in `i18n/{ro-RO,en-US}/<namespace>.json`
**So that** translators can work without grepping JSX

#### Scenario: No hardcoded RO strings remain (lint guard)
  Given the codebase at HEAD
  When `pnpm --filter @amass/web lint:i18n` runs (custom ESLint rule `no-hardcoded-strings`)
  Then 0 errors are reported
  And any new PR adding a literal Romanian-looking string (regex `/[ăâîșțĂÂÎȘȚ]/` în JSX) fails CI

#### Scenario: Translation key has matching value in both catalogs
  Given the file `apps/web/src/i18n/ro-RO/deals.json` has key `deals.actions.markWon`
  When CI runs `pnpm --filter @amass/web i18n:validate`
  Then `apps/web/src/i18n/en-US/deals.json` MUST also contain `deals.actions.markWon`
  And the validation script exits non-zero if any key mismatches between catalogs

---

## Feature 2: Multi-currency cu rates daily

### Story 2.1 — System fetches ECB rates daily

**As a** tenant admin in Romania
**I want** the system to pull EUR/USD/GBP/CHF/PLN → RON rates daily from ECB
**So that** deal values in foreign currency display correctly in my reports

Schema additions `[propus]`:
```
model ExchangeRate {
  id           String   @id @default(cuid())
  fromCurrency String   // ISO 4217, e.g. 'EUR'
  toCurrency   String   // ISO 4217, e.g. 'RON'
  rate         Decimal  @db.Decimal(18, 8)
  asOf         DateTime @db.Date
  source       String   @default("ECB")
  fetchedAt    DateTime @default(now())
  @@unique([fromCurrency, toCurrency, asOf])
  @@index([asOf])
  @@map("exchange_rates")
}
```
**Note:** `ExchangeRate` is **global** (not tenant-scoped) — same rate for all tenants. Confirmed against ECB single source. `[verificat: business decision in roadmap §0 Phase 0]`

#### Scenario: BullMQ daily job at 06:00 Europe/Bucharest
  Given the BullMQ scheduler is running cu timezone `Europe/Bucharest`
  And it is `2026-05-18T06:00:00+03:00` (DST active)
  When the cron `fx-rates.daily` fires
  Then a job is enqueued on queue `fx-rates` with payload `{ baseDate: '2026-05-18' }`
  And within 2 seconds the worker fetches `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`
  And upserts 5 rows into `exchange_rates`: `EUR→RON`, `USD→RON`, `GBP→RON`, `CHF→RON`, `PLN→RON` with `asOf='2026-05-18'`
  And computes the inverse rates: `RON→EUR`, `RON→USD`, etc. (additional 5 rows)
  And emits Prometheus counter `fx_rates_fetched_total{source="ECB",status="success"} +10`

#### Scenario: ECB returns the same rates twice (idempotent re-run)
  Given `exchange_rates` already has rows for `asOf='2026-05-18'`
  When the job re-runs (manual retry or duplicate cron)
  Then no `unique constraint violation` error
  And the existing rows are updated (not duplicated) cu `fetchedAt=now()`
  And the count of rows for `asOf='2026-05-18'` remains exactly 10

#### Scenario: ECB unreachable — graceful degradation
  Given ECB returns `503 Service Unavailable` for 3 consecutive retries
  When the job exhausts BullMQ retries (exponential backoff: 1s, 5s, 25s)
  Then the job moves to DLQ `fx-rates-dlq`
  And a Sentry alert is fired with `tag: fx-rates-down`
  And the API continues to serve the LAST known rate (from previous `asOf`)
  And `GET /api/v1/exchange-rates?from=EUR&to=RON` returns `{ rate: 4.9750, asOf: '2026-05-17', stale: true }`

#### Scenario: Weekend / holiday (ECB doesn't publish)
  Given today is Saturday `2026-05-23`
  When the cron fires
  Then ECB returns the Friday `2026-05-22` rates (their feed behavior)
  And the upsert uses `asOf='2026-05-22'` (NOT `2026-05-23`)
  And no row is inserted for Saturday — the FX query falls back to last available `asOf <= today`

---

### Story 2.2 — User sees deal value in chosen display currency

**As a** sales manager
**I want** to toggle the deal list between RON, EUR, USD display
**So that** I can present numbers to international stakeholders without doing math

#### Scenario: Display conversion on list page
  Given deals exist:
    | id | value | currency | expectedCloseAt |
    | d1 | 1000  | EUR      | 2026-06-01      |
    | d2 | 500   | USD      | 2026-06-01      |
    | d3 | 5000  | RON      | 2026-06-01      |
  And `exchange_rates` has `asOf='2026-05-17'`: `EUR→RON=4.9750`, `USD→RON=4.5800`
  When user with `locale='ro-RO'` opens `/deals` and the "Display in" dropdown is `RON`
  Then row d1 displays `"4.975,00 RON"` (1000 × 4.9750)
  And row d2 displays `"2.290,00 RON"` (500 × 4.5800)
  And row d3 displays `"5.000,00 RON"` (no conversion)
  And the column total is `"12.265,00 RON"`

#### Scenario: Switch display currency (no server round-trip)
  Given the user is on `/deals` cu display `RON` (as above)
  When the user changes "Display in" to `EUR`
  Then conversions happen client-side using rates already loaded
  And no HTTP request is fired (verify via Network tab — only the rates GET from initial page load)
  And row d1 displays `"1.000,00 €"` (original)
  And row d2 displays `"500,00 €"` is WRONG — must be `500 USD × (1/4.9750) × 4.5800 = ~460,30 €` (USD → RON → EUR)
  And the conversion uses 2-decimal rounding HALF_UP (`Prisma.Decimal.ROUND_HALF_UP`)

#### Scenario: Deal saved with original currency preserved
  Given user creates a deal `POST /api/v1/deals { title: 'Acme Q3', value: 1000, currency: 'EUR' }`
  When the request succeeds
  Then the DB row has `value=1000.00`, `currency='EUR'` (NOT converted)
  And `amountBase` is computed and cached: `value=1000 × rate(EUR→RON, asOf=today) = 4975.00` stored in new column `value_base Decimal(14,2)` `[propus]`
  And `baseCurrency='RON'` (per-tenant base, default RON from `tenants.base_currency` `[propus]`)

#### Scenario: Historic rate immutability (audit critical)
  Given deal `d1` was created on `2026-05-17` with `value=1000 EUR` and `value_base=4975.00` (rate 4.9750)
  When the daily FX job runs on `2026-05-18` and sets `EUR→RON=5.0100` (rate moved)
  Then deal `d1`'s `value_base` remains `4975.00` (NOT rewritten)
  And re-displaying d1 in RON in a list view uses the LIVE rate `5.0100` for display (= 5010.00 RON)
  And reporting historical "pipeline value as of 2026-05-17" uses `value_base` from that date
  And no migration / cron rewrites historical `value_base`

#### Scenario: Concurrent rate updates (race condition guard)
  Given two workers attempt to upsert the same `(EUR, RON, 2026-05-17)` row simultaneously
  When both call the upsert in parallel
  Then exactly one row exists (Postgres unique constraint enforces)
  And the second worker's upsert succeeds (Prisma upsert = INSERT ... ON CONFLICT UPDATE)
  And no `P2002` error reaches the BullMQ retry counter

#### Scenario: Unsupported currency rejected at deal creation
  Given user creates a deal `POST /api/v1/deals { value: 100, currency: 'XYZ' }`
  When the Zod validator runs
  Then the response is `400 BAD_REQUEST` with `{ code: 'VALIDATION_ERROR', details: { currency: 'must be one of: RON, EUR, USD, GBP, CHF, PLN' } }`
  And no row is inserted

#### Scenario: Float precision — no IEEE 754 drift
  Given a deal with `value=0.1`, `currency='EUR'` converted at rate `EUR→RON=4.9750`
  When the computation runs in the backend
  Then the result uses `Prisma.Decimal` arithmetic (NOT JS Number): `new Prisma.Decimal('0.1').mul('4.9750') = 0.49750`
  And the stored `value_base=0.50` (rounded HALF_UP to 2 decimals)
  And NO occurrence of `0.49749999...` in DB or API response

#### Scenario: Cross-tenant denied — rates are public but per-tenant base currency is not
  Given tenant `acme-ro` has `baseCurrency='RON'` and tenant `globex-uk` has `baseCurrency='GBP'`
  When user `radu@acme.ro` queries `GET /api/v1/exchange-rates?from=EUR&to=RON&date=2026-05-17`
  Then the response is `200` with the rate (rates are global, no tenant scope)
  When `radu@acme.ro` queries `GET /api/v1/tenants/globex-uk/base-currency`
  Then the response is `404 NOT_FOUND` (no cross-tenant tenant-settings read)

---

## Feature 3: Saved searches + custom views per user

Schema: `SavedView` `[verificat:schema.prisma:2539]` — no new columns required.

### Story 3.1 — User saves a filtered view and re-applies it later

**As a** sales rep `radu@acme.ro`
**I want** to save my filter "RO SMBs with >5 employees, last contacted >30d ago"
**So that** I can re-run it every Monday morning without re-typing filters

#### Scenario: Save view (happy path)
  Given user `radu@acme.ro` is on `/companies` and has applied filters `{ country: 'RO', employees_min: 5, lastContactedBefore: '2026-04-17' }`
  And the URL is `/companies?filter[country]=RO&filter[employees_min]=5&filter[lastContactedBefore]=2026-04-17`
  When the user clicks "Save view" and enters name `"RO SMBs >5 employees stale"`
  And confirms via `POST /api/v1/saved-views { resource: 'companies', name: 'RO SMBs >5 employees stale', filters: { country: 'RO', employees_min: 5, lastContactedBefore: '2026-04-17' } }`
  Then the response is `201 CREATED` with `{ id, resource, name, filters, createdAt }`
  And a row exists in `saved_views`: `(tenant_id=acme-ro, owner_id=radu-id, resource='companies', name='RO SMBs >5 employees stale', filters=<JSON>)`
  And the "My views" dropdown on `/companies` now lists this view

#### Scenario: Re-apply saved view
  Given `radu@acme.ro` returns the next day to a clean `/companies` URL (no filters)
  When the user clicks "My views" → "RO SMBs >5 employees stale"
  Then the URL updates to `/companies?filter[country]=RO&filter[employees_min]=5&filter[lastContactedBefore]=2026-04-17`
  And the company list re-renders with the filters applied
  And the active view is highlighted in the dropdown

#### Scenario: Duplicate name within (owner, resource) rejected
  Given `radu@acme.ro` already has a view named `"My favorites"` for `resource='companies'`
  When the user attempts `POST /api/v1/saved-views { resource: 'companies', name: 'My favorites', filters: {...} }`
  Then the response is `409 CONFLICT` with `{ code: 'DUPLICATE_VIEW_NAME', message: 'A view with this name already exists for this resource' }`
  And no row is inserted (unique `(ownerId, resource, name)` enforced)

#### Scenario: Same name allowed across resources
  Given `radu@acme.ro` has a view `"My favorites"` for `resource='companies'`
  When the user posts `POST /api/v1/saved-views { resource: 'deals', name: 'My favorites', filters: {...} }`
  Then the response is `201 CREATED`
  And both views coexist (unique constraint is on the triple)

#### Scenario: Same name allowed across users (per-owner scope)
  Given `radu@acme.ro` has view `"Q2 push"` for `resource='deals'`
  When `maria@acme.ro` (same tenant) posts `POST /api/v1/saved-views { resource: 'deals', name: 'Q2 push', filters: {...} }`
  Then the response is `201 CREATED`
  And both rows exist; each user sees only their own in their dropdown

#### Scenario: Rename view
  Given a view exists with `id='sv_abc'`, owner `radu@acme.ro`, name `"RO SMBs"`
  When the user calls `PUT /api/v1/saved-views/sv_abc { name: 'RO SMBs — active' }`
  Then the response is `200` cu the updated view
  And the DB row name is `"RO SMBs — active"`, `updatedAt` bumped
  And `filters` is unchanged

#### Scenario: Update filters
  When the user calls `PUT /api/v1/saved-views/sv_abc { filters: { country: 'RO', employees_min: 10 } }`
  Then the response is `200`
  And the DB row's `filters` JSON is replaced (NOT merged) cu the new payload
  And `name` is unchanged

#### Scenario: Delete view
  When the user calls `DELETE /api/v1/saved-views/sv_abc`
  Then the response is `204 NO_CONTENT`
  And the row is hard-deleted (no soft-delete column on SavedView `[verificat:schema.prisma:2539]`)
  And subsequent `GET /api/v1/saved-views?resource=companies` does not include `sv_abc`

#### Scenario: List filtered by resource
  Given `radu@acme.ro` has 3 views: 2 for `companies`, 1 for `deals`
  When the user calls `GET /api/v1/saved-views?resource=companies`
  Then the response is `200` cu exactly 2 views
  And neither references the `deals` view

#### Scenario: Empty name rejected
  When the user posts `POST /api/v1/saved-views { resource: 'companies', name: '', filters: {} }`
  Then the response is `400 BAD_REQUEST` with `{ code: 'VALIDATION_ERROR', details: { name: 'must be 1-100 characters' } }`

#### Scenario: Name max length 100
  When the user posts a name of 101 characters
  Then the response is `400` cu validation message
  When the user posts a name of exactly 100 characters
  Then the response is `201`

#### Scenario: Invalid filters blob — must be JSON object, not array/string
  When the user posts `{ resource: 'companies', name: 'X', filters: "all" }` (string, not object)
  Then the response is `400 BAD_REQUEST { code: 'VALIDATION_ERROR', details: { filters: 'must be a JSON object' } }`
  When the user posts `{ resource: 'companies', name: 'X', filters: [] }` (array)
  Then the response is `400` (same reason — Zod `z.record(z.unknown())` rejects arrays)

#### Scenario: Filters payload size cap
  When the user posts a `filters` blob >16 KB serialized
  Then the response is `413 PAYLOAD_TOO_LARGE` `[propus: enforce in body-parser limit]`

#### Scenario: Unknown resource rejected
  When the user posts `{ resource: 'unicorns', name: 'X', filters: {} }`
  Then the response is `400` with `details.resource = 'must be one of: companies, contacts, clients, deals, leads, tasks'` `[propus list — confirm with frontend-engineer]`

---

### Story 3.2 — Cross-tenant + cross-owner isolation

**As a** security-blue-team auditor
**I want** to confirm no user can read, update, or delete another user/tenant's saved views
**So that** the new endpoints don't regress rule #3

#### Scenario: Cross-tenant read denied
  Given user `radu@acme.ro` (tenant `acme-ro`) has view `sv_radu`
  And user `john@globex.com` (tenant `globex`) is logged in
  When `john` calls `GET /api/v1/saved-views/sv_radu`
  Then the response is `404 NOT_FOUND` (NOT 403 — leak prevention per `docs/SCALING.md`)
  And RLS on `saved_views` table (policy `tenant_isolation`) blocks the row at DB level
  And the audit log records `{ action: 'CROSS_TENANT_READ_BLOCKED', table: 'saved_views', row_id: 'sv_radu' }`

#### Scenario: Cross-tenant list returns only own tenant's views
  Given tenant `acme-ro` has 5 views, tenant `globex` has 3 views
  When `john@globex.com` calls `GET /api/v1/saved-views?resource=deals`
  Then the response contains only globex's deals views (≤3 items)
  And no `acme-ro` view leaks even if `john` adds `?tenant_id=acme-ro` as query param (ignored by middleware)

#### Scenario: Same-tenant cross-owner read denied
  Given `radu@acme.ro` has view `sv_radu` and `maria@acme.ro` (same tenant) is logged in
  When `maria` calls `GET /api/v1/saved-views/sv_radu`
  Then the response is `404 NOT_FOUND`
  And the service layer checks `ownerId === ctx.userId` before returning (NOT just tenant scope)

#### Scenario: Same-tenant cross-owner update denied
  When `maria` calls `PUT /api/v1/saved-views/sv_radu { name: 'hacked' }`
  Then the response is `404 NOT_FOUND`
  And the DB row is unchanged

#### Scenario: Same-tenant cross-owner delete denied
  When `maria` calls `DELETE /api/v1/saved-views/sv_radu`
  Then the response is `404 NOT_FOUND`
  And the row still exists

#### Scenario: Admin role does NOT bypass owner scope (intentional)
  Given `admin@acme.ro` has role `ADMIN` in tenant `acme-ro`
  When admin calls `GET /api/v1/saved-views/sv_radu` (radu's view, same tenant)
  Then the response is `404 NOT_FOUND`
  And saved views are personal — even admin cannot read them
  And this is documented in `docs/RBAC.md` `[propus]`

---

### Story 3.3 — System-provided default views

**As a** new user with zero saved views
**I want** to see useful default views out of the box ("All my deals", "Won this month", "Lost last 30 days")
**So that** I don't face an empty dropdown

#### Scenario: Default views injected at list time (NOT in DB)
  Given a user has zero rows in `saved_views` for `resource='deals'`
  When the user opens `/deals`
  Then the "My views" dropdown shows 3 default views: `"All my deals"`, `"Won this month"`, `"Lost last 30 days"`
  And these are FE-only constants (not DB rows) — `apps/web/src/i18n/{ro,en}/savedViews.json` provides labels
  And selecting `"Won this month"` applies filter `{ ownerId: <me>, status: 'WON', closedAt_gte: <month-start> }`

#### Scenario: Default views are read-only
  Given the user opens the "My views" dropdown
  When the user hovers a default view
  Then no "Rename" or "Delete" affordance appears (they're locked)
  And attempting `DELETE /api/v1/saved-views/default-all-my-deals` returns `404` (these IDs don't exist server-side)

#### Scenario: Default views localized
  Given the user has `locale='en-US'`
  When the dropdown renders
  Then the 3 defaults appear as: `"All my deals"`, `"Won this month"`, `"Lost last 30 days"`
  Given the user has `locale='ro-RO'`
  When the dropdown renders
  Then they appear as: `"Toate dealurile mele"`, `"Câștigate luna aceasta"`, `"Pierdute în ultimele 30 de zile"`

---

## Non-functional acceptance (cross-cutting Phase 0)

### Coverage (CLAUDE.md #8)
- New service files MUST clear ≥80% line coverage:
  - `apps/api/src/modules/saved-views/saved-views.service.ts`
  - `apps/api/src/modules/exchange-rates/exchange-rates.service.ts`
  - `apps/api/src/modules/exchange-rates/ecb-fetcher.ts`
  - `apps/api/src/modules/i18n/user-locale.service.ts` (handles `PATCH /users/me { locale }`)
- Measured via `pnpm --filter @amass/api vitest run --config vitest.config.unit.ts --coverage` and pasted into PR body

### Multi-tenant isolation (CLAUDE.md #3)
- E2E test `test/saved-views.e2e.spec.ts` MUST include:
  - Cross-tenant read returns 404
  - Cross-owner same-tenant read returns 404
  - Admin role bypass attempt returns 404
- E2E test `test/exchange-rates.e2e.spec.ts` MUST include:
  - Public rates endpoint serves identical data to all tenants
  - Tenant base-currency NOT readable cross-tenant

### Accessibility (WCAG 2.1 AA)
- `LanguageSwitcher`: `aria-label`, keyboard navigation, focus visible, screen-reader announces locale change via `aria-live="polite"`
- Currency display dropdown: same
- Saved views dropdown: same
- `accessibility-auditor` sub-agent signs off in PR comment before merge

### Performance budgets
- i18n locale bundle: ≤50 KB gzipped per locale (`pnpm --filter @amass/web build && ls -la dist/i18n/*.js`)
- FX rates daily job: completes in <2 seconds for 10 currency pairs (measured via Pino timing log)
- Saved views list: p95 <100ms for users with up to 100 views (load test scaffold in `test/load/saved-views.k6.js` `[propus]`)
- Currency display recompute: <16ms (1 frame) on a 1000-row deals list

### Observability
- Counter `i18n_locale_switched_total{from,to}` increments on `PATCH /users/me { locale }`
- Counter `fx_rates_fetched_total{source,status}` increments per BullMQ job
- Counter `saved_views_created_total{resource}` increments on create
- All 3 emitted from existing Prometheus registry (`apps/api/src/modules/metrics`) — no new infra `[verificat: metrics module exists]`

### Audit log entries (append-only)
- `LOCALE_CHANGED` cu old/new locale on user profile update
- `SAVED_VIEW_CREATED`, `SAVED_VIEW_UPDATED`, `SAVED_VIEW_DELETED` cu view id + name diff
- `EXCHANGE_RATE_UPSERTED` is **NOT** audited (high-volume, low-value) — confirm with `security-blue-team`

### Definition of Done per feature (per CLAUDE.md #2)
1. Lint pass: `pnpm lint`
2. Unit + integration tests pass: `pnpm --filter @amass/api vitest run`
3. Coverage clears 80% on new services
4. E2E smoke pass on staging
5. `code-reviewer` approves
6. `security-red-team` approves (OWASP check on new endpoints)
7. `accessibility-auditor` approves (a11y check on new UI)
8. `docs/FEATURES.md` updated
9. CHANGELOG entry written
10. Conventional commit landed on `main`

---

## Decisions needed (require user sign-off before backend-engineer starts)

1. **`User.locale` default for existing users** — option A: backfill all to `ro-RO` in migration; option B: nullable + treat null as `ro-RO` at runtime. **Recommendation:** A (explicit > implicit).
2. **Tenant base currency for value_base** — option A: hardcode RON globally; option B: add `tenants.base_currency String @default("RON")`. **Recommendation:** B (allows globex-uk tenant later).
3. **Email template restructure** — flat `email.service.ts` today vs proposed `templates/{name}.{locale}.hbs` dir. **Recommendation:** create `apps/api/src/modules/email/templates/` now (Phase 0) to avoid double work in Phase 1 (campaign builder).
4. **Default views — labels source** — JSON in `i18n/<locale>/savedViews.json` vs hardcoded in `LanguageSwitcher.tsx`. **Recommendation:** JSON (translatable by i18n-localization without code edit).
5. **Saved view filters schema validation** — accept arbitrary JSON (today) vs per-resource Zod schema (`companies.filters.schema.ts`). **Recommendation:** arbitrary JSON now + size cap; add per-resource Zod in Phase 1 once filter shapes stabilize.
6. **FX rates source fallback** — if ECB down for >24h, fall back to which source? Options: BNR (RO national bank, has only RON pairs), Open Exchange Rates (paid, $12/mo). **Recommendation:** stale-with-banner now, evaluate BNR free API after Phase 0 ship.

---

## Out of scope (defer to Phase 1+ — DO NOT build now)

- More languages beyond EN (DE, FR, HU, BG queued for Phase 5 if EU expansion happens)
- RTL language support (Arabic, Hebrew) — no demand signal
- Per-tenant custom translations / brand-specific terminology overrides (Phase 3 enterprise)
- Crypto currencies (BTC, ETH) in deals — explicit OUT per ROADMAP_V2.md §Tier 3
- Shared saved views (team views visible to all in tenant) — Phase 2 collaboration
- View export/import (JSON file) — Phase 3
- Currency conversion in invoices (`Invoice.currency` is separate enum `InvoiceCurrency` at `schema.prisma:1037` `[verificat]`) — handled separately in billing module
- Real-time FX rates (intraday updates) — daily is enough per business decision
- Custom date format per user (only locale-driven for now)
- Saved view sharing via URL — Phase 2

---

## RICE prioritization within Phase 0

| Feature | Reach (users/Q) | Impact | Confidence | Effort (weeks) | RICE |
|---|---|---|---|---|---|
| **i18n EN** | 50 (every new EN-speaking tenant + 1 existing onboarding) | 2 (high — unblocks EN sales) | 80% | 1.4 | 57 |
| **Multi-currency** | 30 (tenants with foreign-currency deals) | 2 (high — accurate reporting) | 70% | 0.8 | 52 |
| **Saved views** | 100 (every active sales user) | 1 (medium — productivity, not blocker) | 90% | 1.0 | 90 |

**Recommended sequence within Phase 0 (parallel where possible):**
1. **Saved views** ships first (highest RICE, lowest tech risk — schema already done)
2. **Multi-currency** ships second (medium effort, isolated to deals module)
3. **i18n EN** ships last in Phase 0 (touches every file in `apps/web`, highest blast radius — needs both above for label translation)

This aligns with ROADMAP_V2 §10 (parallel sub-agent batches) — sequence is suggested order for *merging to main*, not for *starting work*.
