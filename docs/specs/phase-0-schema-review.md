# Phase 0 — Schema Review & Prisma Diff

> Generated 2026-05-17 by `database-architect` agent
> Reviewer: schema diff + RLS + index strategy pentru cele 3 features Phase 0 din `docs/ROADMAP_V2.md` §10.
> Markers: `[verificat]` = citit din cod cu tool · `[propus]` = sugestie nouă · `[presupun]` = inferență fără verificare directă.

## 0. TL;DR

| Migration | Status | Tenant-scoped | Schema change? |
|---|---|---|---|
| **A — i18n** | RECOMMEND **file-based** pentru MVP; opțional `TenantUiOverride` model dacă tenant cere custom labels | N/A (file) sau Da (DB) | `User.preferredLocale` + `Tenant.defaultLocale` (necesare oricum) |
| **B — Multi-currency** | NEW model `ExchangeRate` (GLOBAL) + opt fields `Deal.amountBase`, `Deal.fxRateAt` (tenant-scoped via Deal) | `ExchangeRate` = NO, `Deal` deja DA | Da — 1 tabel nou + 2 coloane pe `deals` |
| **C — SavedView** | Există deja `[verificat: schema.prisma:2539]`. **ZERO schema change.** Singurul fix: adaugă `SavedView` în `TENANT_SCOPED_MODELS` (bug preexistent) | Da | Doar update la `prisma.service.ts` |

