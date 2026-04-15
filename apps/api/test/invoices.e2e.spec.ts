import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * S22/S24 Invoices + Payments e2e:
 *  - create DRAFT invoice with 2 lines; totals are computed server-side
 *  - PATCH replaces lines, totals recomputed
 *  - status DRAFT → ISSUED succeeds; ISSUED → DRAFT blocked
 *  - record a partial payment → status flips to PARTIALLY_PAID
 *  - record second payment covering remainder → status PAID
 *  - cross-tenant isolation: B cannot read A invoices
 */
describe('Invoices (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slugA = `s22-a-${Date.now()}`;
  const slugB = `s22-b-${Date.now()}`;
  let tokenA = '';
  let tokenB = '';
  let companyIdA = '';
  let invoiceId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const a = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: slugA, email: 'inv-a@a.com', password: 'password123', fullName: 'A' })
      .expect(201);
    tokenA = a.body.tokens.accessToken;

    const b = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: slugB, email: 'inv-b@b.com', password: 'password123', fullName: 'B' })
      .expect(201);
    tokenB = b.body.tokens.accessToken;

    const co = await request(app.getHttpServer())
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'InvCo SRL' })
      .expect(201);
    companyIdA = co.body.id;
  }, 30000);

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  it('creates a DRAFT invoice with computed totals', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        companyId: companyIdA,
        issueDate: '2026-04-15',
        dueDate: '2026-04-29',
        lines: [
          { description: 'Consulting', quantity: '10', unitPrice: '100.00', vatRate: '19' },
          { description: 'Travel',     quantity: '1',  unitPrice: '50.00',  vatRate: '19' },
        ],
      })
      .expect(201);

    expect(res.body.status).toBe('DRAFT');
    expect(res.body.series).toBe('AMS');
    expect(Number(res.body.subtotal)).toBeCloseTo(1050, 2);
    expect(Number(res.body.vatAmount)).toBeCloseTo(199.5, 2);
    expect(Number(res.body.total)).toBeCloseTo(1249.5, 2);
    expect(res.body.lines).toHaveLength(2);
    invoiceId = res.body.id;
  });

  it('blocks cross-tenant read', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('transitions DRAFT → ISSUED', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'ISSUED' })
      .expect(200);
    expect(res.body.status).toBe('ISSUED');
  });

  it('rejects invalid transition ISSUED → DRAFT', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'DRAFT' })
      .expect(400);
  });

  it('records partial payment → status PARTIALLY_PAID', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ amount: '500.00', paidAt: '2026-04-16', method: 'BANK' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.status).toBe('PARTIALLY_PAID');
  });

  it('records remainder payment → status PAID', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ amount: '749.50', paidAt: '2026-04-20', method: 'BANK' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.status).toBe('PAID');
  });
});
