import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * S5 Notes + Timeline e2e:
 *  - create note on a company → note.added activity logged
 *  - list notes
 *  - update + delete a note
 *  - timeline merges company.created + note.added + company.updated entries
 *  - cross-tenant isolation
 *  - VIEWER can read timeline but NOT create notes
 */
describe('Notes + Timeline (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slugA = `s5-a-${Date.now()}`;
  const slugB = `s5-b-${Date.now()}`;
  let tokenA = '';
  let tokenB = '';
  let companyId = '';

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
      .send({ name: 'TimelineCo SRL' })
      .expect(201);
    companyId = c.body.id;
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  let noteId = '';

  it('creates a note on a company', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/COMPANY/${companyId}/notes`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ body: 'First contact today, decision-maker is the CTO.' })
      .expect(201);
    expect(res.body.body).toMatch(/First contact/);
    expect(res.body.subjectType).toBe('COMPANY');
    expect(res.body.subjectId).toBe(companyId);
    noteId = res.body.id;
  });

  it('lists notes for the company', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/company/${companyId}/notes`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(noteId);
  });

  it('updates a note', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/notes/${noteId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ body: 'Updated: meeting moved to Friday.' })
      .expect(200);
    expect(res.body.body).toMatch(/Friday/);
  });

  it('returns merged timeline (company.created + note.added + company.updated)', async () => {
    // Trigger a company.update so we can verify it shows up
    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${companyId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ industry: 'IT' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/COMPANY/${companyId}/timeline`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    const kinds = res.body.data.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain('note');
    expect(kinds).toContain('activity');

    const actions = res.body.data
      .filter((e: { kind: string; action?: string }) => e.kind === 'activity')
      .map((e: { action: string }) => e.action);
    expect(actions).toContain('company.created');
    expect(actions).toContain('company.updated');
    expect(actions).toContain('note.added');

    // Sorted desc by createdAt
    const ts = res.body.data.map((e: { createdAt: string }) => new Date(e.createdAt).getTime());
    for (let i = 1; i < ts.length; i++) expect(ts[i - 1]).toBeGreaterThanOrEqual(ts[i]);
  });

  it('cross-tenant: tenant B cannot see tenant A notes or timeline', async () => {
    // Notes list returns 404 because the subject doesn't exist in tenant B
    await request(app.getHttpServer())
      .get(`/api/v1/COMPANY/${companyId}/notes`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/COMPANY/${companyId}/timeline`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('rejects invalid subjectType', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/DEAL/${companyId}/notes`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(500); // Zod throws → caught by exception filter
  });

  it('VIEWER can read timeline but NOT create notes', async () => {
    // Demote A to VIEWER, fetch fresh token
    await prisma.user.updateMany({
      where: { tenant: { slug: slugA }, email: 'a@a.com' },
      data: { role: 'VIEWER' },
    });
    const fresh = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: slugA, email: 'a@a.com', password: 'password123' })
      .expect(200);
    const viewerToken = fresh.body.tokens.accessToken;

    // Read OK
    await request(app.getHttpServer())
      .get(`/api/v1/COMPANY/${companyId}/timeline`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    // Write 403
    await request(app.getHttpServer())
      .post(`/api/v1/COMPANY/${companyId}/notes`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ body: 'should fail' })
      .expect(403);
  });

  it('soft-deletes a note', async () => {
    // Restore role so we can delete
    await prisma.user.updateMany({
      where: { tenant: { slug: slugA }, email: 'a@a.com' },
      data: { role: 'OWNER' },
    });
    const fresh = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ tenantSlug: slugA, email: 'a@a.com', password: 'password123' })
      .expect(200);
    const ownerToken = fresh.body.tokens.accessToken;

    await request(app.getHttpServer())
      .delete(`/api/v1/notes/${noteId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    const after = await request(app.getHttpServer())
      .get(`/api/v1/COMPANY/${companyId}/notes`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(after.body.find((n: { id: string }) => n.id === noteId)).toBeUndefined();
  });
});
