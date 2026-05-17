-- Phase 0 combined schema — i18n + multi-currency foundations.
-- Spec: docs/specs/phase-0.md   Review: docs/specs/phase-0-schema-review.md
-- Threats covered: T-FX-T-02 (REVOKE writes), T-FX-T-04 (UNIQUE),
--                  T-FX-S-01 (sanity bounds enforced in worker, not here),
--                  T-I18N-* (catalog file-based; only DB bit is locale prefs).
--
-- IMPORTANT: `exchange_rates` is GLOBAL by design. Do NOT register
-- `ExchangeRate` in TENANT_SCOPED_MODELS in
-- apps/api/src/infra/prisma/prisma.service.ts. Doing so would make every
-- query auto-inject a `tenantId` filter that does not match any column
-- (Prisma error P2009). Writes are denied to `app_user` via REVOKE below;
-- the BullMQ cron worker runs as the migration-owner role to refresh rates.

-- ─── Multi-currency: enum + global rates table ───────────────────────────────
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

-- Idempotency for the daily cron: T-FX-T-04. Combined with BullMQ
-- jobId='fx-daily-${YYYYMMDD}' this makes double-insert impossible.
CREATE UNIQUE INDEX "exchange_rates_pair_date_unique"
    ON "exchange_rates" ("from_currency", "to_currency", "as_of");

-- Backward range scans (last 30 days for a chart): DESC matches ORDER BY.
CREATE INDEX "exchange_rates_as_of_desc_idx"
    ON "exchange_rates" ("as_of" DESC);

-- Permissions: SELECT only for the app role. The 20260407211000_app_role
-- migration set `ALTER DEFAULT PRIVILEGES … GRANT SELECT, INSERT, UPDATE,
-- DELETE … TO app_user`, so newly created tables get write access by
-- default. Revoke that for `exchange_rates` so a compromised app cannot
-- forge FX rates and silently inflate/deflate every tenant's `amountBase`.
-- (T-FX-T-02 in docs/threat-models/phase-0.md)
REVOKE INSERT, UPDATE, DELETE ON "exchange_rates" FROM app_user;
-- SELECT is left in place via default privileges.

-- No RLS on `exchange_rates`: it is intentionally global. Enabling RLS
-- with an always-true policy would add per-query overhead for zero benefit
-- and obscure the GLOBAL contract documented in the model comment.

-- ─── Deals: denormalized base-currency amount + FX snapshot date ─────────────
ALTER TABLE "deals"
    ADD COLUMN "amount_base" DECIMAL(14, 2),
    ADD COLUMN "fx_rate_at"  DATE;

-- Backfill rule: trivial-case only. RON deals get amount_base = value
-- because the tenant default base currency is RON. Non-RON deals stay
-- NULL until the ECB cron has loaded historical rates and the recompute
-- job (Phase 0 / B-PR3) fills them. Reports surface the gap as a count
-- rather than silently dropping rows (DealReportService contract).
UPDATE "deals"
   SET "amount_base" = "value",
       "fx_rate_at"  = CURRENT_DATE
 WHERE "value"       IS NOT NULL
   AND "amount_base" IS NULL
   AND "currency"    = 'RON';

-- No new index on deals — schema already carries 7 composite indexes on
-- (tenant_id, …). Adding amount_base coverage now is speculative; revisit
-- if dashboard SUM(amount_base) p95 exceeds 500ms (database-architect §2.6).

-- ─── Tenants: base currency + i18n config ────────────────────────────────────
-- DEFAULT covers existing rows atomically at ALTER TABLE — zero downtime.
ALTER TABLE "tenants"
    ADD COLUMN "base_currency"   TEXT     NOT NULL DEFAULT 'RON',
    ADD COLUMN "default_locale"  TEXT     NOT NULL DEFAULT 'ro',
    ADD COLUMN "enabled_locales" TEXT[]   NOT NULL DEFAULT ARRAY['ro', 'en']::TEXT[];

-- ─── Users: per-user locale override ─────────────────────────────────────────
-- NOT NULL with default so existing rows backfill atomically. Service
-- layer validates against `tenant.enabled_locales` and falls back to
-- `tenant.default_locale` when the user's choice has been revoked by
-- admin (silent fallback, see schema-review §1.8).
ALTER TABLE "users"
    ADD COLUMN "preferred_locale" TEXT NOT NULL DEFAULT 'ro';
