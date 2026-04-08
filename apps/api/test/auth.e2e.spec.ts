import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * Integration test against a REAL Postgres (the one in docker-compose).
 * Run `docker compose up -d postgres` before invoking `pnpm test`.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slug = `test-${Date.now()}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Cleanup: drop test tenants by slug pattern
    await prisma.tenant.deleteMany({ where: { slug: { startsWith: 'test-' } } });
    await app.close();
  });

  it('full flow: register → me → refresh → logout', async () => {
    // Register
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        tenantSlug: slug,
        tenantName: 'Test Co',
        email: 'admin@test.local',
        password: 'password123',
        fullName: 'Test Admin',
      })
      .expect(201);

    expect(reg.body.user.email).toBe('admin@test.local');
    expect(reg.body.user.role).toBe('OWNER');
    expect(reg.body.tokens.accessToken).toBeTruthy();
    expect(reg.body.tokens.refreshToken).toBeTruthy();

    const { accessToken, refreshToken } = reg.body.tokens;

    // /me with token
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body.email).toBe('admin@test.local');

    // /me without token → 401
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);

    // Refresh — must return the SAME `{ tokens }` shape as register/login.
    // (Bug fixed S6.5: refresh used to return bare AuthTokens, breaking client parsing.)
    const ref = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    expect(ref.body.tokens.accessToken).toBeTruthy();
    expect(ref.body.tokens.refreshToken).toBeTruthy();
    expect(ref.body.tokens.refreshToken).not.toBe(refreshToken); // rotated
    // Refresh response must NOT include `user` (only register/login do).
    expect(ref.body.user).toBeUndefined();

    const newRefresh = ref.body.tokens.refreshToken;

    // Old refresh token must now fail (single-use)
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    // Logout new refresh
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: newRefresh })
      .expect(204);

    // After logout, refresh fails
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: newRefresh })
      .expect(401);
  });

  it('login with wrong password → 401', async () => {
    const slug2 = `test-${Date.now()}-x`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        tenantSlug: slug2,
        email: 'a@b.com',
        password: 'password123',
        fullName: 'X',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: slug2, email: 'a@b.com', password: 'wrong-password' })
      .expect(401);

    const ok = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: slug2, email: 'a@b.com', password: 'password123' })
      .expect(200);
    expect(ok.body.tokens.accessToken).toBeTruthy();
  });

  it('register with duplicate slug → 409', async () => {
    const dup = `test-dup-${Date.now()}`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: dup, email: 'a@b.com', password: 'password123', fullName: 'X' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: dup, email: 'b@c.com', password: 'password123', fullName: 'Y' })
      .expect(409);
  });

  it('validation: short password → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: 'test-bad', email: 'a@b.com', password: '123', fullName: 'X' })
      .expect(400);
  });
});
