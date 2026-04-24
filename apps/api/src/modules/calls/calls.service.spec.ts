import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CallsService } from './calls.service';

/**
 * CallsService is the biggest security-critical surface we have:
 *  - Twilio webhook signature verification on every inbound POST
 *  - Outbound phone-number resolution (per-user, per-tenant fallback)
 *  - Idempotent status/recording webhooks (Redis SETNX)
 *  - Cross-subject linking on inbound (contact/client/company)
 *  - AI worker callback that stores PII-adjacent transcripts
 *
 * Every public entry point is covered. Dependencies are stubbed at the
 * boundary: runWithTenant calls its callback with a tx stub whose methods
 * we spy on; direct `prisma.<model>` calls (outside tenant scope) are
 * mocked on the prisma stub directly.
 */

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build(opts: { signatureValid?: boolean } = {}) {
  const signatureValid = opts.signatureValid ?? true;
  const tx = {
    phoneNumber: { findFirst: vi.fn() },
    call: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    contact: { findFirst: vi.fn().mockResolvedValue(null) },
    client: { findFirst: vi.fn().mockResolvedValue(null) },
    company: { findFirst: vi.fn().mockResolvedValue(null) },
    callTranscript: { upsert: vi.fn() },
    activity: { create: vi.fn() },
  };
  // Bare PrismaService stub — not a real PrismaService, just carries the
  // fields CallsService touches directly (outside runWithTenant). We keep
  // references to the mocks separately so tests can drive them without
  // fighting Prisma's generated types.
  const prismaPhone = { findFirst: vi.fn() };
  const prismaCall = { findFirst: vi.fn() };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    phoneNumber: prismaPhone,
    call: prismaCall,
  } as unknown as ConstructorParameters<typeof CallsService>[0];
  const twilio = {
    createCall: vi.fn().mockResolvedValue({ sid: 'CA123' }),
    publicWebhookUrl: vi.fn((raw: string) => `https://example.com${raw}`),
    verifySignature: vi.fn(() => signatureValid),
  } as unknown as ConstructorParameters<typeof CallsService>[1];
  const activities = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof CallsService>[2];
  const subjects = {
    assertExists: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConstructorParameters<typeof CallsService>[3];
  const redisStore = new Map<string, string>();
  const redis = {
    client: {
      get: vi.fn(async (k: string) => redisStore.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => { redisStore.set(k, v); return 'OK'; }),
    },
  } as unknown as ConstructorParameters<typeof CallsService>[4];
  const aiQueue = {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
  } as unknown as ConstructorParameters<typeof CallsService>[5];
  const svc = new CallsService(prisma, twilio, activities, subjects, redis, aiQueue);
  return { svc, prisma, prismaPhone, prismaCall, tx, twilio, activities, subjects, redis, redisStore, aiQueue };
}

// ─────────────────────────────────────────────────────────────────────────
// initiateCall
// ─────────────────────────────────────────────────────────────────────────

