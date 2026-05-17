import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * Phase 0 Sprint 2 — Multi-currency (ECB daily rates) e2e scaffold.
 *
 * Source-of-truth scenarios: docs/specs/phase-0.md §Feature 2 (Story 2.1, 2.2)
 * Threat model:              docs/threat-models/phase-0.md §Feature 2
 *                            (T-FX-S-01, T-FX-T-01..04, T-FX-D-01..03, T-FX-E-01)
 *
 * Status of code as of scaffold creation (2026-05-17):
 *   - ExchangeRate model       EXISTS          [verificat: schema.prisma:2774 — landed in ddb3b2e]
 *   - exchange-rates module    does NOT exist  [verificat: ls apps/api/src/modules — absent]
 *   - Deal.value + currency    EXIST           [verificat: schema.prisma:617-618]
 *   - Deal.amountBase column   EXISTS          [verificat: ddb3b2e schema migration]
 *   - tenants.baseCurrency     EXISTS          [verificat: schema.prisma:65]
 *   - BullMQ queue 'fx-rates'  not wired       [verificat]
 *
 * Because NO endpoint exists yet, almost every scenario is `it.todo()`.
 * One `it()` real is included as an "acceptance gate" that PROVES the endpoint
 * shape we'll add — it's wrapped in `it.skip(...)` until the endpoint lands.
 * The `describe.skip` blocks below contain the FULL implementation body that
 * should pass once `backend-engineer` implements the ExchangeRate module —
 * remove the `.skip` to promote (then it must pass).
 *
 * Hardcoded ECB-like fixtures (realistic mid-May 2026, ±2% of ECB recent):
 *   EUR→RON ≈ 5.0500   USD→RON ≈ 4.6500   GBP→RON ≈ 5.8900
 *   CHF→RON ≈ 5.1200   PLN→RON ≈ 1.1700
 */
