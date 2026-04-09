import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * S10 Pipelines e2e:
 *  - register → default pipeline is seeded with 5 stages
 *  - GET /pipelines returns them
 *  - GET /pipelines/:id returns one with stages
 *  - cross-tenant isolation: A cannot see B's pipelines
 */
describe('Pipelines (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slugA = `s10p-a-${Date.now()}`;
  const slugB = `s10p-b-${Date.now()}`;
  let tokenA = '';
  let tokenB = '';
  let pipelineIdA = '';
  let pipelineIdB = '';

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
  }, 30000);

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  it('register() seeds a default pipeline with 5 stages', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/pipelines')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    const p = res.body[0];
    expect(p.isDefault).toBe(true);
    expect(p.name).toBe('Vânzări');
    expect(p.stages).toHaveLength(5);

    const stageNames = p.stages.map((s: { name: string }) => s.name);
    expect(stageNames).toEqual(['Nou', 'Calificat', 'Negociere', 'Câștigat', 'Pierdut']);

    const stageTypes = p.stages.map((s: { type: string }) => s.type);
    expect(stageTypes).toEqual(['OPEN', 'OPEN', 'OPEN', 'WON', 'LOST']);

    // Stages are ordered by `order` asc.
    const orders = p.stages.map((s: { order: number }) => s.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));

    pipelineIdA = p.id;
  });

  it('GET /pipelines/:id returns a single pipeline with stages', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/pipelines/${pipelineIdA}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.id).toBe(pipelineIdA);
    expect(res.body.stages).toHaveLength(5);
  });

  it('cross-tenant: B cannot see A pipeline by id', async () => {
    // Grab B's own pipeline id first for the symmetry check.
    const bList = await request(app.getHttpServer())
      .get('/api/v1/pipelines')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(bList.body).toHaveLength(1);
    pipelineIdB = bList.body[0].id;
    expect(pipelineIdB).not.toBe(pipelineIdA);

    await request(app.getHttpServer())
      .get(`/api/v1/pipelines/${pipelineIdA}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });
});