**Bug preexistent descoperit în această review** `[verificat]`:
- `SavedView` model **nu** este în array-ul `TENANT_SCOPED_MODELS` din `apps/api/src/infra/prisma/prisma.service.ts:10-92`. Service-ul (`saved-views.service.ts:34`) injectează manual `tenantId`, deci e safe în practică, dar contravine layer-ului 2 al defense-in-depth (CLAUDE.md rule #3). Acelasi pattern de bug a fost prins la `ScimToken` în B3-PR4 (vezi comment `prisma.service.ts:71-74`). **Severitate: HIGH** — trebuie remediat în Phase 0 oricum.

---

## 1. Migration A — i18n catalog

### 1.1 Decizia: file-based, NU model `Translation` în DB

**Argumente pro-file (recomandat):**

1. **Roadmap §10 nu cere DB.** ROADMAP_V2.md:75 spune literal: "Toate stringurile UI extrăse în `apps/web/src/i18n/{ro,en}.json`, lazy-load per limbă, language switcher în settings." — explicit JSON pe FS, build-time.
2. **MVP nu are tenant-custom labels.** Dacă acum 2 tenants vor să rebranduiască "Lead" → "Prospect", e un feature distinct (custom field labels) ce nu apare în Phase 0.
3. **Cache invalidation = bug magnet.** Service workers PWA, Redis cache, FE Zustand — toate trebuie să fie aware de translation version. File-based + build hash = invalidate per deploy, gratis.
4. **Performance.** O cerere `GET /i18n/en.json` la load = 1 fișier static servit de Caddy. Versus 1 query DB per pageload sau cache cu invalidation.
5. **Volum suficient.** EN + RO × ~2000 keys (estimat conservator pentru un CRM B2B) = 4000 rows minim — fine pentru DB, dar 0% benefit vs JSON static.

**Când reintroducem DB-backed:**
- Tenant vrea custom labels per role/locale ("Manager EN" → "Director EN")
- A/B testing pe wording UI (necesită runtime swap, nu deploy-time)
- White-label / reseller use-case
→ Atunci adăugăm un model `TenantTranslationOverride(tenantId, locale, key, value)` care **OVERRIDE-uiește** catalog file-based, nu îl înlocuiește. Trigger: business decision, nu Phase 0.

### 1.2 Single schema change necesar — pentru file-based: persist user preference

Trebuie să știm ce limbă să servim la user după login. Două câmpuri minime:

```prisma
// Adaugat la model User (schema.prisma:107):
model User {
  // ...existing fields...
  preferredLocale String @default("ro") @map("preferred_locale") // ISO 639-1: "ro" | "en"
  // ...
}

// Adaugat la model Tenant (schema.prisma:24):
model Tenant {
  // ...existing fields...
  defaultLocale String @default("ro") @map("default_locale")   // fallback când User.preferredLocale e null/invalid
  enabledLocales String[] @default(["ro", "en"]) @map("enabled_locales") // limba pe care tenant le permite
  // ...
}
```

**De ce `String` și nu `enum Locale`?**
- Postgres ENUM e migration-greu (`ALTER TYPE … ADD VALUE` poate cere downtime în versiuni vechi). Zod în `packages/shared` validează valoarea (`z.enum(["ro", "en"])`) — same safety, fără DDL pain când adăugăm "de" sau "hu".
- Convenția existentă în schema folosește `String` pentru `language` la CallTranscript:898 `[verificat]`.

### 1.3 SQL migration (manual)

Path propus: `apps/api/prisma/migrations/20260518100000_user_tenant_locale/migration.sql`

```sql
-- Phase 0 / Migration A — i18n: persist per-user locale preference and
-- per-tenant default + allowed locales. The catalog itself is shipped as
-- static JSON in `apps/web/src/i18n/{ro,en}.json` (NOT in DB) — see
-- docs/specs/phase-0-schema-review.md for rationale.

ALTER TABLE "users"
  ADD COLUMN "preferred_locale" TEXT NOT NULL DEFAULT 'ro';

ALTER TABLE "tenants"
  ADD COLUMN "default_locale"  TEXT     NOT NULL DEFAULT 'ro',
  ADD COLUMN "enabled_locales" TEXT[]   NOT NULL DEFAULT ARRAY['ro', 'en']::TEXT[];

-- No index needed: locale columns are read on session bootstrap (1 row by PK)
-- and never used as a filter predicate. Indexing them would be a write penalty
-- for zero query benefit.

-- No RLS change: `users` and `tenants` already have RLS (migrations
-- 20260407210058_audit_log and 20260422100000_rls_remaining_tables); the new
-- columns inherit the existing per-row policies.
```

### 1.4 RLS analysis

- `users` already enforced — locale e doar o coloană nouă, policy din `20260407210058_audit_log:50-52` se aplică automat.
- `tenants` — table-ul `tenants` **nu** are RLS (intentional, vezi comment-ul în 20260407210058_audit_log:42-43 — slug lookup pre-auth). Asta e OK: `default_locale` și `enabled_locales` nu sunt secrete și se citesc oricum doar pentru tenant-ul curent prin `tx.tenant.findUnique({where: {id: ctx.tenantId}})`.

### 1.5 `TENANT_SCOPED_MODELS` update

- `User` deja în array `[verificat: prisma.service.ts:84]`. **Nicio modificare necesară.**
- `Tenant` nu e și nu trebuie să fie acolo (rule din comment `prisma.service.ts:9` — "tenants itself is NOT in this list").

### 1.6 Index strategy

- **Zero indexes new.** Read pattern: `SELECT preferred_locale FROM users WHERE id = $1` — covered de PK. `enabled_locales` se citește cu `SELECT enabled_locales FROM tenants WHERE id = $1` — covered de PK.
- Validez: nu vom rula vreodată `SELECT * FROM users WHERE preferred_locale = 'en'` (asta ar fi analytics, nu hot-path) — deci NO index.

### 1.7 Backward compat

- `DEFAULT 'ro'` pe ambele coloane → rows existente se umplu automat la `ALTER TABLE`. Zero downtime.
- `enabled_locales TEXT[] DEFAULT ARRAY['ro','en']` → toate tenants existente primesc EN enabled by default. Dacă vreun tenant vrea RO-only, FE settings-ul îl permite să-l scoată.

### 1.8 Riscuri

| Risc | Probabilitate | Mitigare |
|---|---|---|
| User cu `preferred_locale = 'fr'` (out-of-set) la viitor | Mică | Zod validation în service: dacă `enabledLocales` nu conține valoarea → fallback la `tenant.defaultLocale` |
| Race condition: tenant scoate "en" din `enabledLocales`, dar 50 users au `preferred_locale = 'en'` | Mică | Logică în i18n init: dacă preferred nu e în enabled, folosește defaultLocale (silent fallback) |
| `TEXT[]` Postgres = non-GIN-indexed search expensive dacă vreodată facem `WHERE 'en' = ANY(enabled_locales)` | Foarte mică (nu e use case) | Skip pentru acum; adăugăm GIN dacă apare query |

---

## 2. Migration B — `ExchangeRate` (NEW) + `Deal.amountBase`

### 2.1 Decizia: `ExchangeRate` este GLOBAL, NU tenant-scoped

**De ce GLOBAL:**

1. **Rates ECB sunt obiective.** EUR/RON la 2026-05-17 e aceeași pentru toți. Nu există "rata mea privată".
2. **Storage economy.** 1 rate × 7 currencies × 365 zile × 5 ani = ~13k rows total. Dacă era tenant-scoped × 1000 tenants = 13M rows pentru ZERO benefit.
3. **Cache friendly.** O cerere `GET /fx/EUR/RON?asOf=2026-05-17` returnează același payload pentru toți → Redis cache cu TTL 24h, hit rate ~100%.
4. **Audit needs.** Singura excepție: dacă tenant suprascrie cu rate manuală (use-case: contract a fixat o rată de schimb specifică). Soluție: un câmp opt `Deal.fxRateOverride Decimal?` — NU separate tenant-scoped rate table.

**Implicații pentru defense-in-depth:**

- `ExchangeRate` **NU** intră în `TENANT_SCOPED_MODELS` (n-are `tenantId`).
- RLS **DEZACTIVAT** explicit pe acest table (sau enabled cu policy "always true") — orice tenant poate `SELECT`.
- **CRITICAL:** GRANT `INSERT/UPDATE/DELETE` ar trebui să fie **doar pentru un rol system** (`fx_writer` sau `postgres` migration owner), NU pentru `app_user`. Job-ul BullMQ care cheamă ECB e cron, nu user-facing — nu trebuie să poată orice tenant `INSERT` în această tabelă.

### 2.2 Prisma diff

```prisma
// === NEW ENUM ===
enum FxRateSource {
  ECB      // European Central Bank — free, EUR/X base, daily
  FIXER    // Fixer.io fallback — paid, all pairs, hourly
  MANUAL   // Admin override (rare; logged in audit)
}

// === NEW MODEL ===
/// Daily FX rates fetched from ECB by a BullMQ cron job (06:00 RO every day).
/// GLOBAL — not tenant-scoped. All tenants read the same rates. Writes are
/// restricted to a system role; `app_user` has SELECT only.
///
/// Storage shape: 1 row per (from, to, asOf). For ECB the base is always EUR,
/// so RON→USD = (1/EUR_RON) * EUR_USD; we materialize both directions to keep
/// the lookup query trivial (single index probe).
model ExchangeRate {
  id           String       @id @default(cuid())
  fromCurrency String       @map("from_currency") @db.VarChar(3)
  toCurrency   String       @map("to_currency") @db.VarChar(3)
  rate         Decimal      @db.Decimal(18, 8)
  asOf         DateTime     @map("as_of") @db.Date
  source       FxRateSource @default(ECB)
  fetchedAt    DateTime     @default(now()) @map("fetched_at")
  createdAt    DateTime     @default(now()) @map("created_at")

  @@unique([fromCurrency, toCurrency, asOf], map: "exchange_rates_pair_date_unique")
  @@index([asOf(sort: Desc)], map: "exchange_rates_as_of_desc_idx")
  @@map("exchange_rates")
}

// === MODIFY existing model Deal (schema.prisma:607) — add 2 fields ===
model Deal {
  // ...existing fields...
  amountBase Decimal?  @map("amount_base") @db.Decimal(14, 2)
  fxRateAt   DateTime? @map("fx_rate_at") @db.Date
  // ...rest unchanged...
}
```

### 2.3 SQL migration (manual)

Path: `apps/api/prisma/migrations/20260518110000_exchange_rate_and_deal_base/migration.sql`

```sql
-- Phase 0 / Migration B — Multi-currency. Adds global FX rates table and
-- denormalized `amount_base` on deals so reports/aggregations stay fast
-- without joining the FX table on every row.

-- ─── ExchangeRate (GLOBAL, NOT tenant-scoped) ─────────────────────────────
CREATE TYPE "FxRateSource" AS ENUM ('ECB', 'FIXER', 'MANUAL');

CREATE TABLE "exchange_rates" (
  "id"            TEXT NOT NULL,
  "from_currency" VARCHAR(3) NOT NULL,
  "to_currency"   VARCHAR(3) NOT NULL,
  "rate"          DECIMAL(18, 8) NOT NULL,
  "as_of"         DATE NOT NULL,
  "source"        "FxRateSource" NOT NULL DEFAULT 'ECB',
  "fetched_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- Daily-latest lookup: unique on (from, to, asOf). Prevents double-write
-- if the cron job runs twice for the same day.
CREATE UNIQUE INDEX "exchange_rates_pair_date_unique"
  ON "exchange_rates" ("from_currency", "to_currency", "as_of");

-- Range scan "give me rates after 2026-01-01": DESC sort matches `ORDER BY as_of DESC LIMIT N`.
CREATE INDEX "exchange_rates_as_of_desc_idx"
  ON "exchange_rates" ("as_of" DESC);

-- ─── Permissions: SELECT only for app_user; writes via a system role ──────
-- `ALTER DEFAULT PRIVILEGES` from migration 20260407211000_app_role granted
-- INSERT/UPDATE/DELETE/SELECT on all new tables to app_user — so we must
-- REVOKE the write permissions explicitly here.
REVOKE INSERT, UPDATE, DELETE ON "exchange_rates" FROM app_user;
-- SELECT remains granted (default privileges).

-- The BullMQ cron job that calls ECB runs as the migration owner (postgres)
-- through a dedicated DATABASE_URL_FX env var. If we later create an
-- `fx_writer` role, GRANT it INSERT/UPDATE here.

-- NO RLS on this table — it is intentionally global. Enabling RLS with a
-- "always true" policy would just add per-query overhead for zero benefit.

-- ─── Deal.amountBase + fxRateAt (denormalized for fast reporting) ─────────
ALTER TABLE "deals"
  ADD COLUMN "amount_base" DECIMAL(14, 2),
  ADD COLUMN "fx_rate_at"  DATE;

-- No new index on deals: existing `(tenant_id, status)` covers the dashboard
-- query `SUM(amount_base) WHERE tenant_id=$1 AND status='WON'`. Postgres
-- can use the existing index for filtering, then aggregate the SUM in
-- a single pass. If it ever becomes slow (>500ms p95 on 50k rows), add:
--   CREATE INDEX deals_tenant_status_amount_base_idx
--     ON deals (tenant_id, status) INCLUDE (amount_base) WHERE deleted_at IS NULL;
-- But measure first.

-- Backfill: existing deals get amount_base = value (assumes RON-only past data).
-- If your history has multi-currency deals, this is WRONG — but the rate
-- table is empty, so we cannot compute correctly anyway. Mark them for
-- manual re-evaluation in F1.5.
UPDATE "deals"
   SET "amount_base" = "value",
       "fx_rate_at"  = CURRENT_DATE
 WHERE "value" IS NOT NULL
   AND "amount_base" IS NULL
   AND "currency" = 'RON';

-- Leave non-RON deals with NULL amount_base — the service-layer recompute
-- job (Phase 0 / B-PR3) will fill them once ECB data is loaded.
```

### 2.4 RLS analysis

- **`exchange_rates`:** NO RLS. Explicit, justified above. **Risk if misconfigured:** an app_user could `INSERT` a forged rate and skew reports → mitigated by `REVOKE INSERT, UPDATE, DELETE FROM app_user`.
- **`deals.amount_base` / `fx_rate_at`:** inherit RLS din existing `deals` policy (already enabled in earlier migrations `[presupun: nu am verificat exact care migration enabled RLS pe deals; verifică cu grep dacă vrei certitudine]`).

### 2.5 `TENANT_SCOPED_MODELS` update

**NU adăuga `ExchangeRate`.** Explicit comment în service-ul care îl folosește, ca să prevină mistakes viitoare. Adaugă în migration SQL un comment top:

```sql
-- IMPORTANT: ExchangeRate is GLOBAL by design. Do NOT add it to
-- TENANT_SCOPED_MODELS in apps/api/src/infra/prisma/prisma.service.ts.
-- Doing so would make every query inject a `tenantId` filter that doesn't
-- match any column → Prisma error P2009.
```

### 2.6 Index strategy + EXPLAIN mental

Queries pe care BE le va rula:

**Q1: Get latest rate for a pair (hot path, called per-deal-render)**
```sql
SELECT rate FROM exchange_rates
 WHERE from_currency = 'EUR' AND to_currency = 'RON'
 ORDER BY as_of DESC LIMIT 1;
```
- Plan: `Index Scan Backward using exchange_rates_pair_date_unique` → 1 row. `[propus: <0.1ms]`
- OK pentru hot path. Cache Redis 24h pe top — vom hit DB doar la cold cache.

**Q2: Get rate at specific date (for amount_base recompute)**
```sql
SELECT rate FROM exchange_rates
 WHERE from_currency = 'EUR' AND to_currency = 'RON' AND as_of = '2026-05-17';
```
- Plan: `Index Scan using exchange_rates_pair_date_unique` → unique probe. `[propus: <0.1ms]`

**Q3: List rates for chart "EUR/RON last 30 days"**
```sql
SELECT as_of, rate FROM exchange_rates
 WHERE from_currency = 'EUR' AND to_currency = 'RON'
   AND as_of >= CURRENT_DATE - INTERVAL '30 days'
 ORDER BY as_of;
```
- Plan: `Index Scan using exchange_rates_pair_date_unique` cu range condition. `[propus: <1ms pe 30 rows]`

**Q4: Dashboard SUM(amount_base) per tenant per status**
```sql
SELECT status, SUM(amount_base) FROM deals
 WHERE tenant_id = $1 AND deleted_at IS NULL
 GROUP BY status;
```
- Plan: Existing `deals_tenant_id_status_idx` `[verificat: schema.prisma:643]` → covered. Aggregation in-mem post-scan.

**Sub-7-index pentru `deals` check** `[verificat]`:
- `deals` are deja 7 indexes (`[tenantId, pipelineId, stageId, orderInStage]`, `[tenantId, status]`, `[tenantId, ownerId, status]`, `[tenantId, companyId]`, `[tenantId, contactId]`, `[tenantId, expectedCloseAt]`, `[tenantId, deletedAt]`). **AM ATINS PLAFONUL.** Recomandare: NU adăuga index nou pentru `amount_base` în Phase 0 — adăugăm doar dacă query plan demonstrează nevoie (rule din job-ul meu: "Don't add indexes speculatively. Show the query that needs it.").

### 2.7 Backward compat / Backfill

- Existing `deals` with `currency = 'RON'`: backfill `amount_base = value`, `fx_rate_at = CURRENT_DATE` (asumpția: 1 RON = 1 RON e mereu adevărat).
- Existing `deals` with non-RON currency: rămân `NULL` pe `amount_base` până când:
  1. Cron job ECB încarcă istoric (Phase 0 task B-PR3 separate)
  2. O migration secundară (`20260519000000_backfill_amount_base.sql`) face JOIN cu `exchange_rates` și recomputează.
- **Risk:** dashboards care fac `SUM(amount_base)` vor exclude NULL → underreport. **Mitigare BE:** service `DealReportService` returnează două numere: `totalBase` (computed) + `untrackedCount` (rows cu amount_base IS NULL); FE arată "+ N deals în alte valute (necalculate)".

### 2.8 Risk register

| Risc | Probabilitate | Impact | Mitigare |
|---|---|---|---|
| ECB API down → rate not fetched → `amount_base` stale | Medie | Mic (1 zi delay accept) | Fallback la ultima rată cunoscută; alert după 48h fără update |
| Daily cron rulează de 2 ori (e.g., podul restartează) → duplicate insert | Mică | Zero (UNIQUE constraint) | `INSERT ... ON CONFLICT DO NOTHING` |
| Tenant updates `Deal.value` dar nu și `amount_base` → divergență | Mare dacă fac update manual | Mediu | **Trigger Postgres** (proposed in B-PR3) sau **Prisma extension** care recomputează `amount_base = value * rate(currency, baseCurrency, today)` la fiecare update |
| `Decimal(18,8)` overflow pe rate-uri exotice (ex: VES = 0.00000023 USD) | Foarte mică | Mic | 18,8 acoperă 10 cifre înainte de punct și 8 după — Bitcoin, VES, etc. acoperite |
| `Decimal(14,2)` pe `amount_base` overflow la 99,999,999,999.99 | Foarte mică (>$100B per deal) | Catastrofal | Aliniere cu `Deal.value` (același 14,2) — dacă vreodată mărim, mărim ambele atomic |

---

## 3. Migration C — `SavedView` enhancement

### 3.1 Decizia: **ZERO schema change**. Model deja există + e sufficient pentru DoD.

**Verificare against acceptance criteria** `[ROADMAP_V2.md:75-78]`:

| Cerință | Status în schema actuală |
|---|---|
| `POST /saved-views` | Există `[verificat: saved-views.controller.ts exists]` |
| `GET /saved-views?entity=...` | Există via `list(resource)` `[verificat: saved-views.service.ts:55]` |
| Per-user scope | `(ownerId, resource, name)` unique + index `[verificat: schema.prisma:2551-2552]` |
| Cross-page filtering | `resource` discriminator field există |
| FE dropdown "Vederile mele" | FE work, NU schema work |

**Acoperit. Niciun câmp nou.**

### 3.2 Single REAL fix: adaugă `SavedView` în `TENANT_SCOPED_MODELS`

**Bug preexistent, severitate HIGH** `[verificat: prisma.service.ts:10-92 — SavedView ABSENT]`.

Patch exact:

```typescript
// În apps/api/src/infra/prisma/prisma.service.ts, după linia 70 ('ReportTemplate'):

  'ReportTemplate',
  // Phase 0 / Migration C fix: SavedView missed from this set when added
  // in 20260428150000_saved_views. Service-layer currently sets tenantId
  // manually (saved-views.service.ts:34) so practical writes are safe, but
  // tenantExtension defense-layer-2 was bypassed. Same pattern as the
  // ScimToken fix in B3-PR4 (see comment above).
  'SavedView',
  'ScimToken',
  ...
```

### 3.3 System-provided default views — SKIP for Phase 0

Roadmap nu cere. Dacă vrei "All deals", "My open deals", "Won this quarter" pre-built:
- **Option A (recomandat):** hardcode în FE (`apps/web/src/features/deals/default-views.ts`) — zero DB pollution, zero migration.
- **Option B (mai târziu, dacă tenants cer custom defaults per tenant):** adaugă `isSystem Boolean @default(false)` + `ownerId String?` (nullable) + index parțial `WHERE is_system = true`.

**Nu propun acum.** Decision deferred până avem 5+ requests reali.

### 3.4 RLS analysis

- `saved_views` are deja RLS enabled `[verificat: 20260428150000_saved_views/migration.sql:33-37]`. Policy match pattern repo.
- GRANT `app_user` deja prezent `[verificat: linie 39]`.
- **Zero RLS change needed.**

### 3.5 `TENANT_SCOPED_MODELS` update — REQUIRED

Vezi §3.2. Fără asta, dacă cineva refactorizează service-ul să folosească `runWithTenant` fără să mai injecteze `tenantId` manual în `data:`, va leak cross-tenant fără warning.

### 3.6 Index strategy

`saved_views` are deja:
- `UNIQUE (owner_id, resource, name)` — prevents dup names per user/resource
- `INDEX (tenant_id, owner_id, resource)` — hot path pentru `list(resource)`

Hot path: `SELECT * FROM saved_views WHERE tenant_id = $1 AND owner_id = $2 AND resource = $3 ORDER BY updated_at DESC`
- Plan: `Index Scan using saved_views_tenant_id_owner_id_resource_idx` → small result set (max ~50 views per user per resource). Sort in-mem.
- `[propus: <0.5ms pe DB cu volum real]`

**Verdict:** OK. Niciun index nou.

### 3.7 Backward compat / risc

- Zero (no schema change).
- Singurul risc: `TENANT_SCOPED_MODELS` update fără spec coverage — service deja face manual inject, deci dublul-filtru ar fi `where: { tenantId: X, tenantId: X }` (Prisma o tratează ca duplicate key in spread — VERIFY behavior `[presupun: Prisma merge ultimul win — verifică în spec]`).

---

## 4. Action items pentru `backend-engineer`

Ordered by dependency:

### A. Pre-requisite (do first, no dependency)
- [ ] `apps/api/src/infra/prisma/prisma.service.ts` — adaugă `'SavedView'` în `TENANT_SCOPED_MODELS` (cf. §3.2)
- [ ] `apps/api/src/infra/prisma/prisma.service.spec.ts` — adaugă test: când `runWithTenant` rulează `tx.savedView.create({data: {...}})` fără `tenantId` explicit, este auto-injectat
- [ ] `apps/api/src/modules/saved-views/saved-views.service.spec.ts` — verifică că removeing manual `tenantId` din `data:` (linia 34) nu sparge testul (dovedește că extension-ul preia)

### B. Migration A — i18n (file-based + DB locale prefs)
- [ ] FE: `apps/web/src/i18n/{ro,en}.json` + react-i18next setup (no DB)
- [ ] Migration SQL `20260518100000_user_tenant_locale/migration.sql` (vezi §1.3)
- [ ] Schema.prisma: adaugă `preferredLocale` la `User` model + `defaultLocale`, `enabledLocales` la `Tenant` model
- [ ] Zod schema în `packages/shared`: `LocaleSchema = z.enum(["ro", "en"])`
- [ ] Service: `LocaleService.resolveForUser(userId)` cu fallback enabledLocales → defaultLocale → 'ro'
- [ ] **NU** updatezi `TENANT_SCOPED_MODELS` (User deja în, Tenant nu trebuie)

### C. Migration B — ExchangeRate + Deal.amountBase
- [ ] Migration SQL `20260518110000_exchange_rate_and_deal_base/migration.sql` (vezi §2.3)
- [ ] Schema.prisma: NEW enum `FxRateSource`, NEW model `ExchangeRate`, MODIFY `Deal` (add `amountBase`, `fxRateAt`)
- [ ] `apps/api/src/modules/fx/` module nou (service + controller + cron worker + spec)
  - Cron: BullMQ daily 06:00 RO → fetch ECB → upsert into `exchange_rates`
  - Service: `convert(amount: Decimal, from: string, to: string, asOf?: Date): Promise<Decimal>` cu Redis cache
- [ ] `apps/api/src/modules/deals/deals.service.ts` — update Deal `create` și `update` să calculeze `amountBase = value * fxRate(currency, tenant.baseCurrency, today)` și `fxRateAt = today`
- [ ] **NU** adăuga `ExchangeRate` în `TENANT_SCOPED_MODELS`. ADD comment top of migration explicand de ce.
- [ ] Backfill SQL: rulează manual sau ca data migration după ce ECB istoric e încărcat
- [ ] Spec: tests pentru `convert` la limita Decimal precision, missing rate fallback, REVOKE permissions verified (un test `pg-test` care încearcă INSERT cu rol app_user și se aștaptă error)

### D. Migration C — SavedView (no schema)
- [ ] Doar update `TENANT_SCOPED_MODELS` (vezi §A) — Phase 0 task C e clean
- [ ] FE work pentru "Vederile mele" dropdown — outside scope-ul meu de review

### E. Documentation
- [ ] `docs/FEATURES.md` → add section "Multi-currency", "i18n", "Saved Views"
- [ ] `docs/SCALING.md` → update `TENANT_SCOPED_MODELS` count în doc (deja la 70+ models)
- [ ] `LESSONS.md` → entry: "SavedView a fost added în schema 2026-04-28 dar omis din TENANT_SCOPED_MODELS — patternul anti-bug: când adaugi model tenant-scoped, grep prisma.service.ts ca sanity check ÎNAINTE de PR"

---

## 5. Verdicte per migration

| Migration | VERDICT | Blockers |
|---|---|---|
| **A — i18n** | APPROVE conditional | Zero. File-based + 3 noi coloane (User.preferredLocale, Tenant.defaultLocale, Tenant.enabledLocales). |
| **B — ExchangeRate** | APPROVE conditional | Trebuie REVOKE INSERT/UPDATE/DELETE FROM app_user explicit în migration (default privileges din 20260407211000 ar acorda altfel write access). Test obligatoriu: `app_user` nu poate scrie. |
| **C — SavedView** | APPROVE | Patch TENANT_SCOPED_MODELS în PR-ul C (1-line change, dar critical pentru defense-in-depth consistency). |

---

## 6. Note finale

**Lucruri NU am rulat** `[depășește contextul]`:
- `EXPLAIN ANALYZE` real în Postgres — nu am acces la DB live din contextul ăsta. Toate cifrele de cost sunt estimate (`[propus]`).
- Verificare exactă a versiunii Prisma 6 pentru `INCLUDE` clause support pe indexes (Prisma 6 acceptă `@@index(..., type: ...)` dar `INCLUDE` necesită SQL custom). Dacă e nevoie de covering index pe Deal, scrie SQL manual.
- Verificare că `ALTER DEFAULT PRIVILEGES` din 20260407211000 încă se aplică (dacă cineva a făcut între timp `REVOKE` global) — `[presupun]` că da, pe baza că celelalte 50 migrations new tables n-au avut nevoie explicit GRANT și service-ul funcționează.

**Decizii deschise care BLOCHEAZĂ start-ul migration-ului** — răspunsuri default dacă user nu spune altfel:
1. **Base currency per tenant.** ExchangeRate are nevoie să știe ce e "base". Default: `Tenant.baseCurrency String @default("RON")`. Adaug în Migration A sau B? **Recomandare: în B**, alături de FX rates (logic group).
2. **Trigger Postgres vs Prisma extension pentru `amount_base` recompute.** Default: **Prisma extension** (application-layer, easier to test, no DDL surprise în migration). Dacă perf devine problemă, mutăm la trigger.
3. **Locale enum vs String.** Default: **String** (cf. §1.2). Confirm dacă vrei `enum Locale { RO, EN }` în loc.

**Întrebări pentru product-manager** (nu schema-related, dar relevant pentru Phase 0):
- Pentru i18n: ce facem cu data formatting (date, currency display, number separators)? `Intl` API în FE acoperă built-in dacă păstrăm `preferredLocale` ca BCP-47 (`ro-RO`, `en-US`).
- Pentru saved views: limită rezonabilă per user (50? 100?) ca să nu poată un user crea 10k și să rupă dropdown-ul FE?

