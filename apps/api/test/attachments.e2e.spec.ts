import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * S6 Attachments + MinIO e2e:
 *
 * Full two-step upload flow:
 *   1. presign  → uploadUrl
 *   2. PUT bytes directly to MinIO at uploadUrl (real HTTP, real bucket)
 *   3. complete → DB row + activity
 *
 * Plus: list, presigned download (and verify the bytes round-trip), soft-delete,
 * cross-tenant isolation, defense-in-depth on storageKey, RBAC.
 *
 * Requires MinIO running locally on :9000 (compose `minio` + `minio-init`).
 */
describe('Attachments + MinIO (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slugA = `s6-a-${Date.now()}`;
  const slugB = `s6-b-${Date.now()}`;
  let tokenA = '';
  let tokenB = '';
  let companyId = '';
  let companyIdB = '';

  const fileBytes = Buffer.from('hello amass — this is a test attachment payload\n');
  const fileName = 'note.txt';
  const mimeType = 'text/plain';

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

    const cA = await request(app.getHttpServer())
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'AttachCo SRL' })
      .expect(201);
    companyId = cA.body.id;

    const cB = await request(app.getHttpServer())
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'OtherCo SRL' })
      .expect(201);
    companyIdB = cB.body.id;
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
    await app.close();
  });

  let storageKey = '';
  let uploadUrl = '';
  let attachmentId = '';

  it('presigns a PUT URL scoped to the tenant', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/COMPANY/${companyId}/attachments/presign`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ fileName, mimeType, size: fileBytes.length })
      .expect(201);

    expect(res.body.storageKey).toBeDefined();
    expect(res.body.uploadUrl).toMatch(/^https?:\/\//);
    expect(res.body.expiresIn).toBe(15 * 60);
    // Tenant prefix is the first segment — defense in depth at the key layout level
    expect(res.body.storageKey.startsWith(`${slugA}`)).toBe(false); // it's tenantId, not slug
    expect(res.body.storageKey).toMatch(/\/COMPANY\//);
    expect(res.body.storageKey.endsWith('.txt')).toBe(true);

    storageKey = res.body.storageKey;
    uploadUrl = res.body.uploadUrl;
  });

  it('FE PUTs the bytes directly to MinIO via the presigned URL', async () => {
    const r = await fetch(uploadUrl, {
      method: 'PUT',
      body: fileBytes,
      headers: { 'Content-Type': mimeType },
    });
    expect(r.status).toBe(200);
  });

  it('completes the upload and registers the attachment row', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/COMPANY/${companyId}/attachments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ storageKey, fileName, mimeType, size: fileBytes.length })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.storageKey).toBe(storageKey);
    expect(res.body.fileName).toBe(fileName);
    expect(res.body.mimeType).toBe(mimeType);
    expect(res.body.size).toBe(fileBytes.length);
    expect(res.body.subjectType).toBe('COMPANY');
    expect(res.body.subjectId).toBe(companyId);
    attachmentId = res.body.id;
  });

  it('lists attachments for the company', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/COMPANY/${companyId}/attachments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(attachmentId);
  });

  it('returns a presigned download URL and the bytes round-trip', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/attachments/${attachmentId}/download`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.downloadUrl).toMatch(/^https?:\/\//);
    expect(res.body.fileName).toBe(fileName);
    expect(res.body.mimeType).toBe(mimeType);

    const fetched = await fetch(res.body.downloadUrl);
    expect(fetched.status).toBe(200);
    const buf = Buffer.from(await fetched.arrayBuffer());
    expect(buf.equals(fileBytes)).toBe(true);
  });

  it('records an attachment.added activity in the timeline', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/COMPANY/${companyId}/timeline`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const actions = res.body.data
      .filter((e: { kind: string; action?: string }) => e.kind === 'activity')
      .map((e: { action: string }) => e.action);
    expect(actions).toContain('attachment.added');
  });

  it('rejects complete() with a forged storageKey from another tenant', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/COMPANY/${companyIdB}/attachments/presign`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ fileName: 'leak.txt', mimeType, size: 10 })
      .expect(201);
    const otherTenantKey: string = res.body.storageKey;

    // Now A tries to register B's key as its own attachment.
    // The defense-in-depth check should reject it BEFORE it touches storage.
    const bad = await request(app.getHttpServer())
      .post(`/api/v1/COMPANY/${companyId}/attachments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ storageKey: otherTenantKey, fileName: 'leak.txt', mimeType, size: 10 })
      .expect(400);
    expect(bad.body.code).toBe('INVALID_STORAGE_KEY');
  });

  it('rejects complete() when the object is missing in storage', async () => {
    const presigned = await request(app.getHttpServer())
      .post(`/api/v1/COMPANY/${companyId}/attachments/presign`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ fileName: 'ghost.txt', mimeType, size: 10 })
      .expect(201);

    // Skip the PUT — pretend the FE crashed mid-upload.
    const res = await request(app.getHttpServer())
      .post(`/api/v1/COMPANY/${companyId}/attachments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ storageKey: presigned.body.storageKey, fileName: 'ghost.txt', mimeType, size: 10 })
      .expect(400);
    expect(res.body.code).toBe('UPLOAD_NOT_FOUND');
  });

  it('cross-tenant: tenant B cannot see, download, or delete tenant A attachment', async () => {
    // List → 404 (subject doesn't exist in B)
    await request(app.getHttpServer())
      .get(`/api/v1/COMPANY/${companyId}/attachments`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    // Download → 404 (attachment scoped to A)
    await request(app.getHttpServer())
      .get(`/api/v1/attachments/${attachmentId}/download`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    // Delete → 404
    await request(app.getHttpServer())
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('VIEWER can list/download but cannot presign or delete', async () => {
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
      .get(`/api/v1/COMPANY/${companyId}/attachments`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/attachments/${attachmentId}/download`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    // Write 403
    await request(app.getHttpServer())
      .post(`/api/v1/COMPANY/${companyId}/attachments/presign`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ fileName: 'x.txt', mimeType, size: 5 })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);
  });

  it('soft-deletes the attachment (and removes from MinIO best-effort)', async () => {
    // Restore role
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
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    const after = await request(app.getHttpServer())
      .get(`/api/v1/COMPANY/${companyId}/attachments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(after.body.find((a: { id: string }) => a.id === attachmentId)).toBeUndefined();
  });
});
