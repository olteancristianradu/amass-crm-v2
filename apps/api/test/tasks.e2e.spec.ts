import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * S10 Tasks e2e:
 *  - create linked to a subject (COMPANY)
 *  - create linked to a deal
 *  - reject create with both dealId AND subject
 *  - reject create with neither
 *  - list filter by dealId / subjectId
 *  - /tasks/me → current user's OPEN tasks
 *  - complete → DONE, completedAt set; reopen → OPEN, completedAt null
 *  - cross-tenant isolation
 *  - VIEWER cannot create
 */
describe('Tasks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slugA = `s10t-a-${Date.now()}`;
  const slugB = `s10t-b-${Date.now()}`;
  let tokenA = '';
  let tokenB = '';
  let userIdA = '';
  let companyIdA = '';
  let dealIdA = '';
  let subjectTaskId = '';
  let dealTaskId = '';

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
    userIdA = a.body.user.id;

    const b = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: slugB, email: 'b@b.com', password: 'password123', fullName: 'B' })
      .expect(201);
    tokenB = b.body.tokens.accessToken;

    const co = await request(app.getHttpServer())
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'TaskCo SRL' })
      .expect(201);
    companyIdA = co.body.id;

    // Need a deal too.
    const pipelines = await request(app.getHttpServer())
      .get('/api/v1/pipelines')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const firstOpen = pipelines.body[0].stages.find(
      (s: { type: string; name: string }) => s.type === 'OPEN' && s.name === 'Nou',
    );
    const deal = await request(app.getHttpServer())
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        pipelineId: pipelines.body[0].id,
        stageId: firstOpen.id,
        title: 'Deal for tasks',
        companyId: companyIdA,
      })
      .expect(201);
    dealIdA = deal.body.id;
  }, 30000);

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  it('creates a task linked to a subject (COMPANY)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: 'Call back',
        subjectType: 'COMPANY',
        subjectId: companyIdA,
        priority: 'HIGH',
        assigneeId: userIdA,
        dueAt: new Date(Date.now() + 86400_000).toISOString(),
      })
      .expect(201);
    expect(res.body.status).toBe('OPEN');
    expect(res.body.priority).toBe('HIGH');
    expect(res.body.subjectType).toBe('COMPANY');
    expect(res.body.subjectId).toBe(companyIdA);
    expect(res.body.dealId).toBeNull();
    subjectTaskId = res.body.id;
  });

  it('creates a task linked to a deal', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: 'Send proposal',
        dealId: dealIdA,
        assigneeId: userIdA,
      })
      .expect(201);
    expect(res.body.dealId).toBe(dealIdA);
    expect(res.body.subjectType).toBeNull();
    dealTaskId = res.body.id;
  });

  it('rejects task with both dealId AND subject', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: 'invalid',
        dealId: dealIdA,
        subjectType: 'COMPANY',
        subjectId: companyIdA,
      })
      .expect(400);
  });

  it('rejects task with neither dealId nor subject', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'orphan' })
      .expect(400);
  });

  it('lists tasks filtered by dealId', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/tasks?dealId=${dealIdA}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.data.find((t: { id: string }) => t.id === dealTaskId)).toBeDefined();
    expect(res.body.data.find((t: { id: string }) => t.id === subjectTaskId)).toBeUndefined();
  });

  it('/tasks/me returns my OPEN tasks', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tasks/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.every((t: { status: string }) => t.status === 'OPEN')).toBe(true);
  });

  it('complete → DONE + completedAt, reopen → OPEN + null', async () => {
    const done = await request(app.getHttpServer())
      .post(`/api/v1/tasks/${subjectTaskId}/complete`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(done.body.status).toBe('DONE');
    expect(done.body.completedAt).not.toBeNull();

    // Idempotent — completing an already DONE task is a no-op.
    const doneAgain = await request(app.getHttpServer())
      .post(`/api/v1/tasks/${subjectTaskId}/complete`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(doneAgain.body.status).toBe('DONE');

    const reopened = await request(app.getHttpServer())
      .post(`/api/v1/tasks/${subjectTaskId}/reopen`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(reopened.body.status).toBe('OPEN');
    expect(reopened.body.completedAt).toBeNull();
  });

  it('cross-tenant: B cannot read A tasks', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/tasks/${subjectTaskId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('VIEWER cannot create a task', async () => {
    await prisma.user.updateMany({
      where: { tenant: { slug: slugA }, email: 'a@a.com' },
      data: { role: 'VIEWER' },
    });
    const fresh = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: slugA, email: 'a@a.com', password: 'password123' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${fresh.body.tokens.accessToken}`)
      .send({ title: 'viewer-fail', subjectType: 'COMPANY', subjectId: companyIdA })
      .expect(403);

    await prisma.user.updateMany({
      where: { tenant: { slug: slugA }, email: 'a@a.com' },
      data: { role: 'OWNER' },
    });
  });

  it('soft delete removes the task from the list', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/tasks/${dealTaskId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(204);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/tasks?dealId=${dealIdA}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.data.find((t: { id: string }) => t.id === dealTaskId)).toBeUndefined();
  });
});
