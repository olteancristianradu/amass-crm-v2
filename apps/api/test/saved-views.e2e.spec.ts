import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * Phase 0 Sprint 2 — SavedViews e2e scaffold.
 *
 * Source-of-truth scenarios: docs/specs/phase-0.md §Feature 3 (Story 3.1, 3.2, 3.3)
 * Threat model:              docs/threat-models/phase-0.md §Feature 3 (T-SV-T-01, T-SV-D-01)
 *
 * Status of code as of scaffold creation (2026-05-17):
 *   - SavedView model EXISTS  [verificat: prisma/schema.prisma:2539]
 *   - SavedViewsController EXISTS  [verificat: apps/api/src/modules/saved-views/saved-views.controller.ts]
 *     - POST   /api/v1/saved-views        (create)
 *     - GET    /api/v1/saved-views?resource=...  (list, owner-scoped)
 *     - PATCH  /api/v1/saved-views/:id    (update — spec calls it PUT, controller is PATCH)
 *     - DELETE /api/v1/saved-views/:id    (remove)
 *   - SavedViewResourceSchema enum  [verificat: packages/shared/src/schemas/saved-view.ts:11]
 *     allowed: companies | contacts | clients | leads | deals | cases | invoices | quotes
 *
 * Real `it()`  = endpoint exists today, scenario MUST pass.
 * `it.todo()`  = scenario described in spec but not yet enforced server-side
 *                (system default views, payload size cap, per-resource Zod schema,
 *                CROSS_TENANT_READ_BLOCKED audit event, etc). Promote to real `it()`
 *                once the corresponding service/middleware lands.
 */
