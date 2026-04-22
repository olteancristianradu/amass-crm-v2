import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * S11 Email e2e:
 *  - create SMTP account (password not returned in response)
 *  - list accounts
 *  - update account
 *  - send email (queued — processor runs async so we just verify QUEUED status)
 *  - list messages filtered by subject
 *  - get single message
 *  - cross-tenant: B cannot see A's accounts or messages
 *  - VIEWER cannot create accounts or send
 *  - soft delete account
 */
describe('Email (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slugA = `s11e-a-${Date.now()}`;
  const slugB = `s11e-b-${Date.now()}`;
  let tokenA = '';
  let tokenB = '';
  let companyIdA = '';
  let accountIdA = '';
  let messageId = '';

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

    const co = await request(app.getHttpServer())
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'EmailCo SRL' })
      .expect(201);
    companyIdA = co.body.id;
  }, 30000);

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  it('creates an email account (password not in response)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/email/accounts')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        label: 'Gmail test',
        smtpHost: 'smtp.gmail.com',
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: 'test@gmail.com',
        smtpPass: 'app-password-123',
        fromName: 'Test User',
        fromEmail: 'test@gmail.com',
        isDefault: true,
      })
      .expect(201);
    expect(res.body.label).toBe('Gmail test');
    expect(res.body.fromEmail).toBe('test@gmail.com');
    expect(res.body.isDefault).toBe(true);
    // Password must NOT be in the response
    expect(res.body.smtpPassEnc).toBeUndefined();
    expect(res.body.smtpPass).toBeUndefined();
    accountIdA = res.body.id;
  });

  it('lists the user\'s accounts', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/email/accounts')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(accountIdA);
    // No password in list either
    expect(res.body[0].smtpPassEnc).toBeUndefined();
  });

  it('updates account label', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/email/accounts/${accountIdA}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ label: 'Gmail pro' })
      .expect(200);
    expect(res.body.label).toBe('Gmail pro');
  });

  it('queues an email for sending (status=QUEUED)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/email/send')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        accountId: accountIdA,
        subjectType: 'COMPANY',
        subjectId: companyIdA,
        toAddresses: ['recipient@example.com'],
        subject: 'Test email',
        bodyHtml: '<p>Hello world</p>',
      })
      .expect(201);
    expect(res.body.status).toBe('QUEUED');
    expect(res.body.toAddresses).toContain('recipient@example.com');
    expect(res.body.subject).toBe('Test email');
    messageId = res.body.id;
  });

  it('rejects send with non-existent account', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/email/send')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        accountId: 'nonexistent',
        subjectType: 'COMPANY',
        subjectId: companyIdA,
        toAddresses: ['x@x.com'],
        subject: 'fail',
        bodyHtml: '<p>fail</p>',
      })
      .expect(404);
  });

  it('rejects send with non-existent subject', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/email/send')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        accountId: accountIdA,
        subjectType: 'COMPANY',
        subjectId: 'nonexistent',
        toAddresses: ['x@x.com'],
        subject: 'fail',
        bodyHtml: '<p>fail</p>',
      })
      .expect(404);
  });

  it('lists messages filtered by subject', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/email/messages?subjectType=COMPANY&subjectId=${companyIdA}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.find((m: { id: string }) => m.id === messageId)).toBeDefined();
  });

  it('gets a single message', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/email/messages/${messageId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.id).toBe(messageId);
    expect(res.body.bodyHtml).toBe('<p>Hello world</p>');
  });

  it('cross-tenant: B cannot see A\'s accounts', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/email/accounts')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(res.body.length).toBe(0);
  });

  it('cross-tenant: B cannot see A\'s messages', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/email/messages/${messageId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('VIEWER cannot create an account', async () => {
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
      .post('/api/v1/email/accounts')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        label: 'fail',
        smtpHost: 'smtp.fail.com',
        smtpPort: 587,
        smtpUser: 'fail@fail.com',
        smtpPass: 'fail',
        fromName: 'Fail',
        fromEmail: 'fail@fail.com',
      })
      .expect(403);

    // Restore role
    await prisma.user.updateMany({
      where: { tenant: { slug: slugA }, email: 'a@a.com' },
      data: { role: 'OWNER' },
    });
  });

  it('soft delete removes the account from the list', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/email/accounts/${accountIdA}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(204);
    const res = await request(app.getHttpServer())
      .get('/api/v1/email/accounts')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body.find((a: { id: string }) => a.id === accountIdA)).toBeUndefined();
  });
});