describe('CallsService.initiateCall', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws AUTH_REQUIRED when tenant context has no userId', async () => {
    const h = build();
    const { requireTenantContext } = await import('../../infra/prisma/tenant-context');
    vi.mocked(requireTenantContext).mockReturnValueOnce({ tenantId: 'tenant-1' } as never);
    await expect(
      h.svc.initiateCall({ subjectType: 'CONTACT', subjectId: 'c-1', toNumber: '+40700' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws PHONE_NUMBER_NOT_FOUND when an explicit phoneNumberId is bogus', async () => {
    const h = build();
    h.tx.phoneNumber.findFirst.mockResolvedValue(null);
    await expect(
      h.svc.initiateCall({
        subjectType: 'CONTACT', subjectId: 'c-1', toNumber: '+40700', phoneNumberId: 'pn-bogus',
      } as never),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NO_PHONE_NUMBER when the tenant has no default number', async () => {
    const h = build();
    h.tx.phoneNumber.findFirst.mockResolvedValue(null);
    await expect(
      h.svc.initiateCall({ subjectType: 'CONTACT', subjectId: 'c-1', toNumber: '+40700' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates a QUEUED Call row, dials via Twilio, stores SID, logs activity', async () => {
    const h = build();
    h.tx.phoneNumber.findFirst.mockResolvedValue({ id: 'pn-1', number: '+40800', tenantId: 'tenant-1' });
    h.tx.call.create.mockResolvedValue({ id: 'call-1', tenantId: 'tenant-1' });
    h.tx.call.update.mockResolvedValue({ id: 'call-1', twilioCallSid: 'CA123' });
    const out = await h.svc.initiateCall({
      subjectType: 'CONTACT', subjectId: 'c-1', toNumber: '+40700',
    } as never);
    expect(h.tx.call.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'QUEUED', direction: 'OUTBOUND', fromNumber: '+40800' }),
      }),
    );
    expect(h.twilio.createCall).toHaveBeenCalledWith(
      expect.objectContaining({ from: '+40800', to: '+40700', callId: 'call-1' }),
    );
    expect(out.twilioCallSid).toBe('CA123');
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'call.initiated' }),
    );
  });

  it('marks FAILED + endedAt and rethrows when Twilio dial fails', async () => {
    const h = build();
    h.tx.phoneNumber.findFirst.mockResolvedValue({ id: 'pn-1', number: '+40800', tenantId: 'tenant-1' });
    h.tx.call.create.mockResolvedValue({ id: 'call-1', tenantId: 'tenant-1' });
    vi.mocked(h.twilio.createCall).mockRejectedValue(new Error('twilio boom'));
    await expect(
      h.svc.initiateCall({ subjectType: 'CONTACT', subjectId: 'c-1', toNumber: '+40700' } as never),
    ).rejects.toThrow('twilio boom');
    const failingCall = h.tx.call.update.mock.calls.find(
      (c) => (c[0] as { data: { status?: string } }).data.status === 'FAILED',
    );
    expect(failingCall).toBeDefined();
    expect(h.activities.log).not.toHaveBeenCalled();
  });

  it('prefers user-specific default number over tenant-level', async () => {
    const h = build();
    h.tx.phoneNumber.findFirst.mockResolvedValue({ id: 'pn-user', number: '+40900', tenantId: 'tenant-1' });
    h.tx.call.create.mockResolvedValue({ id: 'call-1', tenantId: 'tenant-1' });
    h.tx.call.update.mockResolvedValue({ id: 'call-1' });
    await h.svc.initiateCall({ subjectType: 'CONTACT', subjectId: 'c-1', toNumber: '+40700' } as never);
    const firstCall = h.tx.phoneNumber.findFirst.mock.calls[0]![0] as { orderBy: { userId: string } };
    // orderBy userId desc means user-specific rows win ties
    expect(firstCall.orderBy.userId).toBe('desc');
  });

  it('uses the explicit phoneNumberId path when supplied and valid', async () => {
    const h = build();
    h.tx.phoneNumber.findFirst.mockResolvedValue({
      id: 'pn-explicit', number: '+40100', tenantId: 'tenant-1',
    });
    h.tx.call.create.mockResolvedValue({ id: 'call-1', tenantId: 'tenant-1' });
    h.tx.call.update.mockResolvedValue({ id: 'call-1' });
    await h.svc.initiateCall({
      subjectType: 'CONTACT', subjectId: 'c-1', toNumber: '+40700', phoneNumberId: 'pn-explicit',
    } as never);
    // Create must use the looked-up pn.number, not a default-search result
    expect(h.tx.call.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fromNumber: '+40100' }) }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// handleVoiceWebhook
// ─────────────────────────────────────────────────────────────────────────