describe('MultiCurrency / ExchangeRates (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slugA = `fx-a-${Date.now()}`;
  const slugB = `fx-b-${Date.now()}`;
  let tokenA = '';
  let tokenB = '';
  let tenantIdA = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const a = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: slugA, email: 'a@fx.com', password: 'password123', fullName: 'A' })
      .expect(201);
    tokenA = a.body.tokens.accessToken;
    tenantIdA = a.body.user.tenantId;

    const b = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: slugB, email: 'b@fx.com', password: 'password123', fullName: 'B' })
      .expect(201);
    tokenB = b.body.tokens.accessToken;
  }, 30000);

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Story 2.1 — System fetches ECB rates daily
  // ──────────────────────────────────────────────────────────────────────
  describe('Story 2.1 — ECB daily fetch [propus — module not yet implemented]', () => {
    it.todo('BullMQ cron `fx-rates.daily` at 06:00 Europe/Bucharest enqueues a job (spec 2.1)');
    it.todo('worker fetches ECB XML and upserts 10 rows (5 forex + 5 inverse) for the day (spec 2.1)');
    it.todo('idempotent re-run does NOT duplicate rows — exactly 10 per asOf (T-FX-T-04, spec 2.1)');
    it.todo('jobId deterministic `fx-daily-YYYYMMDD` dedupes concurrent fires (T-FX-T-04)');
    it.todo('concurrent upsert race: two workers, same (from, to, asOf) → no P2002 surfaces (T-FX-T-04)');
    it.todo('ECB unreachable: job moves to DLQ after 3 retries + Sentry alert fires (T-FX-D-01)');
    it.todo('weekend: ECB returns Friday rates, upsert uses asOf=Friday (spec 2.1)');
    it.todo('rate sanity bound: deviation >15% vs previous day → marked needsApproval (T-FX-S-01)');
    it.todo('TLS-pinned ECB URL: HTTP scheme rejected at Zod config-load time (T-FX-S-02)');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Story 2.2 — Deal value in chosen display currency
  // ──────────────────────────────────────────────────────────────────────
  describe('Story 2.2 — Deal value with original + base currency [propus]', () => {
    it.todo('POST /deals { value: 1000, currency: "EUR" } stores original AND computes valueBase in RON (spec 2.2)');
    it.todo('GET deal returns BOTH original (value + currency) and base (valueBase + baseCurrency) (spec 2.2)');
    it.todo('historic rate immutability: valueBase frozen at creation, NOT rewritten by future rate moves (spec 2.2, T-FX-T-03)');
    it.todo('Prisma.Decimal precision: 0.1 EUR × 4.9750 = 0.50 RON exactly (no IEEE drift) (T-FX-T-01)');
    it.todo('PATCH deal with valueBase in body → 400 (server-computed only, T-FX-T-02)');
    it.todo('unsupported currency code XYZ → 400 VALIDATION_ERROR (T-FX-E-01, spec 2.2)');
    it.todo('column total on deals list: SUM of valueBase across mixed currencies (spec 2.2)');
    it.todo('audit log records deal.currency.changed with old/new amount snapshot (T-FX-R-01)');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Public exchange-rates endpoint
  // ──────────────────────────────────────────────────────────────────────
  describe('GET /api/v1/exchange-rates [propus]', () => {
    it.todo('GET /exchange-rates?from=EUR&to=RON returns latest rate (spec 2.2)');
    it.todo('GET /exchange-rates?from=EUR&to=RON&date=2026-05-17 returns historical rate (spec 2.2)');
    it.todo('returns { rate, asOf, stale: true } when ECB down + last rate >24h old (T-FX-D-01)');
    it.todo('cross-tenant: rates are global, identical body for tenant A vs B (spec 2.2)');
    it.todo('rate-limited at default per-tenant throttle (T-FX-D-02)');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Tenant base currency
  // ──────────────────────────────────────────────────────────────────────
  describe('Tenant base currency [propus]', () => {
    it.todo('GET /api/v1/tenant/base-currency returns own tenant base (default RON)');
    it.todo('PATCH /api/v1/tenant/base-currency (OWNER only) updates it');
    it.todo('non-OWNER PATCH returns 403');
    it.todo('cross-tenant GET /api/v1/tenants/:otherSlug/base-currency returns 404 (spec 2.2)');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Acceptance gate — real implementation body, currently SKIPPED.
  // Promote these (remove `.skip`) once `backend-engineer` lands the
  // exchange-rates module. They WILL FAIL until then, so they stay skipped
  // to keep the suite green per task constraints.
  // ──────────────────────────────────────────────────────────────────────
  describe.skip('ACCEPTANCE GATES — promote when feature lands', () => {
    it('POST /api/v1/deals { value, currency: EUR } stores valueBase computed via current EUR→RON rate', async () => {
      // 1) Seed today's rate via Prisma (until ECB worker runs in tests).
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      await (prisma as unknown as { exchangeRate: { create: (args: unknown) => Promise<unknown> } }).exchangeRate.create({
        data: {
          fromCurrency: 'EUR',
          toCurrency: 'RON',
          rate: '5.0500',
          asOf: today,
          source: 'TEST',
        },
      });

      // 2) Need a pipeline + stage to create a deal — fetch default.
      const pipelines = await request(app.getHttpServer())
        .get('/api/v1/pipelines')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const stageId = pipelines.body[0].stages.find((s: { type: string }) => s.type === 'OPEN').id;

      // 3) Create deal in EUR.
      const res = await request(app.getHttpServer())
        .post('/api/v1/deals')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          pipelineId: pipelines.body[0].id,
          stageId,
          title: 'Acme Q3',
          value: '1000.00',
          currency: 'EUR',
        })
        .expect(201);

      expect(res.body.value).toBe('1000');
      expect(res.body.currency).toBe('EUR');
      // valueBase (or amountBase — naming TBD) MUST exist + equal 1000 × 5.05 = 5050.00
      expect(res.body.valueBase ?? res.body.amountBase).toBe('5050');
      expect(res.body.baseCurrency).toBe('RON');
    });

    it('GET /api/v1/exchange-rates?from=EUR&to=RON returns the seeded rate', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/exchange-rates?from=EUR&to=RON')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.rate).toBe('5.0500');
      expect(res.body.asOf).toBeTruthy();
      expect(res.body.stale).toBeFalsy();
    });

    it('cross-tenant exchange-rates response is identical across tenants (rates are global)', async () => {
      const resA = await request(app.getHttpServer())
        .get('/api/v1/exchange-rates?from=EUR&to=RON')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const resB = await request(app.getHttpServer())
        .get('/api/v1/exchange-rates?from=EUR&to=RON')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(resA.body.rate).toBe(resB.body.rate);
      expect(resA.body.asOf).toBe(resB.body.asOf);
    });
  });

  // tenantIdA referenced to silence unused warnings; will be consumed when
  // base-currency endpoint scaffolds are promoted from `.todo()` to real `it()`.
  it('scaffold sanity — tenant A registered', () => {
    expect(tenantIdA).toBeTruthy();
    expect(tokenA).toBeTruthy();
    expect(tokenB).toBeTruthy();
  });
});
