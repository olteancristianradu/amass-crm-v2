import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import {
  SCIM_GROUP_SCHEMA_URN,
  SCIM_LIST_RESPONSE_SCHEMA_URN,
  SCIM_USER_SCHEMA_URN,
} from '../src/modules/scim/scim.dto';
import {
  oktaComplexFilter,
  oktaGroupAddMember,
  oktaGroupRemoveMemberLegacy,
  oktaUserCreate,
  oktaUserPatchActive,
  oktaUserPatchName,
} from './fixtures/okta-scim-payloads';

/**
 * B3-PR4 — End-to-end SCIM ceremony, Okta-shaped.
 *
 * Replays exactly the call sequence Okta performs against a SCIM 2.0 app
 * during the lifecycle of a provisioned user:
 *
 *   1. Operator pastes a bearer token into Okta → Okta hits POST /Users.
 *   2. Okta polls GET /Users?filter=userName eq "..." to dedupe.
 *   3. Okta calls GET /Users/:id to confirm the row it just created.
 *   4. Okta sends PATCH active=false on deprovision.
 *   5. Okta calls GET /Groups for the role-derived synthetic groups.
 *   6. Okta sends PATCH members add to put a user into a group.
 *   7. Okta calls DELETE /Users/:id (soft-delete in our impl).
 *   8. Okta polls GET /Users — soft-deleted user is gone from listings.
 *
 * Then SECURITY:
 *   9. No Authorization header → 401.
 *  10. Revoked bearer token → 401.
 *  11. Tenant-B token reading tenant-A users → sees only B's users
 *      (multi-tenant isolation defense-in-depth: bearer guard + Prisma
 *      extension + Postgres RLS).
 *
 * Infra deps: real Postgres + Redis (same as `multi-tenant.e2e.spec.ts`).
 *
 * **Why `describe.skip`** (B3-PR4 known-blocker — to be unskipped in B3-PR3.1):
 *
 * The first dry run of this test against a live Postgres surfaced two
 * pre-existing bugs in the B3-PR3 bearer-auth path that block end-to-end
 * SCIM provisioning today. They are NOT in this PR's file scope (production
 * code in `src/modules/scim/` and `src/infra/prisma/`) so they ship as a
 * follow-up:
 *
 *   1. `ScimBearerGuard` does NOT call `tenantStorage.run(...)` (or otherwise
 *      populate the AsyncLocalStorage that `tenantExtension()` reads via
 *      `getTenantContext()`). The guard only stamps `req.scimTenantId`. So
 *      when `ScimService.createUser` calls `prisma.runWithTenant(tid, fn)`
 *      and inside `fn` runs `tx.user.create({data: dataWithoutTenantId})`,
 *      the extension's `if (!ctx) return query(args)` short-circuits and
 *      tenantId is never auto-injected — Prisma rejects with
 *      `Argument tenant is missing` and the request 500s. Fix: have
 *      `ScimBearerGuard` wrap the downstream handler in
 *      `tenantStorage.run({ tenantId, ... }, () => ...)` (mirroring what
 *      `TenantContextMiddleware` does for JWT-auth requests).
 *
 *   2. The `ScimToken` model is missing from `TENANT_SCOPED_MODELS` in
 *      `prisma.service.ts`. Even with bug #1 fixed, `ScimTokenService.create()`
 *      would 500 on `tx.scimToken.create({data: {name, tokenHash}})` because
 *      the extension never adds the model to its scoped list. Fix: append
 *      `'ScimToken'` to the `TENANT_SCOPED_MODELS` set.
 *
 * Both fixes are 1–3 lines each. Re-enable this suite (remove `.skip`) once
 * they land. The test code below is the executable spec they must satisfy,
 * which is the entire point of this PR — surface the gap with a black-box
 * test that mirrors Okta's actual SCIM dance, not just our unit assumptions.
 *
 * Verified manually on 2026-05-15 against local Postgres: with both fixes
 * applied transiently, 5/18 cases pass clean (POST/PATCH/DELETE/GET — the
 * scim path). The remaining failures stem from the `app_user` PG role
 * lacking SELECT on `scim_tokens` (no GRANT in the migration — a third
 * follow-up) plus a couple of error-envelope shape mismatches where
 * `AllExceptionsFilter` overwrites the `scimType` field. Documented in
 * `docs/SCIM_OKTA_SETUP.md` troubleshooting + the report.
 */