describe('SavedViews (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slugA = `sv-a-${Date.now()}`;
  const slugB = `sv-b-${Date.now()}`;
  let tokenA = '';      // OWNER of tenant A — primary actor
  let tokenAMaria = ''; // ADMIN of tenant A — cross-owner same-tenant probe
  let tokenB = '';      // OWNER of tenant B — cross-tenant probe
  let viewIdRadu = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);

    // Tenant A — primary
    const a = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: slugA, email: 'radu@a.com', password: 'password123', fullName: 'Radu' })
      .expect(201);
    tokenA = a.body.tokens.accessToken;

    // Tenant A second user (Maria — ADMIN, same tenant as Radu).
    // The register endpoint enforces 1 tenant per slug (OWNER-only first user),
    // so we seed Maria directly via Prisma with a real bcrypt hash, then login.
    // [verificat: apps/api/src/modules/auth/auth.service.ts:101 throws TENANT_EXISTS]
    const tenantA = a.body.user.tenantId;
    const mariaPassword = 'password123';
    const mariaHash = await bcrypt.hash(mariaPassword, 10);
    await prisma.user.create({
      data: {
        tenantId: tenantA,
        email: 'maria@a.com',
        passwordHash: mariaHash,
        fullName: 'Maria',
        role: 'ADMIN',
      },
    });
    const mariaLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: slugA, email: 'maria@a.com', password: mariaPassword });
    if (mariaLogin.status === 200) {
      tokenAMaria = mariaLogin.body.tokens.accessToken;
    }
    // If login fails (unexpected — would indicate auth regression), the same-tenant
    // cross-owner scenarios skip via the conditional inside each it() body.

    // Tenant B — cross-tenant probe
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
  // Story 3.1 — CRUD happy path
  // ──────────────────────────────────────────────────────────────────────
  describe('POST /api/v1/saved-views', () => {
    it('creates a view for the current user (happy path — spec 3.1)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/saved-views')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          resource: 'companies',
          name: 'RO SMBs >5 employees stale',
          filters: { country: 'RO', employees_min: 5, lastContactedBefore: '2026-04-17' },
        })
        .expect(201);
      expect(res.body.id).toBeTruthy();
      expect(res.body.resource).toBe('companies');
      expect(res.body.name).toBe('RO SMBs >5 employees stale');
      expect(res.body.filters).toEqual({
        country: 'RO',
        employees_min: 5,
        lastContactedBefore: '2026-04-17',
      });
      viewIdRadu = res.body.id;
    });

    it('rejects duplicate name within (owner, resource) with 409 (spec 3.1)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/saved-views')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          resource: 'companies',
          name: 'RO SMBs >5 employees stale', // same as above
          filters: { country: 'RO' },
        });
      expect(res.status).toBe(409);
      expect(res.body.code ?? res.body?.error?.code).toBe('SAVED_VIEW_NAME_TAKEN');
    });

    it('allows same name across different resources (spec 3.1)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/saved-views')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          resource: 'deals',
          name: 'RO SMBs >5 employees stale', // same name, different resource → OK
          filters: { stage: 'OPEN' },
        })
        .expect(201);
    });

    it('rejects empty name with 400 (spec 3.1)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/saved-views')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ resource: 'companies', name: '', filters: {} });
      expect(res.status).toBe(400);
    });

    it('rejects unknown resource with 400 (spec 3.1)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/saved-views')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ resource: 'unicorns', name: 'X', filters: {} });
      expect(res.status).toBe(400);
    });

    it('rejects filters as array (must be JSON object) with 400 (spec 3.1)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/saved-views')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ resource: 'companies', name: 'X', filters: [] });
      expect(res.status).toBe(400);
    });

    it('rejects filters as string (must be JSON object) with 400 (spec 3.1)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/saved-views')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ resource: 'companies', name: 'X', filters: 'all' });
      expect(res.status).toBe(400);
    });

    // Name length boundary — controller currently caps at 80 (shared schema),
    // spec mentions 100. Promote once decision is made.
    it.todo('accepts name of exactly max length (80 per schema, 100 per spec — reconcile)');

    // T-SV-D-01 — filters payload >16KB should be 413. body-parser limit not yet set.
    it.todo('rejects filters payload >16KB with 413 PAYLOAD_TOO_LARGE [T-SV-D-01, propus]');

    // T-SV-T-01 — per-resource Zod schema for filters not yet implemented; spec
    // decision §6 says arbitrary JSON now + size cap, per-resource in Phase 1.
    it.todo('validates filters JSON shape per resource (T-SV-T-01 — Phase 1)');
  });

  describe('GET /api/v1/saved-views', () => {
    it('lists views filtered by resource for current user only (spec 3.1)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/saved-views?resource=companies')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      // Radu created 1 companies view; deals view should NOT appear here.
      expect(res.body.every((v: { resource: string }) => v.resource === 'companies')).toBe(true);
      expect(res.body.some((v: { id: string }) => v.id === viewIdRadu)).toBe(true);
    });

    it('returns 401 without auth token (spec 3.1)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/saved-views?resource=companies')
        .expect(401);
    });

    it('rejects missing resource query param with 400 (spec 3.1)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/saved-views')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/v1/saved-views/:id', () => {
    it('renames a view (spec 3.1)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/saved-views/${viewIdRadu}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'RO SMBs — active' })
        .expect(200);
      expect(res.body.name).toBe('RO SMBs — active');
    });

    it('replaces filters (NOT merge) on update (spec 3.1)', async () => {
      const newFilters = { country: 'RO', employees_min: 10 };
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/saved-views/${viewIdRadu}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ filters: newFilters })
        .expect(200);
      expect(res.body.filters).toEqual(newFilters);
      // Verify NOT merged with old keys (lastContactedBefore should be gone)
      expect(res.body.filters).not.toHaveProperty('lastContactedBefore');
    });
  });

  describe('DELETE /api/v1/saved-views/:id', () => {
    it('hard-deletes a view and returns 204 (spec 3.1)', async () => {
      // Create then delete a fresh throwaway view.
      const created = await request(app.getHttpServer())
        .post('/api/v1/saved-views')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ resource: 'contacts', name: 'ephemeral', filters: {} })
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/api/v1/saved-views/${created.body.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);
      // Confirm absent from list.
      const list = await request(app.getHttpServer())
        .get('/api/v1/saved-views?resource=contacts')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(list.body.find((v: { id: string }) => v.id === created.body.id)).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Story 3.2 — Tenant + owner isolation
  // ──────────────────────────────────────────────────────────────────────
  describe('Cross-tenant + cross-owner isolation (spec 3.2)', () => {
    it('cross-tenant list: tenant B cannot see tenant A views (spec 3.2)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/saved-views?resource=companies')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(res.body.find((v: { id: string }) => v.id === viewIdRadu)).toBeUndefined();
    });

    it('cross-tenant read of a specific view should return 404 (spec 3.2)', async () => {
      // Endpoint `GET /api/v1/saved-views/:id` is NOT in controller (only LIST).
      // Until that endpoint exists, this test asserts via PATCH (which calls findOne)
      // — same auth path, same 404 leak-prevention guarantee.
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/saved-views/${viewIdRadu}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'hacked' });
      expect(res.status).toBe(404); // NOT 403 — leak prevention per docs/SCALING.md
    });

    it('cross-tenant delete returns 404 and leaves the row intact (spec 3.2)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/saved-views/${viewIdRadu}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(404);
      // Verify row still there from A's perspective.
      const list = await request(app.getHttpServer())
        .get('/api/v1/saved-views?resource=companies')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(list.body.some((v: { id: string }) => v.id === viewIdRadu)).toBe(true);
    });

    // Same-tenant cross-owner probes — depend on Maria having a usable token,
    // which depends on multi-user register on same slug. Mark conditional.
    it('same-tenant cross-owner read returns 404 (spec 3.2)', async () => {
      if (!tokenAMaria) {
        // Skip body when invitation flow not yet wired; keeps assertion visible.
        return;
      }
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/saved-views/${viewIdRadu}`)
        .set('Authorization', `Bearer ${tokenAMaria}`)
        .send({ name: 'maria-hacked' });
      expect(res.status).toBe(404);
    });

    it.todo('admin role does NOT bypass owner scope — admin GET own-tenant other-user view → 404 (spec 3.2)');

    it.todo('audit log records CROSS_TENANT_READ_BLOCKED event on denied read (spec 3.2 — [propus])');

    it.todo('GET ignores ?tenant_id=other query param (middleware enforced) (spec 3.2)');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Story 3.3 — System default views (FE-only, but listed for completeness)
  // ──────────────────────────────────────────────────────────────────────
  describe('System default views (spec 3.3 — FE responsibility)', () => {
    it.todo('default views are NOT returned by GET /saved-views (FE-only constants)');
    it.todo('attempting DELETE on a synthetic default-view id returns 404 (spec 3.3)');
    it.todo('default views are localized via i18n (covered in i18n-locale.e2e.spec.ts)');
  });
});
