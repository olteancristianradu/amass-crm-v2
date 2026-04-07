import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * Multi-tenant isolation test. Two tenants register, then we verify that
 * neither can see the other's users — at the API layer AND the DB layer (RLS).
 */
describe('Multi-tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slugA = `mt-a-${Date.now()}`;
  const slugB = `mt-b-${Date.now()}`;
  let tokenA = '';
  let tokenB = '';
  let tenantIdA = '';
  let tenantIdB = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);

    // Register two tenants
    const a = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: slugA, email: 'a@a.com', password: 'password123', fullName: 'Owner A' })
      .expect(201);
    tokenA = a.body.tokens.accessToken;
    tenantIdA = a.body.user.tenantId;

    const b = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: slugB, email: 'b@b.com', password: 'password123', fullName: 'Owner B' })
      .expect(201);
    tokenB = b.body.tokens.accessToken;
    tenantIdB = b.body.user.tenantId;
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  it('GET /users returns only the caller tenant users', async () => {
    const resA = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(resA.body).toHaveLength(1);
    expect(resA.body[0].email).toBe('a@a.com');

    const resB = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(resB.body).toHaveLength(1);
    expect(resB.body[0].email).toBe('b@b.com');
  });

  it('GET /users without token → 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/users').expect(401);
  });

  it('RLS: a query inside runWithTenant(A) cannot see tenant B users', async () => {
    const visibleFromA = await prisma.runWithTenant(tenantIdA, (tx) =>
      tx.user.findMany({ where: {} }), // intentionally NO tenantId filter to test RLS
    );
    expect(visibleFromA.every((u) => u.tenantId === tenantIdA)).toBe(true);
    expect(visibleFromA.find((u) => u.email === 'b@b.com')).toBeUndefined();
  });

  it('RLS: writing to wrong tenant from inside runWithTenant fails', async () => {
    // Inside a tenant-A transaction, attempting to insert a user with tenantId=B
    // must be rejected by the RLS WITH CHECK clause.
    await expect(
      prisma.runWithTenant(tenantIdA, (tx) =>
        tx.user.create({
          data: {
            tenantId: tenantIdB, // wrong tenant!
            email: 'evil@a.com',
            passwordHash: 'x',
            fullName: 'Evil',
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('audit_logs were written for register', async () => {
    const logs = await prisma.runWithTenant(tenantIdA, (tx) =>
      tx.auditLog.findMany({ where: { action: 'auth.register' } }),
    );
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.every((l) => l.tenantId === tenantIdA)).toBe(true);
  });

  it('RBAC: AGENT role cannot list users (requires OWNER/ADMIN/MANAGER)', async () => {
    // Demote A's owner to AGENT directly via DB (skip API), then re-issue token
    await prisma.user.updateMany({
      where: { tenantId: tenantIdA, email: 'a@a.com' },
      data: { role: 'AGENT' },
    });
    // Get fresh token
    const fresh = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: slugA, email: 'a@a.com', password: 'password123' })
      .expect(200);
    const agentToken = fresh.body.tokens.accessToken;

    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(403);
  });
});
