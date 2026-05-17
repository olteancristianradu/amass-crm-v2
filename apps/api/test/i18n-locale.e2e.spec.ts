import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * Phase 0 Sprint 2 — i18n locale (BE-side surface) e2e scaffold.
 *
 * Source-of-truth scenarios: docs/specs/phase-0.md §Feature 1 (Story 1.1, 1.2)
 * Threat model:              docs/threat-models/phase-0.md §Feature 1
 *                            (T-I18N-S-02, T-I18N-T-01..03, T-I18N-R-01, T-I18N-I-01..02,
 *                             T-I18N-D-01..02, T-I18N-E-01)
 *
 * Status of code as of scaffold creation (2026-05-17):
 *   - User.preferredLocale                EXISTS          [verificat: schema.prisma:152, ddb3b2e]
 *   - tenants.defaultLocale               EXISTS          [verificat: schema.prisma:71, ddb3b2e]
 *   - PATCH /api/v1/users/me locale-aware does NOT exist  [verificat: no users/me PATCH for locale]
 *   - GET  /api/v1/tenant/locale          does NOT exist  [verificat]
 *   - PATCH /api/v1/tenant/locale         does NOT exist  [verificat]
 *   - apps/web/src/i18n/                  EXISTS (RO baseline + EN scaffold per f5bdbc4)
 *   - email templates per locale          flat email.service.ts, no per-locale dir [verificat]
 *
 * Most scenarios are `it.todo()` until the User.preferredLocale migration
 * + locale endpoints + email template restructure land. One real `it()` is
 * the existing registration smoke (proves the test harness boots), and one
 * `describe.skip` block holds the acceptance gate bodies for promotion.
 *
 * Decisions needed from spec §"Decisions needed":
 *   #1 — User.locale default: backfill all to 'ro-RO' (recommended A)
 *   #3 — Email template restructure: create templates/{name}.{locale}.hbs dir now
 */
