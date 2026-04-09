import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';

interface StageRow {
  id: string;
  name: string;
  type: 'OPEN' | 'WON' | 'LOST';
  order: number;
}

/**
 * S10 Deals e2e:
 *  - create on the default pipeline's first OPEN stage
 *  - list with filters (pipelineId / stageId / status)
 *  - move between OPEN stages → status stays OPEN, orderInStage reassigned
 *  - move to WON → status=WON, closedAt set
 *  - move to LOST w/o lostReason → 400 LOST_REASON_REQUIRED
 *  - move to LOST w/ lostReason → status=LOST, lostReason stored
 *  - cross-tenant: B cannot read A deals, B cannot move A deals
 *  - VIEWER cannot create
 *  - activity log entries on company for deal.created + deal.won
 */
describe('Deals (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slugA = `s10d-a-${Date.now()}`;
  const slugB = `s10d-b-${Date.now()}`;
  let tokenA = '';
  let tokenB = '';
  let pipelineIdA = '';
  let stagesA: StageRow[] = [];
  let companyIdA = '';
  let dealId = '';

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

    const pipelines = await request(app.getHttpServer())
      .get('/api/v1/pipelines')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    pipelineIdA = pipelines.body[0].id;
    stagesA = pipelines.body[0].stages;

    const co = await request(app.getHttpServer())
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'DealCo SRL' })
      .expect(201);
    companyIdA = co.body.id;
  }, 30000);

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  it('creates a deal on the first OPEN stage', async () => {
    const firstOpen = stagesA.find((s) => s.type === 'OPEN' && s.name === 'Nou')!;
    const res = await request(app.getHttpServer())
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        pipelineId: pipelineIdA,
        stageId: firstOpen.id,
        title: 'Amass for Acme',
        description: 'Enterprise pilot',
        value: '12500.50',
        currency: 'EUR',
        companyId: companyIdA,
        probability: 40,
      })
      .expect(201);
    expect(res.body.status).toBe('OPEN');
    expect(res.body.stageId).toBe(firstOpen.id);
    expect(res.body.title).toBe('Amass for Acme');
    expect(res.body.currency).toBe('EUR');
    // Decimal is serialised as a string by default in Prisma JSON.
    expect(res.body.value).toBe('12500.5');
    expect(res.body.orderInStage).toBeGreaterThan(0);
    expect(res.body.closedAt).toBeNull();
    dealId = res.body.id;
  });

  it('rejects a deal with an unknown stage', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        pipelineId: pipelineIdA,
        stageId: 'stage_does_not_exist',
        title: 'ghost',
      })
      .expect(404);
  });

  it('lists deals filtered by pipeline + status', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/deals?pipelineId=${pipelineIdA}&status=OPEN`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.find((d: { id: string }) => d.id === dealId)).toBeDefined();
  });

  it('moves between OPEN stages (Nou → Calificat) without changing status', async () => {
    const qualified = stagesA.find((s) => s.name === 'Calificat')!;
    const res = await request(app.getHttpServer())
      .post(`/api/v1/deals/${dealId}/move`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ stageId: qualified.id })
      .expect(200);
    expect(res.body.stageId).toBe(qualified.id);
    expect(res.body.status).toBe('OPEN');
    expect(res.body.closedAt).toBeNull();
  });

  it('rejects move to LOST without a lostReason', async () => {
    const lost = stagesA.find((s) => s.type === 'LOST')!;
    await request(app.getHttpServer())
      .post(`/api/v1/deals/${dealId}/move`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ stageId: lost.id })
      .expect(400);
  });

  it('moves to WON → status=WON, closedAt set', async () => {
    const won = stagesA.find((s) => s.type === 'WON')!;
    const res = await request(app.getHttpServer())
      .post(`/api/v1/deals/${dealId}/move`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ stageId: won.id })
      .expect(200);
    expect(res.body.status).toBe('WON');
    expect(res.body.stageId).toBe(won.id);
    expect(res.body.closedAt).not.toBeNull();
  });

  it('writes a deal.won activity row on the linked company', async () => {
    const tenantA = await prisma.tenant.findUnique({ where: { slug: slugA } });
    const acts = await prisma.runWithTenant(tenantA!.id, (tx) =>
      tx.activity.findMany({
        where: {
          tenantId: tenantA!.id,
          subjectType: 'COMPANY',
          subjectId: companyIdA,
          action: 'deal.won',
        },
      }),
    );
    expect(acts.length).toBeGreaterThanOrEqual(1);
  });

  it('moves to LOST with lostReason stores the reason', async () => {
    const lost = stagesA.find((s) => s.type === 'LOST')!;
    const res = await request(app.getHttpServer())
      .post(`/api/v1/deals/${dealId}/move`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ stageId: lost.id, lostReason: 'Budget freeze' })
      .expect(200);
    expect(res.body.status).toBe('LOST');
    expect(res.body.lostReason).toBe('Budget freeze');
  });

  it('cross-tenant: B cannot read A deal by id', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/deals/${dealId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('cross-tenant: B cannot move A deal', async () => {
    const newStage = stagesA.find((s) => s.name === 'Nou')!;
    await request(app.getHttpServer())
      .post(`/api/v1/deals/${dealId}/move`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ stageId: newStage.id })
      .expect(404);
  });

  it('VIEWER cannot create a deal', async () => {
    await prisma.user.updateMany({
      where: { tenant: { slug: slugA }, email: 'a@a.com' },
      data: { role: 'VIEWER' },
    });
    const fresh = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: slugA, email: 'a@a.com', password: 'password123' })
      .expect(200);
    const viewerToken = fresh.body.tokens.accessToken;
    const firstOpen = stagesA.find((s) => s.name === 'Nou')!;
    await request(app.getHttpServer())
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ pipelineId: pipelineIdA, stageId: firstOpen.id, title: 'viewer-fail' })
      .expect(403);

    await prisma.user.updateMany({
      where: { tenant: { slug: slugA }, email: 'a@a.com' },
      data: { role: 'OWNER' },
    });
  });

  it('soft delete removes the deal from the list', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/deals/${dealId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(204);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/deals?pipelineId=${pipelineIdA}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.data.find((d: { id: string }) => d.id === dealId)).toBeUndefined();
  });
});
