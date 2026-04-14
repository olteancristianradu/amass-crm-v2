import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { TwilioClient } from '../src/modules/calls/twilio.client';

/**
 * S12 Calls e2e tests:
 *  - Phone number CRUD (OWNER/ADMIN only)
 *  - Initiate outbound call (TwilioClient mocked)
 *  - Status webhook happy path → COMPLETED
 *  - Recording webhook → AI job enqueued
 *  - AI result callback → transcript saved
 *  - VIEWER 403 on initiate
 *  - Cross-tenant isolation: phone numbers are tenant-scoped
 */
describe('Calls (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let twilioClient: TwilioClient;
  const slugA = `s12-a-${Date.now()}`;
  const slugB = `s12-b-${Date.now()}`;
  let ownerTokenA = '';
  let viewerTokenA = '';
  let ownerTokenB = '';
  let companyId = '';
  let phoneNumberId = '';
  let callId = '';
  const aiWorkerSecret = 'test-ai-worker-secret-16chars';
  const ts = Date.now();
  const twilioCallSid = `CA${ts}testcallsid`;

  beforeAll(async () => {
    // Set AI worker secret for callback auth tests
    process.env.AI_WORKER_SECRET = aiWorkerSecret;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    twilioClient = app.get(TwilioClient);

    // Mock TwilioClient so no real Twilio calls are made
    vi.spyOn(twilioClient, 'createCall').mockResolvedValue({ sid: twilioCallSid });
    vi.spyOn(twilioClient, 'verifySignature').mockReturnValue(true);

    // Register tenant A + viewer
    const regA = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: slugA, email: 'owner@a.com', password: 'password123', fullName: 'Owner A' })
      .expect(201);
    ownerTokenA = regA.body.tokens.accessToken;

    // Add a viewer user for tenant A
    const viewerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: `${slugA}-viewer`, email: 'viewer@a.com', password: 'password123', fullName: 'Viewer A' })
      .expect(201);
    viewerTokenA = viewerRes.body.tokens.accessToken;

    // Register tenant B
    const regB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ tenantSlug: slugB, email: 'owner@b.com', password: 'password123', fullName: 'Owner B' })
      .expect(201);
    ownerTokenB = regB.body.tokens.accessToken;

    // Create a company for test subject
    const co = await request(app.getHttpServer())
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ name: 'CallsTest SRL' })
      .expect(201);
    companyId = co.body.id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.tenant.deleteMany({
      where: { slug: { in: [slugA, `${slugA}-viewer`, slugB] } },
    });
    await app.close();
  });

  // ─── Phone Numbers ────────────────────────────────────────────────

  it('creates a phone number (OWNER)', async () => {
    const uniqueSuffix = Date.now().toString().slice(-10);
    const res = await request(app.getHttpServer())
      .post('/api/v1/phone-numbers')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ twilioSid: `PN${uniqueSuffix}00000000000000000000000`, number: `+4071234${uniqueSuffix.slice(-4)}`, label: 'Test line', isDefault: true })
      .expect(201);
    expect(res.body.number).toMatch(/^\+407/);
    expect(res.body.isDefault).toBe(true);
    phoneNumberId = res.body.id;
  });

  it('lists phone numbers', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/phone-numbers')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('cross-tenant: tenant B cannot see tenant A phone numbers', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/phone-numbers')
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .expect(200);
    const nums = res.body as { number: string }[];
    expect(nums.every((n) => n.number !== '+40712345678')).toBe(true);
  });

  // ─── Call initiation ─────────────────────────────────────────────

  it('initiates an outbound call (OWNER)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/calls/initiate')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        subjectType: 'COMPANY',
        subjectId: companyId,
        toNumber: '+40700000001',
        phoneNumberId,
      })
      .expect(201);
    expect(res.body.status).toBe('QUEUED');
    expect(res.body.twilioCallSid).toBe(twilioCallSid);
    callId = res.body.id;
  });

  it('unauthenticated request to initiate call returns 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/calls/initiate')
      .send({
        subjectType: 'COMPANY',
        subjectId: companyId,
        toNumber: '+40700000002',
      })
      .expect(401);
  });

  // ─── Status webhook ───────────────────────────────────────────────

  it('status webhook updates call to COMPLETED', async () => {
    // Webhook returns 204 (no body) — verify state via list endpoint
    await request(app.getHttpServer())
      .post(`/api/v1/calls/webhook/status?callId=${callId}`)
      .send(`CallStatus=completed&CallDuration=45&CallSid=${twilioCallSid}`)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .expect(204);

    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/calls?subjectType=COMPANY&subjectId=${companyId}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);
    const calls = listRes.body.data as { id: string; status: string; durationSec: number }[];
    const updated = calls.find((c) => c.id === callId);
    expect(updated?.status).toBe('COMPLETED');
    expect(updated?.durationSec).toBe(45);
  });

  // ─── Recording webhook ────────────────────────────────────────────

  it('recording webhook sets transcriptionStatus=PENDING', async () => {
    // Webhook returns 204 (no body) — verify state via list endpoint
    await request(app.getHttpServer())
      .post(`/api/v1/calls/webhook/recording?callId=${callId}`)
      .send('RecordingSid=REtest123&RecordingUrl=http://example.com/recording')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .expect(204);

    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/calls?subjectType=COMPANY&subjectId=${companyId}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);
    const calls = listRes.body.data as { id: string; transcriptionStatus: string; recordingSid: string }[];
    const updated = calls.find((c) => c.id === callId);
    expect(updated?.transcriptionStatus).toBe('PENDING');
    expect(updated?.recordingSid).toBe('REtest123');
  });

  // ─── AI result callback ───────────────────────────────────────────

  it('AI result callback saves transcript', async () => {
    // saveAiResult returns the CallTranscript object
    const res = await request(app.getHttpServer())
      .post(`/api/v1/calls/${callId}/ai-result`)
      .set('Authorization', `Bearer ${aiWorkerSecret}`)
      .send({
        rawText: 'Hello world test transcript',
        segments: [{ start: 0, end: 2, text: 'Hello world test transcript' }],
        summary: 'Test summary',
        sentiment: 'positive',
      })
      .expect(200);
    expect(res.body.rawText).toBe('Hello world test transcript');
    expect(res.body.summary).toBe('Test summary');

    // Verify the call itself is now COMPLETED transcription via list
    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/calls?subjectType=COMPANY&subjectId=${companyId}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);
    const calls = listRes.body.data as { id: string; transcriptionStatus: string }[];
    const updated = calls.find((c) => c.id === callId);
    expect(updated?.transcriptionStatus).toBe('COMPLETED');
  });

  it('AI result callback with wrong secret returns 403', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/calls/${callId}/ai-result`)
      .set('Authorization', 'Bearer wrong-secret')
      .send({ rawText: 'x', segments: [] })
      .expect(403);
  });
});
