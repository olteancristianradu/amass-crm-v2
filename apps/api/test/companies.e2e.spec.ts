import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';

describe('Companies / Contacts / Clients (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slugA = `s3-a-${Date.now()}`;
  const slugB = `s3-b-${Date.now()}`;
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

  describe('Companies CRUD', () => {
    let companyId = '';

    it('create', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/companies')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Acme SRL', vatNumber: 'RO12345678', industry: 'IT', size: 'SMALL' })
        .expect(201);
      expect(res.body.name).toBe('Acme SRL');
      companyId = res.body.id;
    });

    it('list returns the created company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(companyId);
      expect(res.body.nextCursor).toBeNull();
    });

    it('list with q=acme finds it', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies?q=acme')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('get one', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.industry).toBe('IT');
    });

    it('update', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/companies/${companyId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ industry: 'Finance' })
        .expect(200);
      expect(res.body.industry).toBe('Finance');
    });

    it('isolation: tenant B cannot see tenant A company', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/companies')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(res.body.data).toHaveLength(0);

      await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });

    it('soft delete', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/companies/${companyId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);
      await request(app.getHttpServer())
        .get(`/api/v1/companies/${companyId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });
  });

  describe('Contacts CRUD', () => {
    let contactId = '';
    let companyId = '';

    it('create with valid companyId', async () => {
      const c = await request(app.getHttpServer())
        .post('/api/v1/companies')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Beta SRL' })
        .expect(201);
      companyId = c.body.id;

      const res = await request(app.getHttpServer())
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ companyId, firstName: 'Ion', lastName: 'Popescu', email: 'ion@beta.ro' })
        .expect(201);
      contactId = res.body.id;
      expect(res.body.companyId).toBe(companyId);
    });

    it('create with cross-tenant companyId fails', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ companyId, firstName: 'X', lastName: 'Y' })
        .expect(400);
    });

    it('isolation', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/contacts')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('soft delete', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/contacts/${contactId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);
    });
  });

  describe('Clients CRUD (B2C)', () => {
    let clientId = '';

    it('create', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ firstName: 'Maria', lastName: 'Ionescu', phone: '+40712345678' })
        .expect(201);
      clientId = res.body.id;
    });

    it('list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.data.find((c: { id: string }) => c.id === clientId)).toBeTruthy();
    });

    it('isolation', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('Validation', () => {
    it('invalid company body → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/companies')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: '' })
        .expect(400);
    });
  });
});