describe('CallsService.handleVoiceWebhook', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws Forbidden on invalid Twilio signature', async () => {
    const h = build({ signatureValid: false });
    await expect(
      h.svc.handleVoiceWebhook({ CallSid: 'CA1' }, 'bad', '/webhook'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('is idempotent — repeated CallSid returns empty TwiML without re-processing', async () => {
    const h = build();
    // Pre-populate redis to simulate a prior delivery
    h.redisStore.set('twilio:processed:CA99:voice', '1');
    const out = await h.svc.handleVoiceWebhook(
      { CallSid: 'CA99', Direction: 'inbound', From: '+40700', To: '+40800' },
      'sig',
      '/webhook',
    );
    expect(out).toContain('<Response></Response>');
    expect(h.prismaPhone.findFirst).not.toHaveBeenCalled();
  });

  it('inbound: creates a Call row linked to the matching contact', async () => {
    const h = build();
    h.prismaPhone.findFirst.mockResolvedValue({ id: 'pn-1', tenantId: 'tenant-1' } as never);
    vi.mocked(h.tx.contact.findFirst).mockResolvedValue({ id: 'contact-1' });
    const out = await h.svc.handleVoiceWebhook(
      { CallSid: 'CA1', Direction: 'inbound', From: '+40700', To: '+40800' },
      'sig',
      '/webhook',
    );
    expect(out).toContain('Say');
    expect(h.tx.call.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: 'INBOUND',
          subjectType: 'CONTACT',
          subjectId: 'contact-1',
          fromNumber: '+40700',
        }),
      }),
    );
  });

  it("inbound + unknown caller: subject defaults to CONTACT:'unknown' (never drops the call)", async () => {
    const h = build();
    h.prismaPhone.findFirst.mockResolvedValue({ id: 'pn-1', tenantId: 'tenant-1' } as never);
    // All three subject lookups return null
    await h.svc.handleVoiceWebhook(
      { CallSid: 'CA2', Direction: 'inbound', From: '+40777', To: '+40800' },
      'sig',
      '/webhook',
    );
    expect(h.tx.call.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subjectId: 'unknown' }) }),
    );
  });

  it('inbound + client (but no contact) match: subject = CLIENT', async () => {
    const h = build();
    h.prismaPhone.findFirst.mockResolvedValue({ id: 'pn-1', tenantId: 'tenant-1' } as never);
    vi.mocked(h.tx.client.findFirst).mockResolvedValue({ id: 'client-1' });
    await h.svc.handleVoiceWebhook(
      { CallSid: 'CA-client', Direction: 'inbound', From: '+40700', To: '+40800' },
      'sig',
      '/webhook',
    );
    expect(h.tx.call.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subjectType: 'CLIENT', subjectId: 'client-1' }),
      }),
    );
  });

  it('inbound + company-only match: subject = COMPANY', async () => {
    const h = build();
    h.prismaPhone.findFirst.mockResolvedValue({ id: 'pn-1', tenantId: 'tenant-1' } as never);
    vi.mocked(h.tx.company.findFirst).mockResolvedValue({ id: 'company-1' });
    await h.svc.handleVoiceWebhook(
      { CallSid: 'CA-company', Direction: 'inbound', From: '+40700', To: '+40800' },
      'sig',
      '/webhook',
    );
    expect(h.tx.call.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subjectType: 'COMPANY', subjectId: 'company-1' }),
      }),
    );
  });

  it('inbound to unrecognised tenant number: logs warning, no Call row', async () => {
    const h = build();
    h.prismaPhone.findFirst.mockResolvedValue(null);
    const out = await h.svc.handleVoiceWebhook(
      { CallSid: 'CA3', Direction: 'inbound', From: '+40700', To: '+999' },
      'sig',
      '/webhook',
    );
    expect(out).toContain('Say');
    expect(h.tx.call.create).not.toHaveBeenCalled();
  });

  it('outbound-api direction: returns empty TwiML without DB writes', async () => {
    const h = build();
    const out = await h.svc.handleVoiceWebhook(
      { CallSid: 'CA-out', Direction: 'outbound-api' },
      'sig',
      '/webhook',
    );
    expect(out).toContain('<Response></Response>');
    expect(h.tx.call.create).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// handleStatusWebhook
// ─────────────────────────────────────────────────────────────────────────

describe('CallsService.handleStatusWebhook', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects invalid signatures', async () => {
    const h = build({ signatureValid: false });
    await expect(
      h.svc.handleStatusWebhook({ CallStatus: 'completed', CallSid: 'CA1' }, 'bad', '/w', 'call-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('ignores unknown Twilio status silently', async () => {
    const h = build();
    await h.svc.handleStatusWebhook({ CallStatus: 'hyperspace', CallSid: 'CA1' }, 'sig', '/w', 'call-1');
    expect(h.prismaCall.findFirst).not.toHaveBeenCalled();
  });

  it('deduplicates repeat deliveries of same (SID, status) via Redis', async () => {
    const h = build();
    h.redisStore.set('twilio:processed:CA1:status:completed', '1');
    await h.svc.handleStatusWebhook({ CallStatus: 'completed', CallSid: 'CA1' }, 'sig', '/w', 'call-1');
    expect(h.prismaCall.findFirst).not.toHaveBeenCalled();
  });

  it('skips when callId path param is empty', async () => {
    const h = build();
    await h.svc.handleStatusWebhook({ CallStatus: 'completed', CallSid: 'CA1' }, 'sig', '/w', '');
    expect(h.prismaCall.findFirst).not.toHaveBeenCalled();
  });

  it('skips when the callId has no matching Call row', async () => {
    const h = build();
    h.prismaCall.findFirst.mockResolvedValue(null);
    await h.svc.handleStatusWebhook(
      { CallStatus: 'completed', CallSid: 'CA1', CallDuration: '42' }, 'sig', '/w', 'ghost',
    );
    expect(h.tx.call.update).not.toHaveBeenCalled();
  });

  it('on COMPLETED: sets endedAt + durationSec, logs call.completed activity', async () => {
    const h = build();
    h.prismaCall.findFirst.mockResolvedValue({
      id: 'call-1', tenantId: 'tenant-1', subjectType: 'CONTACT', subjectId: 'c-1',
      direction: 'OUTBOUND', startedAt: new Date(), answeredAt: null, endedAt: null, twilioCallSid: null,
    } as never);
    await h.svc.handleStatusWebhook(
      { CallStatus: 'completed', CallSid: 'CA1', CallDuration: '42' }, 'sig', '/w', 'call-1',
    );
    const update = h.tx.call.update.mock.calls[0]![0] as { data: { status: string; endedAt: Date; durationSec: number } };
    expect(update.data.status).toBe('COMPLETED');
    expect(update.data.durationSec).toBe(42);
    expect(update.data.endedAt).toBeInstanceOf(Date);
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'call.completed' }),
    );
  });

  it('on first IN_PROGRESS: sets answeredAt but not endedAt', async () => {
    const h = build();
    h.prismaCall.findFirst.mockResolvedValue({
      id: 'call-1', tenantId: 'tenant-1', subjectType: 'CONTACT', subjectId: 'c-1',
      direction: 'OUTBOUND', startedAt: new Date(), answeredAt: null, endedAt: null, twilioCallSid: null,
    } as never);
    await h.svc.handleStatusWebhook(
      { CallStatus: 'in-progress', CallSid: 'CA1' }, 'sig', '/w', 'call-1',
    );
    const update = h.tx.call.update.mock.calls[0]![0] as { data: { status: string; answeredAt?: Date; endedAt?: Date } };
    expect(update.data.status).toBe('IN_PROGRESS');
    expect(update.data.answeredAt).toBeInstanceOf(Date);
    expect(update.data.endedAt).toBeUndefined();
    expect(h.activities.log).not.toHaveBeenCalled();
  });

  it('backfills twilioCallSid only when the row had none before', async () => {
    const h = build();
    h.prismaCall.findFirst.mockResolvedValue({
      id: 'call-1', tenantId: 'tenant-1', subjectType: 'CONTACT', subjectId: 'c-1',
      direction: 'OUTBOUND', startedAt: new Date(), answeredAt: null, endedAt: null,
      twilioCallSid: 'CA-preexisting',
    } as never);
    await h.svc.handleStatusWebhook(
      { CallStatus: 'ringing', CallSid: 'CA-new' }, 'sig', '/w', 'call-1',
    );
    const update = h.tx.call.update.mock.calls[0]![0] as { data: { twilioCallSid?: string } };
    expect(update.data.twilioCallSid).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// handleRecordingWebhook
// ─────────────────────────────────────────────────────────────────────────

describe('CallsService.handleRecordingWebhook', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects invalid signatures', async () => {
    const h = build({ signatureValid: false });
    await expect(
      h.svc.handleRecordingWebhook({}, 'bad', '/w', 'call-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('skips when any required field is missing', async () => {
    const h = build();
    await h.svc.handleRecordingWebhook(
      { RecordingSid: '', RecordingUrl: '' }, 'sig', '/w', 'call-1',
    );
    expect(h.prismaCall.findFirst).not.toHaveBeenCalled();
    expect(h.aiQueue.add).not.toHaveBeenCalled();
  });

  it('skips when call row is gone', async () => {
    const h = build();
    h.prismaCall.findFirst.mockResolvedValue(null);
    await h.svc.handleRecordingWebhook(
      { RecordingSid: 'RE1', RecordingUrl: 'https://rec/1' }, 'sig', '/w', 'call-gone',
    );
    expect(h.aiQueue.add).not.toHaveBeenCalled();
  });

  it('updates Call + enqueues AI job with jobId=callId for idempotency', async () => {
    const h = build();
    h.prismaCall.findFirst.mockResolvedValue({
      id: 'call-1', tenantId: 'tenant-1',
    } as never);
    await h.svc.handleRecordingWebhook(
      { RecordingSid: 'RE1', RecordingUrl: 'https://rec/1' }, 'sig', '/w', 'call-1',
    );
    expect(h.tx.call.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordingSid: 'RE1',
          recordingUrl: 'https://rec/1',
          transcriptionStatus: 'PENDING',
        }),
      }),
    );
    expect(h.aiQueue.add).toHaveBeenCalledWith(
      'process',
      expect.objectContaining({ callId: 'call-1', tenantId: 'tenant-1', recordingSid: 'RE1' }),
      expect.objectContaining({ jobId: 'call-1' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// saveAiResult
// ─────────────────────────────────────────────────────────────────────────

describe('CallsService.saveAiResult', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws CALL_NOT_FOUND when called with an unknown callId', async () => {
    const h = build();
    h.prismaCall.findFirst.mockResolvedValue(null);
    await expect(
      h.svc.saveAiResult('ghost', { rawText: 'hi', segments: [] } as never),
    ).rejects.toThrow(NotFoundException);
  });

  it('upserts the transcript and marks the call COMPLETED transcription', async () => {
    const h = build();
    h.prismaCall.findFirst.mockResolvedValue({
      id: 'call-1', tenantId: 'tenant-1', subjectType: 'CONTACT', subjectId: 'c-1',
    } as never);
    h.tx.callTranscript.upsert.mockResolvedValue({ id: 't-1', callId: 'call-1' });
    h.tx.call.update.mockResolvedValue({ id: 'call-1' });
    h.tx.activity.create.mockResolvedValue({ id: 'a-1' });
    const out = await h.svc.saveAiResult('call-1', {
      rawText: 'hello', segments: [], summary: 's', model: 'claude',
    } as never);
    expect(out.id).toBe('t-1');
    expect(h.tx.callTranscript.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { callId: 'call-1' } }),
    );
    const callUpd = h.tx.call.update.mock.calls.find(
      (c) => (c[0] as { data: { transcriptionStatus?: string } }).data.transcriptionStatus === 'COMPLETED',
    );
    expect(callUpd).toBeDefined();
  });

  it('swallows activity errors (best-effort) — AI result still saved', async () => {
    const h = build();
    h.prismaCall.findFirst.mockResolvedValue({
      id: 'call-1', tenantId: 'tenant-1', subjectType: 'CONTACT', subjectId: 'c-1',
    } as never);
    h.tx.callTranscript.upsert.mockResolvedValue({ id: 't-1' });
    h.tx.call.update.mockResolvedValue({ id: 'call-1' });
    h.tx.activity.create.mockRejectedValue(new Error('activity log busted'));
    await expect(
      h.svc.saveAiResult('call-1', { rawText: 'hi', segments: [] } as never),
    ).resolves.toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// list + findOne
// ─────────────────────────────────────────────────────────────────────────

describe('CallsService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty page for zero matches', async () => {
    const h = build();
    h.tx.call.findMany.mockResolvedValue([]);
    const out = await h.svc.list({ limit: 20 } as never);
    expect(out.data).toEqual([]);
  });

  it('applies all filter keys to the where clause', async () => {
    const h = build();
    h.tx.call.findMany.mockResolvedValue([]);
    await h.svc.list({
      limit: 20,
      subjectType: 'CONTACT',
      subjectId: 'c-1',
      userId: 'u-1',
      status: 'COMPLETED',
      direction: 'OUTBOUND',
    } as never);
    const arg = h.tx.call.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(arg.where).toMatchObject({
      tenantId: 'tenant-1',
      subjectType: 'CONTACT',
      subjectId: 'c-1',
      userId: 'u-1',
      status: 'COMPLETED',
      direction: 'OUTBOUND',
    });
  });

  it('applies cursor pagination with skip=1', async () => {
    const h = build();
    h.tx.call.findMany.mockResolvedValue([]);
    await h.svc.list({ limit: 20, cursor: 'c-prev' } as never);
    const arg = h.tx.call.findMany.mock.calls[0]![0] as { cursor: unknown; skip: number };
    expect(arg.cursor).toEqual({ id: 'c-prev' });
    expect(arg.skip).toBe(1);
  });
});

describe('CallsService.findOne', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the call with its transcript', async () => {
    const h = build();
    h.tx.call.findFirst.mockResolvedValue({ id: 'call-1', transcript: { id: 't-1' } });
    const out = await h.svc.findOne('call-1');
    expect(out.id).toBe('call-1');
  });

  it('throws NotFound for missing call', async () => {
    const h = build();
    h.tx.call.findFirst.mockResolvedValue(null);
    await expect(h.svc.findOne('ghost')).rejects.toThrow(NotFoundException);
  });
});