describe('i18n locale (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slugA = `i18n-a-${Date.now()}`;
  const slugB = `i18n-b-${Date.now()}`;
  let tokenA = '';
  let tokenB = '';
  let userIdA = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const a = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: slugA, email: 'radu@a.com', password: 'password123', fullName: 'Radu' })
      .expect(201);
    tokenA = a.body.tokens.accessToken;
    userIdA = a.body.user.id;

    const b = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: slugB, email: 'john@b.com', password: 'password123', fullName: 'John' })
      .expect(201);
    tokenB = b.body.tokens.accessToken;
  }, 30000);

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Story 1.1 — User locale switch
  // ──────────────────────────────────────────────────────────────────────
  describe('PATCH /api/v1/users/me — locale switch [propus]', () => {
    it.todo('PATCH { locale: "en-US" } returns 200 and persists user.preferredLocale (spec 1.1)');
    it.todo('default locale for new user is "ro-RO" (spec decisions #1 — recommended A)');
    it.todo('persistence: locale survives logout + login (spec 1.1)');
    it.todo('invalid locale string "xx-XX" → 400 with Zod error (spec 1.1)');
    it.todo('rejects Unicode bidi-control codepoints in locale string (T-I18N-S-02)');
    it.todo('caps Accept-Language header parsing at 10 entries (T-I18N-D-01)');
    it.todo('emits Prometheus counter i18n_locale_switched_total{from,to} on change');
    it.todo('emits audit event LOCALE_CHANGED { old, new, actorId, ipAddress, userAgent } (T-I18N-R-01)');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Cross-tenant isolation
  // ──────────────────────────────────────────────────────────────────────
  describe('Cross-tenant locale isolation [propus]', () => {
    it.todo('GET /api/v1/users/:otherId/preferences from another tenant → 404 (NOT 403, spec 1.1)');
    it.todo('audit log records CROSS_TENANT_READ_BLOCKED on denied preferences read (spec 1.1)');
    it.todo('user B cannot PATCH user A locale even within same tenant (404, spec 1.1)');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Tenant default locale
  // ──────────────────────────────────────────────────────────────────────
  describe('Tenant default locale [propus]', () => {
    it.todo('GET /api/v1/tenant/locale returns tenant.defaultLocale (default "ro-RO")');
    it.todo('PATCH /api/v1/tenant/locale (OWNER/ADMIN only) updates default');
    it.todo('PATCH by AGENT role → 403 FORBIDDEN');
    it.todo('cross-tenant GET /api/v1/tenants/:otherSlug/locale → 404');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Email + notification template rendering with locale
  // ──────────────────────────────────────────────────────────────────────
  describe('Email/notification rendering respects user.locale [propus]', () => {
    it.todo('welcome email enqueued with payload.locale = user.preferredLocale (spec 1.1)');
    it.todo('email subject is "Welcome to Amass CRM" for en-US (NOT "Bun venit") (spec 1.1)');
    it.todo('Content-Language header set to en-US on outbound (spec 1.1)');
    it.todo('rendered template path: templates/welcome.en-US.hbs (spec 1.1)');
    it.todo('ICU MessageFormat: user-controlled name "} other {<script>" is HTML-encoded (T-I18N-T-02)');
    it.todo('missing key in en-US falls back to ro-RO, NOT raw key (T-I18N-I-01, spec 1.1)');
    it.todo('warn log emitted on missing key: { msg: "i18n.missing", key, locale } (spec 1.1)');
  });

  // ──────────────────────────────────────────────────────────────────────
  // SSRF / config-injection on email locale
  // ──────────────────────────────────────────────────────────────────────
  describe('Security on locale input [propus]', () => {
    it.todo('locale string MUST match BCP-47 whitelist [ro-RO, en-US] (no path traversal)');
    it.todo('t(variable) dynamic key blocked by ESLint rule no-dynamic-i18n-key (T-I18N-T-01)');
    it.todo('dangerouslySetInnerHTML on translated content blocked by CI grep (T-I18N-T-03)');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Story 1.2 — i18n CI/lint guards (not e2e-testable here; reference only)
  // ──────────────────────────────────────────────────────────────────────
  describe('Story 1.2 — catalog lint guards (run in apps/web CI, not BE e2e)', () => {
    it.todo('[FE-side] pnpm --filter @amass/web lint:i18n: no hardcoded RO strings');
    it.todo('[FE-side] pnpm --filter @amass/web i18n:validate: all keys exist in both catalogs');
    it.todo('[FE-side] i18n bundle ≤50 KB gzipped per locale');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Acceptance gate — promote (remove .skip) once endpoints land
  // ──────────────────────────────────────────────────────────────────────
  describe.skip('ACCEPTANCE GATES — promote when feature lands', () => {
    it('PATCH /api/v1/users/me { locale: "en-US" } persists + responds 200', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ locale: 'en-US' })
        .expect(200);
      expect(res.body.preferredLocale ?? res.body.locale).toBe('en-US');

      // Reload from DB to confirm persistence.
      const row = await prisma.user.findUniqueOrThrow({ where: { id: userIdA } });
      expect((row as unknown as { preferredLocale?: string; locale?: string }).preferredLocale
        ?? (row as unknown as { locale?: string }).locale).toBe('en-US');
    });

    it('PATCH with invalid locale "xx-XX" → 400 Zod validation error', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ locale: 'xx-XX' });
      expect(res.status).toBe(400);
    });

    it('locale persists across re-login', async () => {
      // (1) Set locale.
      await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ locale: 'en-US' })
        .expect(200);

      // (2) Login fresh and check.
      const fresh = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ tenantSlug: slugA, email: 'radu@a.com', password: 'password123' })
        .expect(200);
      expect(fresh.body.user.preferredLocale ?? fresh.body.user.locale).toBe('en-US');
    });

    it('cross-tenant: user B cannot read user A preferences (404)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${userIdA}/preferences`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404); // NOT 403 — leak prevention
    });
  });

  // Sanity to keep harness exercised (and to silence unused-var warnings on
  // tokenB / userIdA until acceptance gates are promoted).
  it('scaffold sanity — two tenants registered', () => {
    expect(tokenA).toBeTruthy();
    expect(tokenB).toBeTruthy();
    expect(userIdA).toBeTruthy();
  });
});
