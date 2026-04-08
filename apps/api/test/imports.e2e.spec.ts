import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * E2E for the GestCom importer:
 *  - upload CSV → 201 with PENDING ImportJob
 *  - poll until COMPLETED
 *  - rows materialised in target table
 *  - duplicate row was skipped, not failed
 *  - tenant isolation: tenant B cannot see tenant A's import job
 */
describe('Importer (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slugA = `imp-a-${Date.now()}`;
  const slugB = `imp-b-${Date.now()}`;
  let tokenA = '';
  let tokenB = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const a = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: slugA, email: 'a@a.com', password: 'password123', fullName: 'A' })
      .expect(201);
    tokenA = a.body.tokens.accessToken;

    const b = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: slugB, email: 'b@b.com', password: 'password123', fullName: 'B' })
      .expect(201);
    tokenB = b.body.tokens.accessToken;
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  // Poll the job until it's no longer PENDING/RUNNING. Safer than fixed sleeps.
  async function waitForJob(token: string, jobId: string, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/imports/${jobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      if (res.body.status === 'COMPLETED' || res.body.status === 'FAILED') {
        return res.body;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Import job ${jobId} did not finish within ${timeoutMs}ms`);
  }

  it('uploads a CLIENTS CSV and processes it', async () => {
    const file = join(__dirname, 'fixtures', 'gestcom-clients.csv');
    const create = await request(app.getHttpServer())
      .post('/api/v1/imports?type=CLIENTS')
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', file)
      .expect(201);

    expect(create.body.id).toBeTruthy();
    expect(create.body.status).toBe('PENDING');

    const final = await waitForJob(tokenA, create.body.id);
    expect(final.status).toBe('COMPLETED');
    expect(final.totalRows).toBe(6);
    expect(final.succeeded).toBe(5);
    expect(final.skipped).toBe(1); // Popescu Ion duplicate
    expect(final.failed).toBe(0);

    // Confirm rows actually exist
    const list = await request(app.getHttpServer())
      .get('/api/v1/clients')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(5);
    expect(list.body.data.find((c: { lastName: string }) => c.lastName === 'Popescu')).toBeTruthy();
  });

  it('uploads a COMPANIES CSV and dedups by CUI', async () => {
    const file = join(__dirname, 'fixtures', 'gestcom-companies.csv');
    const create = await request(app.getHttpServer())
      .post('/api/v1/imports?type=COMPANIES')
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', file)
      .expect(201);

    const final = await waitForJob(tokenA, create.body.id);
    expect(final.status).toBe('COMPLETED');
    expect(final.totalRows).toBe(5);
    expect(final.succeeded).toBe(4);
    expect(final.skipped).toBe(1); // Acme duplicate
  });

  it('rejects unknown type', async () => {
    const file = join(__dirname, 'fixtures', 'gestcom-clients.csv');
    await request(app.getHttpServer())
      .post('/api/v1/imports?type=NOPE')
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', file)
      .expect(400);
  });

  it('requires file', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/imports?type=CLIENTS')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(400);
  });

  it('tenant B cannot see tenant A jobs', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/imports')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(list).toBeDefined();
    expect(list.body).toHaveLength(0);
  });

  it('AGENT role cannot upload (needs MANAGER+)', async () => {
    // Demote A to AGENT, fetch a fresh token, retry upload.
    await prisma.user.updateMany({
      where: { tenant: { slug: slugA }, email: 'a@a.com' },
      data: { role: 'AGENT' },
    });
    const fresh = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: slugA, email: 'a@a.com', password: 'password123' })
      .expect(200);
    const agentToken = fresh.body.tokens.accessToken;

    // NOTE: NestJS guards run BEFORE interceptors, so the 403 fires before
    // FileInterceptor reads the multipart body. We deliberately omit the
    // file here — attaching one causes supertest EPIPE because the server
    // closes the socket mid-stream. The role check is what we're verifying.
    await request(app.getHttpServer())
      .post('/api/v1/imports?type=CLIENTS')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(403);
  });
});
