import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { _resetEnvCacheForTests } from '../../config/env';
import { EnvelopeService } from '../../common/crypto/envelope.service';
import { UrlValidatorService } from '../../common/ssrf/url-validator.service';
import { WEBHOOK_DELIVERY_JOB_NAME, type WebhookDeliveryJob } from './outbox.poller';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';

type Mock = ReturnType<typeof vi.fn>;

const ORIGINAL_ENV = { ...process.env };
function resetEnv(overrides: Record<string, string | undefined> = {}): void {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV, { NODE_ENV: 'test' });
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetEnvCacheForTests();
}

function buildPrisma(opts: {
  endpoint: Record<string, unknown> | null;
  deliveryCreate?: Mock;
  endpointUpdate?: Mock;
  // Phase 1.1 HIGH-3: tenant active-state gate before delivery. Defaults
  // to "active healthy tenant" so the bulk of existing tests stay unchanged.
  tenant?: { id: string; isActive: boolean; suspendedAt: Date | null } | null;
}) {
  const findFirst = vi.fn().mockResolvedValue(opts.endpoint);
  const deliveryCreate = opts.deliveryCreate ?? vi.fn().mockResolvedValue({});
  const endpointUpdate = opts.endpointUpdate ?? vi.fn().mockResolvedValue({ consecutiveFailures: 0 });
  const tenantFindUnique = vi.fn().mockResolvedValue(
    opts.tenant ?? { id: 't1', isActive: true, suspendedAt: null },
  );

  const runWithTenant = vi.fn().mockImplementation(
    async (
      _tenantId: string,
      fn: (tx: { webhookEndpoint: { findFirst: Mock }; webhookDelivery: { create: Mock } }) => Promise<unknown>,
    ) => fn({ webhookEndpoint: { findFirst }, webhookDelivery: { create: deliveryCreate } }),
  );
  return {
    runWithTenant,
    webhookEndpoint: { update: endpointUpdate },
    tenant: { findUnique: tenantFindUnique },
    findFirst,
    deliveryCreate,
    endpointUpdate,
    tenantFindUnique,
  };
}

function buildMetrics() {
  return {
    setOutboxLagSeconds: vi.fn(),
    recordOutboxProcessed: vi.fn(),
    recordWebhookDelivery: vi.fn(),
  };
}

function makeJob(overrides: Partial<WebhookDeliveryJob> = {}, attempts = 8, attemptsMade = 0) {
  const data: WebhookDeliveryJob = {
    outboxEventId: 'oe1',
    endpointId: 'ep1',
    tenantId: 't1',
    event: 'DEAL_CREATED',
    payload: { id: 'd1' },
    idempotencyKey: 'oe1::ep1',
    occurredAt: '2026-05-17T12:00:00.000Z',
    ...overrides,
  };
  return {
    name: WEBHOOK_DELIVERY_JOB_NAME,
    data,
    attemptsMade,
    opts: { attempts },
  };
}

function makeProcessor(prisma: ReturnType<typeof buildPrisma>, fetchMock?: Mock) {
  const envelope = new EnvelopeService();
  const urlValidator = new UrlValidatorService();
  const metrics = buildMetrics();
  if (fetchMock) {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  }
  const proc = new WebhookDeliveryProcessor(
    prisma as unknown as never,
    envelope,
    urlValidator,
    metrics as never,
  );
  return { proc, metrics, envelope };
}