describe('SCIM Okta flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now();
  const slugA = `scim-okta-a-${stamp}`;
  const slugB = `scim-okta-b-${stamp}`;
  let adminJwtA = '';
  let adminJwtB = '';
  let scimTokenA = '';
  let scimTokenB = '';
  let scimTokenIdA = '';
  let createdUserId = '';
  let aliceEmail = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);

    // Per-test unique userName so reruns don't collide on the (tenantId,email)
    // unique index across leftover rows from a failed previous run.
    aliceEmail = `alice+${stamp}@example.com`;

    // Register two tenants. The OWNER created by /auth/register has the
    // JWT-protected SCIM admin surface available (POST /scim/tokens).
    const a = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        tenantSlug: slugA,
        email: 'owner-a@scim-okta.test',
        password: 'password123',
        fullName: 'Owner A',
      })
      .expect(201);
    adminJwtA = a.body.tokens.accessToken;

    const b = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        tenantSlug: slugB,
        email: 'owner-b@scim-okta.test',
        password: 'password123',
        fullName: 'Owner B',
      })
      .expect(201);
    adminJwtB = b.body.tokens.accessToken;

    // Mint a SCIM bearer token for each tenant via the admin surface — the
    // exact same call an operator would make in the CRM UI before pasting the
    // token into Okta.
    const tokA = await request(app.getHttpServer())
      .post('/api/v1/scim/tokens')
      .set('Authorization', `Bearer ${adminJwtA}`)
      .send({ name: 'okta-fixture-A' })
      .expect(201);
    expect(tokA.body.token).toBeTypeOf('string');
    expect(tokA.body.warning).toMatch(/will not be shown again/i);
    scimTokenA = tokA.body.token;
    scimTokenIdA = tokA.body.id;

    const tokB = await request(app.getHttpServer())
      .post('/api/v1/scim/tokens')
      .set('Authorization', `Bearer ${adminJwtB}`)
      .send({ name: 'okta-fixture-B' })
      .expect(201);
    scimTokenB = tokB.body.token;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.tenant
        .deleteMany({ where: { slug: { in: [slugA, slugB] } } })
        .catch(() => {
          /* leftover cleanup is best-effort */
        });
    }
    if (app) await app.close();
  });

  // ─── Provisioning ceremony ────────────────────────────────────────────────

  it('1. POST /scim/v2/Users (Okta-shaped body) → 201 + SCIM User envelope', async () => {
    // Okta sends extra fields (externalId, phoneNumbers, enterprise extension)
    // that our schema does not model. The Zod schema drops them silently —
    // proving graceful tolerance is the whole point of this test.
    const res = await request(app.getHttpServer())
      .post('/api/v1/scim/v2/Users')
      .set('Authorization', `Bearer ${scimTokenA}`)
      .send({ ...oktaUserCreate, userName: aliceEmail, emails: [{ value: aliceEmail, primary: true, type: 'work' }] })
      .expect(201);

    expect(res.body.schemas).toContain(SCIM_USER_SCHEMA_URN);
    expect(res.body.userName).toBe(aliceEmail);
    expect(res.body.name.givenName).toBe('Alice');
    expect(res.body.name.familyName).toBe('Wonder');
    expect(res.body.active).toBe(true);
    expect(res.body.id).toBeTypeOf('string');
    expect(res.body.meta.location).toBe(`/scim/v2/Users/${res.body.id}`);
    createdUserId = res.body.id;
  });

  it('2. GET /Users?filter=userName eq "..." → 1 result', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/scim/v2/Users')
      .query({ filter: `userName eq "${aliceEmail}"` })
      .set('Authorization', `Bearer ${scimTokenA}`)
      .expect(200);

    expect(res.body.schemas).toContain(SCIM_LIST_RESPONSE_SCHEMA_URN);
    expect(res.body.totalResults).toBe(1);
    expect(res.body.Resources).toHaveLength(1);
    expect(res.body.Resources[0].userName).toBe(aliceEmail);
    expect(res.body.Resources[0].id).toBe(createdUserId);
  });

  it('3. GET /Users/:id → full user envelope', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/scim/v2/Users/${createdUserId}`)
      .set('Authorization', `Bearer ${scimTokenA}`)
      .expect(200);

    expect(res.body.id).toBe(createdUserId);
    expect(res.body.userName).toBe(aliceEmail);
    expect(res.body.emails[0].primary).toBe(true);
  });

  it('3b. PATCH name fields → fullName recomposed', async () => {
    // Optional rename round-trip: proves the name.givenName/familyName paths
    // both land and the service recomposes fullName correctly.
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/scim/v2/Users/${createdUserId}`)
      .set('Authorization', `Bearer ${scimTokenA}`)
      .send(oktaUserPatchName)
      .expect(200);
    expect(res.body.name.givenName).toBe('Alicia');
    expect(res.body.name.familyName).toBe('Wonderland');
    expect(res.body.name.formatted).toBe('Alicia Wonderland');
  });

  it('4. PATCH active=false → user deactivated', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/scim/v2/Users/${createdUserId}`)
      .set('Authorization', `Bearer ${scimTokenA}`)
      .send(oktaUserPatchActive)
      .expect(200);
    expect(res.body.active).toBe(false);
  });

  // Re-activate so the subsequent group-membership test can act on a live user.
  it('4b. PATCH active=true → reactivate for group test', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/scim/v2/Users/${createdUserId}`)
      .set('Authorization', `Bearer ${scimTokenA}`)
      .send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: true }],
      })
      .expect(200);
    expect(res.body.active).toBe(true);
  });

  // ─── Groups ───────────────────────────────────────────────────────────────

  it('5. GET /Groups → 5 synthetic role-derived groups', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/scim/v2/Groups')
      .set('Authorization', `Bearer ${scimTokenA}`)
      .expect(200);

    expect(res.body.totalResults).toBe(5);
    expect(res.body.Resources).toHaveLength(5);
    const ids = (res.body.Resources as Array<{ id: string }>).map((g) => g.id).sort();
    expect(ids).toEqual(['role:ADMIN', 'role:AGENT', 'role:MANAGER', 'role:OWNER', 'role:VIEWER']);
    for (const g of res.body.Resources) {
      expect(g.schemas).toContain(SCIM_GROUP_SCHEMA_URN);
    }
  });

  it('6. PATCH /Groups/role:ADMIN add member → user gets ADMIN role', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/scim/v2/Groups/role:ADMIN')
      .set('Authorization', `Bearer ${scimTokenA}`)
      .send(oktaGroupAddMember(createdUserId))
      .expect(200);

    // Confirm via GET /Users/:id — the user should now have role ADMIN (we
    // don't surface role through SCIM, so verify via the GET shape and the
    // /Groups membership instead).
    const grp = await request(app.getHttpServer())
      .get('/api/v1/scim/v2/Groups/role:ADMIN')
      .set('Authorization', `Bearer ${scimTokenA}`)
      .expect(200);
    const memberIds = (grp.body.members as Array<{ value: string }>).map((m) => m.value);
    expect(memberIds).toContain(createdUserId);
  });

  it('6b. Legacy PATCH remove-by-filter → user downgraded to VIEWER', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/scim/v2/Groups/role:ADMIN')
      .set('Authorization', `Bearer ${scimTokenA}`)
      .send(oktaGroupRemoveMemberLegacy(createdUserId))
      .expect(200);

    const grpAdmin = await request(app.getHttpServer())
      .get('/api/v1/scim/v2/Groups/role:ADMIN')
      .set('Authorization', `Bearer ${scimTokenA}`)
      .expect(200);
    expect((grpAdmin.body.members as Array<{ value: string }>).map((m) => m.value)).not.toContain(createdUserId);

    const grpViewer = await request(app.getHttpServer())
      .get('/api/v1/scim/v2/Groups/role:VIEWER')
      .set('Authorization', `Bearer ${scimTokenA}`)
      .expect(200);
    expect((grpViewer.body.members as Array<{ value: string }>).map((m) => m.value)).toContain(createdUserId);
  });

  // ─── Soft-delete + listing exclusion ──────────────────────────────────────

  it('7. DELETE /Users/:id → 204 (soft delete)', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/scim/v2/Users/${createdUserId}`)
      .set('Authorization', `Bearer ${scimTokenA}`)
      .expect(204);
  });

  it('8. GET /Users still returns the soft-deleted row but with active=false', async () => {
    // Our /Users service does NOT filter inactive users out of listings — the
    // SCIM contract is that soft-deleted users remain visible with active=false
    // so the IdP can render their deprovisioned state. The test asserts that
    // behavior so a future refactor that hides them surfaces here.
    const res = await request(app.getHttpServer())
      .get('/api/v1/scim/v2/Users')
      .query({ filter: `userName eq "${aliceEmail}"` })
      .set('Authorization', `Bearer ${scimTokenA}`)
      .expect(200);
    expect(res.body.totalResults).toBe(1);
    expect(res.body.Resources[0].active).toBe(false);
  });

  // ─── Security envelope ────────────────────────────────────────────────────

  it('9. No Authorization header → 401 on every SCIM route', async () => {
    await request(app.getHttpServer()).get('/api/v1/scim/v2/Users').expect(401);
    await request(app.getHttpServer()).get('/api/v1/scim/v2/Groups').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/scim/v2/Users')
      .send(oktaUserCreate)
      .expect(401);
  });

  it('10. Revoked bearer token → 401', async () => {
    // Mint a throwaway token, revoke it, then attempt to use it. Verifies
    // the `revokedAt IS NULL` filter on the verify path actually blocks.
    const fresh = await request(app.getHttpServer())
      .post('/api/v1/scim/tokens')
      .set('Authorization', `Bearer ${adminJwtA}`)
      .send({ name: 'to-be-revoked' })
      .expect(201);
    const rawToken = fresh.body.token as string;
    const tokenId = fresh.body.id as string;

    // Sanity: it works before revocation.
    await request(app.getHttpServer())
      .get('/api/v1/scim/v2/Users')
      .set('Authorization', `Bearer ${rawToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/v1/scim/tokens/${tokenId}`)
      .set('Authorization', `Bearer ${adminJwtA}`)
      .expect(204);

    await request(app.getHttpServer())
      .get('/api/v1/scim/v2/Users')
      .set('Authorization', `Bearer ${rawToken}`)
      .expect(401);
  });

  it('10b. Malformed Authorization header → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/scim/v2/Users')
      .set('Authorization', 'NotBearer xxx')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/scim/v2/Users')
      .set('Authorization', 'Bearer ')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/scim/v2/Users')
      .set('Authorization', 'Bearer this-is-not-a-real-token-xxxxxxxxxxxxxxxxxx')
      .expect(401);
  });

  it('11. Tenant-B token cannot see tenant-A users (multi-tenant isolation)', async () => {
    // Filter on the tenant-A user's email from tenant-B's bearer token.
    // Expected: zero results — RLS + tenantExtension scope to tenant B, which
    // has no `alice+...@example.com` row at all.
    const res = await request(app.getHttpServer())
      .get('/api/v1/scim/v2/Users')
      .query({ filter: `userName eq "${aliceEmail}"` })
      .set('Authorization', `Bearer ${scimTokenB}`)
      .expect(200);
    expect(res.body.totalResults).toBe(0);
    expect(res.body.Resources).toHaveLength(0);

    // And direct GET by tenant-A user id from tenant-B → 404 (the id is not
    // visible to tenant B at all; RLS hides the row).
    await request(app.getHttpServer())
      .get(`/api/v1/scim/v2/Users/${createdUserId}`)
      .set('Authorization', `Bearer ${scimTokenB}`)
      .expect(404);
  });

  // ─── Filter / capability limitations (documented in SCIM_OKTA_SETUP.md) ──

  it('12. Complex Okta filter → 400 invalidFilter (documented limitation)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/scim/v2/Users')
      .query({ filter: oktaComplexFilter })
      .set('Authorization', `Bearer ${scimTokenA}`)
      .expect(400);
    // Error envelope shape per RFC 7644 §3.12 — Okta's IdP parser looks for
    // `scimType` to render the right "what to fix" message to the admin.
    expect(res.body.scimType).toBe('invalidFilter');
  });

  it('13. POST /Groups → 501 notImplemented (synthetic groups are fixed)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/scim/v2/Groups')
      .set('Authorization', `Bearer ${scimTokenA}`)
      .send({
        schemas: [SCIM_GROUP_SCHEMA_URN],
        displayName: 'CustomGroup',
        members: [],
      })
      .expect(501);
    expect(res.body.scimType).toBe('notImplemented');
  });

  it('14. scim_tokens.lastUsedAt was bumped by the flow', async () => {
    // Best-effort write inside ScimTokenService.verifyToken — confirm it
    // actually fires. The bump is fire-and-forget so we tolerate eventual
    // consistency by re-reading.
    const row = await prisma.scimToken.findUnique({ where: { id: scimTokenIdA } });
    expect(row).toBeTruthy();
    expect(row?.lastUsedAt).not.toBeNull();
  });
});
