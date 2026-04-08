import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * S7 Reminders + BullMQ delayed jobs e2e:
 *  - create on a company → PENDING + activity row
 *  - list for subject
 *  - /reminders/me returns my upcoming
 *  - cross-tenant 404
 *  - update remindAt → cancels old job + re-enqueues
 *  - dismiss → DISMISSED + idempotent
 *  - soft delete → CANCELLED + gone from list
 *  - processor fires a near-future reminder → status FIRED + activity row
 *  - VIEWER cannot create
 *
 * The processor fire test uses a ~700ms delay and then polls for up to
 * ~3s. BullMQ's delayed-job latency in dev is normally <100ms.
 */
describe('Reminders + BullMQ (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slugA = `s7-a-${Date.now()}`;
  const slugB = `s7-b-${Date.now()}`;
  let tokenA = '';
  let tokenB = '';
  let companyId = '';
  let companyIdB = '';

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

    const c = await request(app.getHttpServer())
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'ReminderCo SRL' })
      .expect(201);
    companyId = c.body.id;

    const cB = await request(app.getHttpServer())
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'OtherCo SRL' })
      .expect(201);
    companyIdB = cB.body.id;
  }, 30000);

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  let reminderId = '';

  it('creates a reminder on a company (PENDING)', async () => {
    const remindAt = new Date(Date.now() + 60_000).toISOString(); // 1min in future
    const res = await request(app.getHttpServer())
      .post(`/api/v1/COMPANY/${companyId}/reminders`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Call decision-maker', body: 'Follow up on quote', remindAt })
      .expect(201);
    expect(res.body.title).toBe('Call decision-maker');
    expect(res.body.status).toBe('PENDING');
    expect(res.body.subjectType).toBe('COMPANY');
    expect(res.body.subjectId).toBe(companyId);
    reminderId = res.body.id;
  });

  it('rejects remindAt in the past', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/COMPANY/${companyId}/reminders`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Late', remindAt: new Date(Date.now() - 1000).toISOString() })
      .expect(400);
  });

  it('lists reminders for the subject', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/COMPANY/${companyId}/reminders`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.find((r: { id: string }) => r.id === reminderId)).toBeDefined();
  });

  it('/reminders/me returns my upcoming', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/reminders/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.find((r: { id: string }) => r.id === reminderId)).toBeDefined();
    // Tenant B is empty
    const resB = await request(app.getHttpServer())
      .get('/api/v1/reminders/me')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(resB.body.data).toHaveLength(0);
  });

  it('cross-tenant: B cannot see A reminders', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/COMPANY/${companyId}/reminders`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('updates remindAt (cancels + re-enqueues)', async () => {
    const newAt = new Date(Date.now() + 90_000).toISOString();
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/reminders/${reminderId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ remindAt: newAt })
      .expect(200);
    expect(new Date(res.body.remindAt).getTime()).toBe(new Date(newAt).getTime());
    expect(res.body.status).toBe('PENDING');
  });

  it('dismisses a reminder (idempotent)', async () => {
    const first = await request(app.getHttpServer())
      .post(`/api/v1/reminders/${reminderId}/dismiss`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(first.body.status).toBe('DISMISSED');

    // Second call returns the same row, no error.
    const second = await request(app.getHttpServer())
      .post(`/api/v1/reminders/${reminderId}/dismiss`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(second.body.status).toBe('DISMISSED');
  });

  it('VIEWER cannot create a reminder', async () => {
    await prisma.user.updateMany({
      where: { tenant: { slug: slugA }, email: 'a@a.com' },
      data: { role: 'VIEWER' },
    });
    const fresh = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: slugA, email: 'a@a.com', password: 'password123' })
      .expect(200);
    const viewerToken = fresh.body.tokens.accessToken;
    await request(app.getHttpServer())
      .post(`/api/v1/COMPANY/${companyId}/reminders`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ title: 'should fail', remindAt: new Date(Date.now() + 60_000).toISOString() })
      .expect(403);

    // Restore OWNER role for the remaining tests.
    await prisma.user.updateMany({
      where: { tenant: { slug: slugA }, email: 'a@a.com' },
      data: { role: 'OWNER' },
    });
  });

  it('processor fires a near-future reminder → FIRED + activity row', async () => {
    // Re-login since we restored the role.
    const fresh = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: slugA, email: 'a@a.com', password: 'password123' })
      .expect(200);
    const tok = fresh.body.tokens.accessToken;

    const remindAt = new Date(Date.now() + 700).toISOString();
    const res = await request(app.getHttpServer())
      .post(`/api/v1/COMPANY/${companyId}/reminders`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ title: 'Fire-test', remindAt })
      .expect(201);
    const id = res.body.id;
    const tenantA = await prisma.tenant.findUnique({ where: { slug: slugA } });
    expect(tenantA).not.toBeNull();

    // Poll for FIRED for up to ~4s. Use prisma directly so we don't have
    // to round-trip through the API for every check.
    const deadline = Date.now() + 4000;
    let fired = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      const row = await prisma.runWithTenant(tenantA!.id, (tx) =>
        tx.reminder.findFirst({ where: { id, tenantId: tenantA!.id } }),
      );
      if (row?.status === 'FIRED') {
        fired = true;
        expect(row.firedAt).not.toBeNull();
        break;
      }
    }
    expect(fired).toBe(true);

    // Activity row should be written too.
    const acts = await prisma.runWithTenant(tenantA!.id, (tx) =>
      tx.activity.findMany({
        where: {
          tenantId: tenantA!.id,
          subjectType: 'COMPANY',
          subjectId: companyId,
          action: 'reminder.fired',
        },
      }),
    );
    expect(acts.length).toBeGreaterThanOrEqual(1);
  }, 15000);

  it('soft delete removes from list', async () => {
    // Make a fresh PENDING reminder, delete it, confirm it's gone.
    const res = await request(app.getHttpServer())
      .post(`/api/v1/COMPANY/${companyId}/reminders`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Will be deleted', remindAt: new Date(Date.now() + 60_000).toISOString() })
      .expect(201);
    const id = res.body.id;
    await request(app.getHttpServer())
      .delete(`/api/v1/reminders/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(204);
    const list = await request(app.getHttpServer())
      .get(`/api/v1/COMPANY/${companyId}/reminders`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(list.body.find((r: { id: string }) => r.id === id)).toBeUndefined();
  });

  // companyIdB is referenced for symmetry with the cross-tenant check;
  // this assertion guards against unused-var lint regressions.
  it('tenantB has its own (empty) reminders list for its own company', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/COMPANY/${companyIdB}/reminders`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(res.body).toHaveLength(0);
  });
});