describe('WebhookDeliveryProcessor', () => {
  beforeEach(() => {
    resetEnv();
    vi.clearAllMocks();
  });

  it('ignores jobs with the wrong name', async () => {
    const prisma = buildPrisma({ endpoint: null });
    const { proc } = makeProcessor(prisma);
    await proc.process({ ...makeJob(), name: 'wrong' } as never);
    expect(prisma.findFirst).not.toHaveBeenCalled();
  });

  it('drops the job (no retry) when the endpoint is missing', async () => {
    const prisma = buildPrisma({ endpoint: null });
    const { proc, metrics } = makeProcessor(prisma);
    await proc.process(makeJob() as never);
    expect(metrics.recordWebhookDelivery).not.toHaveBeenCalled();
  });

  it('skips inactive endpoints silently', async () => {
    const prisma = buildPrisma({
      endpoint: {
        id: 'ep1',
        url: 'https://example.com/hook',
        isActive: false,
        secret: 'plain',
        secretEncrypted: null,
        secretKid: null,
        previousSecretEncrypted: null,
        previousSecretKid: null,
        previousSecretValidUntil: null,
        consecutiveFailures: 0,
      },
    });
    const fetchMock = vi.fn();
    const { proc } = makeProcessor(prisma, fetchMock);
    await proc.process(makeJob() as never);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs the body with HMAC-SHA256(secret, "<ts>.<body>") and sends X-Amass-* headers', async () => {
    const prisma = buildPrisma({
      endpoint: {
        id: 'ep1',
        url: 'https://example.com/hook',
        isActive: true,
        secret: 'plain-fallback-secret',
        secretEncrypted: null,
        secretKid: null,
        previousSecretEncrypted: null,
        previousSecretKid: null,
        previousSecretValidUntil: null,
        consecutiveFailures: 0,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => 'OK',
    });
    const { proc, metrics } = makeProcessor(prisma, fetchMock);

    await proc.process(makeJob() as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Amass-Event']).toBe('DEAL_CREATED');
    expect(headers['X-Amass-Idempotency-Key']).toBe('oe1::ep1');
    expect(headers['X-Amass-Delivery-Attempt']).toBe('1');
    expect(headers['X-Amass-Timestamp']).toMatch(/^\d+$/);

    const sigHeader = headers['X-Amass-Signature']!;
    expect(sigHeader).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);

    // Recompute the expected signature and verify match.
    const tMatch = sigHeader.match(/t=(\d+)/);
    const vMatch = sigHeader.match(/v1=([0-9a-f]{64})/);
    const ts = tMatch![1];
    const body = init.body as string;
    const expected = createHmac('sha256', 'plain-fallback-secret').update(`${ts}.${body}`).digest('hex');
    expect(vMatch![1]).toBe(expected);

    // Metrics + healthy update.
    expect(metrics.recordWebhookDelivery).toHaveBeenCalledWith('DEAL_CREATED', 'success');
    expect(prisma.endpointUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ep1' },
      data: expect.objectContaining({ consecutiveFailures: 0 }),
    }));
  });

  it('includes v1prev when previous secret is still in 24h grace', async () => {
    const envelope = new EnvelopeService();
    const wrappedPrev = envelope.encrypt('previous-secret-value');
    const prisma = buildPrisma({
      endpoint: {
        id: 'ep1',
        url: 'https://example.com/hook',
        isActive: true,
        secret: 'new-secret',
        secretEncrypted: null,
        secretKid: null,
        previousSecretEncrypted: wrappedPrev.ciphertext,
        previousSecretKid: wrappedPrev.kid,
        previousSecretValidUntil: new Date(Date.now() + 60 * 60 * 1000),
        consecutiveFailures: 0,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, text: async () => 'OK' });
    const { proc } = makeProcessor(prisma, fetchMock);

    await proc.process(makeJob() as never);

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Amass-Signature']).toMatch(/v1=[0-9a-f]{64},v1prev=[0-9a-f]{64}$/);
  });

  it('omits v1prev when the grace window has expired', async () => {
    const envelope = new EnvelopeService();
    const wrappedPrev = envelope.encrypt('expired-secret');
    const prisma = buildPrisma({
      endpoint: {
        id: 'ep1',
        url: 'https://example.com/hook',
        isActive: true,
        secret: 'new-secret',
        secretEncrypted: null,
        secretKid: null,
        previousSecretEncrypted: wrappedPrev.ciphertext,
        previousSecretKid: wrappedPrev.kid,
        previousSecretValidUntil: new Date(Date.now() - 1000), // expired 1s ago
        consecutiveFailures: 0,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, text: async () => 'OK' });
    const { proc } = makeProcessor(prisma, fetchMock);

    await proc.process(makeJob() as never);

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Amass-Signature']).not.toMatch(/v1prev=/);
  });

  it('prefers the encrypted secret over the plaintext fallback', async () => {
    const envelope = new EnvelopeService();
    const wrapped = envelope.encrypt('encrypted-secret');
    const prisma = buildPrisma({
      endpoint: {
        id: 'ep1',
        url: 'https://example.com/hook',
        isActive: true,
        secret: 'wrong-plaintext-should-not-be-used',
        secretEncrypted: wrapped.ciphertext,
        secretKid: wrapped.kid,
        previousSecretEncrypted: null,
        previousSecretKid: null,
        previousSecretValidUntil: null,
        consecutiveFailures: 0,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, text: async () => 'OK' });
    const { proc } = makeProcessor(prisma, fetchMock);

    await proc.process(makeJob() as never);

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const ts = headers['X-Amass-Signature']!.match(/t=(\d+)/)![1]!;
    const body = (fetchMock.mock.calls[0]![1] as RequestInit).body as string;
    const expected = createHmac('sha256', 'encrypted-secret').update(`${ts}.${body}`).digest('hex');
    expect(headers['X-Amass-Signature']).toContain(`v1=${expected}`);
  });

  it('disables endpoint on 410 Gone + records dead_letter', async () => {
    const prisma = buildPrisma({
      endpoint: {
        id: 'ep1',
        url: 'https://example.com/hook',
        isActive: true,
        secret: 'k',
        secretEncrypted: null,
        secretKid: null,
        previousSecretEncrypted: null,
        previousSecretKid: null,
        previousSecretValidUntil: null,
        consecutiveFailures: 0,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ status: 410, ok: false, text: async () => 'gone' });
    const { proc, metrics } = makeProcessor(prisma, fetchMock);

    await proc.process(makeJob() as never);

    expect(metrics.recordWebhookDelivery).toHaveBeenCalledWith('DEAL_CREATED', 'dead_letter');
    expect(prisma.endpointUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ep1' },
      data: expect.objectContaining({
        isActive: false,
        disabledReason: 'Subscriber returned 410 Gone',
      }),
    }));
  });

  it('throws on 5xx to trigger BullMQ retry + records retry metric', async () => {
    const prisma = buildPrisma({
      endpoint: {
        id: 'ep1',
        url: 'https://example.com/hook',
        isActive: true,
        secret: 'k',
        secretEncrypted: null,
        secretKid: null,
        previousSecretEncrypted: null,
        previousSecretKid: null,
        previousSecretValidUntil: null,
        consecutiveFailures: 0,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ status: 503, ok: false, text: async () => 'oops' });
    const { proc, metrics } = makeProcessor(prisma, fetchMock);

    await expect(proc.process(makeJob({}, 8, 0) as never)).rejects.toThrow(/HTTP 503/);
    expect(metrics.recordWebhookDelivery).toHaveBeenCalledWith('DEAL_CREATED', 'retry');
  });

  it('marks dead_letter without throw when attempts are exhausted', async () => {
    const prisma = buildPrisma({
      endpoint: {
        id: 'ep1',
        url: 'https://example.com/hook',
        isActive: true,
        secret: 'k',
        secretEncrypted: null,
        secretKid: null,
        previousSecretEncrypted: null,
        previousSecretKid: null,
        previousSecretValidUntil: null,
        consecutiveFailures: 19,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ status: 502, ok: false, text: async () => 'last' });
    // attempts=2, attemptsMade=1 → after this attempt, 0 remaining.
    const { proc, metrics } = makeProcessor(prisma, fetchMock);
    await expect(proc.process(makeJob({}, 2, 1) as never)).resolves.toBeUndefined();
    expect(metrics.recordWebhookDelivery).toHaveBeenCalledWith('DEAL_CREATED', 'dead_letter');
  });

  it('rejects malformed job data via Zod', async () => {
    const prisma = buildPrisma({ endpoint: null });
    const { proc } = makeProcessor(prisma);
    await expect(
      proc.process({
        name: WEBHOOK_DELIVERY_JOB_NAME,
        data: { outboxEventId: 'x' }, // missing required fields
        attemptsMade: 0,
        opts: { attempts: 1 },
      } as never),
    ).rejects.toThrow();
  });

  // Phase 1.1 HIGH-3 regression guard: tenant suspended between outbox
  // publish and delivery → drop the job, don't ship the event to the
  // subscriber. Pre-fix, the processor only checked `endpoint.isActive`
  // (tenant-level kill-switch was ignored).
  it('regression HIGH-3: skips delivery when tenant is suspended (isActive=false)', async () => {
    const prisma = buildPrisma({
      endpoint: {
        id: 'ep1',
        url: 'https://example.com/hook',
        isActive: true,
        secret: 'k',
        secretEncrypted: null,
        secretKid: null,
        previousSecretEncrypted: null,
        previousSecretKid: null,
        previousSecretValidUntil: null,
        consecutiveFailures: 0,
      },
      tenant: { id: 't1', isActive: false, suspendedAt: new Date() },
    });
    const fetchMock = vi.fn();
    const { proc, metrics } = makeProcessor(prisma, fetchMock);
    await proc.process(makeJob() as never);
    // Network NEVER hit — fan-out blocked at the tenant gate.
    expect(fetchMock).not.toHaveBeenCalled();
    // Endpoint findFirst not reached either.
    expect(prisma.findFirst).not.toHaveBeenCalled();
    // No delivery metric (it never executed).
    expect(metrics.recordWebhookDelivery).not.toHaveBeenCalled();
  });

  it('regression HIGH-3: skips delivery when tenant has suspendedAt set (kill switch)', async () => {
    const prisma = buildPrisma({
      endpoint: {
        id: 'ep1',
        url: 'https://example.com/hook',
        isActive: true,
        secret: 'k',
        secretEncrypted: null,
        secretKid: null,
        previousSecretEncrypted: null,
        previousSecretKid: null,
        previousSecretValidUntil: null,
        consecutiveFailures: 0,
      },
      tenant: { id: 't1', isActive: true, suspendedAt: new Date() },
    });
    const fetchMock = vi.fn();
    const { proc } = makeProcessor(prisma, fetchMock);
    await proc.process(makeJob() as never);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.findFirst).not.toHaveBeenCalled();
  });
});
