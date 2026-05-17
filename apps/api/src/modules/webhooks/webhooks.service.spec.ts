import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { _resetEnvCacheForTests } from '../../config/env';
import { EnvelopeService } from '../../common/crypto/envelope.service';
import { UrlValidatorService } from '../../common/ssrf/url-validator.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { WebhooksService, isPrivateOrReservedIp } from './webhooks.service';

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

const mockRunWithTenant: Mock = vi.fn();
const mockPrisma = {
  runWithTenant: mockRunWithTenant,
  webhookDelivery: { create: vi.fn() },
} as unknown as import('../../infra/prisma/prisma.service').PrismaService;

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

function makeSvc(audit?: { log: Mock }): WebhooksService {
  const urlValidator = new UrlValidatorService();
  const envelope = new EnvelopeService();
  const outbox = new OutboxService();
  return new WebhooksService(
    mockPrisma,
    urlValidator,
    envelope,
    outbox,
    audit as never,
  );
}

describe('WebhooksService', () => {
  let svc: WebhooksService;

  beforeEach(() => {
    resetEnv();
    vi.clearAllMocks();
    svc = makeSvc();
  });

  describe('create', () => {
    it('generates a secret, encrypts it, and creates endpoint with dual-write', async () => {
      const endpoint = {
        id: 'ep1',
        url: 'https://example.com/hook',
        events: ['DEAL_CREATED'],
        isActive: true,
        createdAt: new Date(),
        secret: 'abc',
      };
      // Capture the create() call args so we can assert dual-write shape.
      const create = vi.fn().mockResolvedValue(endpoint);
      mockRunWithTenant.mockImplementationOnce(
        async (_t: string, fn: (tx: { webhookEndpoint: { create: Mock } }) => Promise<unknown>) =>
          fn({ webhookEndpoint: { create } }),
      );

      const result = await svc.create({ url: 'https://example.com/hook', events: ['DEAL_CREATED' as never] });

      expect(result).toBe(endpoint);
      expect(mockRunWithTenant).toHaveBeenCalledWith('tenant-1', expect.any(Function));
      const callArgs = create.mock.calls[0][0];
      expect(callArgs.data.url).toBe('https://example.com/hook');
      expect(callArgs.data.secret).toMatch(/^[0-9a-f]{48}$/); // plaintext legacy
      expect(typeof callArgs.data.secretEncrypted).toBe('string'); // envelope ciphertext
      expect(callArgs.data.secretEncrypted.length).toBeGreaterThan(30);
      expect(typeof callArgs.data.secretKid).toBe('string'); // KEK kid
    });

    it('rejects URLs that fail SSRF validation (malformed)', async () => {
      await expect(
        svc.create({ url: 'not-a-url', events: ['DEAL_CREATED' as never] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects URLs containing credentials (userinfo bypass)', async () => {
      await expect(
        svc.create({ url: 'https://user:pass@example.com/hook', events: ['DEAL_CREATED' as never] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects non-http(s) protocols', async () => {
      await expect(
        svc.create({ url: 'ftp://example.com/hook', events: ['DEAL_CREATED' as never] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects platform apex *.amass-crm.com', async () => {
      await expect(
        svc.create({ url: 'https://api.amass-crm.com/internal', events: ['DEAL_CREATED' as never] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('list', () => {
    it('returns all endpoints for the current tenant', async () => {
      const eps = [
        { id: 'ep1', url: 'https://a.example/hook', events: [], isActive: true, createdAt: new Date() },
        { id: 'ep2', url: 'https://b.example/hook', events: [], isActive: false, createdAt: new Date() },
      ];
      mockRunWithTenant.mockResolvedValueOnce(eps);
      const out = await svc.list();
      expect(out).toEqual(eps);
      expect(mockRunWithTenant).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    });
  });

  describe('get', () => {
    it('throws NotFoundException when endpoint missing', async () => {
      mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { findFirst: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { findFirst: vi.fn().mockResolvedValue(null) } }),
      );
      await expect(svc.get('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the endpoint when found', async () => {
      const ep = { id: 'ep1', url: 'https://a.example/hook', events: [], isActive: true };
      const findFirst = vi.fn().mockResolvedValue(ep);
      mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { findFirst: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { findFirst } }),
      );
      const out = await svc.get('ep1');
      expect(out).toEqual(ep);
      expect(findFirst).toHaveBeenCalledWith({
        where: { id: 'ep1', tenantId: 'tenant-1' },
        select: { id: true, url: true, events: true, isActive: true, createdAt: true },
      });
    });
  });

  describe('update', () => {
    it('rejects credential-bearing URL on update (SSRF re-validation)', async () => {
      mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { findFirst: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { findFirst: vi.fn().mockResolvedValue({ id: 'ep1' }) } }),
      );
      await expect(
        svc.update('ep1', { url: 'https://u:p@example.com/hook' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('only patches keys present in the dto', async () => {
      mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { findFirst: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { findFirst: vi.fn().mockResolvedValue({ id: 'ep1' }) } }),
      );
      const update = vi.fn().mockResolvedValue({ id: 'ep1' });
      mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { update: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { update } }),
      );

      await svc.update('ep1', { isActive: false });
      expect(update.mock.calls[0][0].data).toEqual({ isActive: false });
    });
  });

  describe('delete', () => {
    it('throws NotFound when endpoint missing', async () => {
      mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { findFirst: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { findFirst: vi.fn().mockResolvedValue(null) } }),
      );
      await expect(svc.delete('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes when endpoint exists', async () => {
      mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { findFirst: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { findFirst: vi.fn().mockResolvedValue({ id: 'ep1' }) } }),
      );
      const del = vi.fn().mockResolvedValue({});
      mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { delete: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { delete: del } }),
      );

      await svc.delete('ep1');
      expect(del).toHaveBeenCalledWith({ where: { id: 'ep1' } });
    });
  });

  describe('rotateSecret (SEC-008 + T-WH-T-03 grace window)', () => {
    it('throws NotFound when endpoint missing', async () => {
      mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { findFirst: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { findFirst: vi.fn().mockResolvedValue(null) } }),
      );
      await expect(svc.rotateSecret('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns a fresh hex secret, demotes current to previous, sets 24h grace', async () => {
      // current row read
      mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { findFirst: Mock } }) => Promise<unknown>) =>
        fn({
          webhookEndpoint: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'ep1',
              secret: 'old-plain',
              secretEncrypted: 'old-ciphertext',
              secretKid: 'kek-test',
            }),
          },
        }),
      );
      const update = vi.fn().mockResolvedValue({ id: 'ep1' });
      mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { update: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { update } }),
      );

      const out = await svc.rotateSecret('ep1');

      expect(out.id).toBe('ep1');
      expect(out.secret).toMatch(/^[0-9a-f]{48}$/);
      expect(out.rotatedAt).toBeInstanceOf(Date);

      const data = update.mock.calls[0][0].data;
      // Active secret rotated.
      expect(data.secret).toBe(out.secret);
      expect(typeof data.secretEncrypted).toBe('string');
      expect(typeof data.secretKid).toBe('string');
      // Previous demoted from the old encrypted column.
      expect(data.previousSecretEncrypted).toBe('old-ciphertext');
      expect(data.previousSecretKid).toBe('kek-test');
      // Grace window ~24h from now.
      const graceMs = data.previousSecretValidUntil.getTime() - Date.now();
      expect(graceMs).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(graceMs).toBeLessThan(25 * 60 * 60 * 1000);
    });

    it('wraps the plaintext on rotation if the row has no prior encrypted secret (pre-migration row)', async () => {
      mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { findFirst: Mock } }) => Promise<unknown>) =>
        fn({
          webhookEndpoint: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'ep1',
              secret: 'legacy-plain-only',
              secretEncrypted: null,
              secretKid: null,
            }),
          },
        }),
      );
      const update = vi.fn().mockResolvedValue({ id: 'ep1' });
      mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { update: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { update } }),
      );

      await svc.rotateSecret('ep1');
      const data = update.mock.calls[0][0].data;
      // Even though the pre-rotation row was plaintext-only, the previous
      // ciphertext column gets a fresh wrap so the delivery worker can
      // sign with both secrets during the grace window.
      expect(typeof data.previousSecretEncrypted).toBe('string');
      expect(data.previousSecretEncrypted.length).toBeGreaterThan(30);
    });

    it('returns a different secret on each call', async () => {
      const setupCall = () => {
        mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { findFirst: Mock } }) => Promise<unknown>) =>
          fn({
            webhookEndpoint: {
              findFirst: vi.fn().mockResolvedValue({
                id: 'ep1',
                secret: 'x',
                secretEncrypted: 'y',
                secretKid: 'kek-test',
              }),
            },
          }),
        );
        mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { update: Mock } }) => Promise<unknown>) =>
          fn({ webhookEndpoint: { update: vi.fn().mockResolvedValue({ id: 'ep1' }) } }),
        );
      };
      setupCall();
      const r1 = await svc.rotateSecret('ep1');
      setupCall();
      const r2 = await svc.rotateSecret('ep1');
      expect(r1.secret).not.toBe(r2.secret);
    });
  });

  describe('listDeliveries', () => {
    it('orders by createdAt desc and caps at 100', async () => {
      mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { findFirst: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { findFirst: vi.fn().mockResolvedValue({ id: 'ep1' }) } }),
      );
      const findMany = vi.fn().mockResolvedValue([]);
      mockRunWithTenant.mockImplementationOnce(async (_t: string, fn: (tx: { webhookDelivery: { findMany: Mock } }) => Promise<unknown>) =>
        fn({ webhookDelivery: { findMany } }),
      );

      await svc.listDeliveries('ep1');
      expect(findMany).toHaveBeenCalledWith({
        where: { endpointId: 'ep1' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });
  });

  describe('publishEvent (outbox pattern)', () => {
    it('delegates to OutboxService.publish with the supplied tx', async () => {
      const create = vi.fn().mockResolvedValue({ id: 'outbox-row-1' });
      const tx = { outboxEvent: { create } } as unknown as import('@prisma/client').Prisma.TransactionClient;

      const id = await svc.publishEvent('DEAL_CREATED' as never, { id: 'd1' }, {
        tx,
        aggregateType: 'Deal',
        aggregateId: 'd1',
      });

      expect(id).toBe('outbox-row-1');
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'DEAL_CREATED',
          aggregateType: 'Deal',
          aggregateId: 'd1',
        }),
      }));
    });
  });

  describe('dispatch (legacy shim)', () => {
    it('fires without throwing even when the outbox insert fails', () => {
      // Force runWithTenant to reject so the inner publish rejects.
      mockRunWithTenant.mockRejectedValueOnce(new Error('db down'));
      expect(() => svc.dispatch('tenant-1', 'DEAL_CREATED' as never, { id: 'deal-1' })).not.toThrow();
    });
  });
});

// Phase 1.1 HIGH-2 regression guard: every webhook endpoint mutation must
// emit a structured audit row so operators can answer "who created/disabled
// /rotated this endpoint, and when". Pre-fix, only the SQL row mutated;
// audit log was silent (compliance gap).
describe('WebhooksService — audit on CRUD + rotate (HIGH-2 regression)', () => {
  let audit: { log: Mock };
  let svcWithAudit: WebhooksService;

  beforeEach(() => {
    resetEnv();
    vi.clearAllMocks();
    audit = { log: vi.fn().mockResolvedValue(undefined) };
    svcWithAudit = makeSvc(audit);
  });

  it('audits webhook.endpoint.created on create()', async () => {
    const endpoint = {
      id: 'ep-X',
      url: 'https://example.com/hook',
      events: ['DEAL_CREATED'],
      isActive: true,
      createdAt: new Date(),
      secret: 'abc',
    };
    const create = vi.fn().mockResolvedValue(endpoint);
    mockRunWithTenant.mockImplementationOnce(
      async (_t: string, fn: (tx: { webhookEndpoint: { create: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { create } }),
    );
    await svcWithAudit.create({ url: 'https://example.com/hook', events: ['DEAL_CREATED' as never] });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'webhook.endpoint.created',
      subjectType: 'WebhookEndpoint',
      subjectId: 'ep-X',
    }));
    // Secret plaintext MUST NEVER leak into audit metadata.
    const metadata = audit.log.mock.calls[0]![0].metadata as Record<string, unknown>;
    expect(JSON.stringify(metadata)).not.toContain('abc');
  });

  it('audits webhook.endpoint.updated on update()', async () => {
    const ep = { id: 'ep-X', url: 'https://example.com/hook', events: ['DEAL_CREATED'], isActive: true, createdAt: new Date() };
    // First runWithTenant call: get() reads the endpoint.
    // Second: the actual update.
    mockRunWithTenant
      .mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { findFirst: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { findFirst: vi.fn().mockResolvedValue(ep) } }),
      )
      .mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { update: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { update: vi.fn().mockResolvedValue(ep) } }),
      );
    await svcWithAudit.update('ep-X', { isActive: false });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'webhook.endpoint.updated',
      subjectId: 'ep-X',
      metadata: expect.objectContaining({ fields: ['isActive'], newIsActive: false }),
    }));
  });

  it('audits webhook.endpoint.deleted on delete()', async () => {
    const ep = { id: 'ep-X', url: 'https://example.com/hook', events: ['DEAL_CREATED'], isActive: true, createdAt: new Date() };
    mockRunWithTenant
      .mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { findFirst: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { findFirst: vi.fn().mockResolvedValue(ep) } }),
      )
      .mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { delete: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { delete: vi.fn().mockResolvedValue(ep) } }),
      );
    await svcWithAudit.delete('ep-X');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'webhook.endpoint.deleted',
      subjectId: 'ep-X',
    }));
  });

  it('audits webhook.endpoint.secret_rotated on rotateSecret() — never leaks plaintext', async () => {
    const before = {
      id: 'ep-X',
      secret: 'old-plain',
      secretEncrypted: 'wrapped-old',
      secretKid: 'kek-1',
    };
    mockRunWithTenant
      .mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { findFirst: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { findFirst: vi.fn().mockResolvedValue(before) } }),
      )
      .mockImplementationOnce(async (_t: string, fn: (tx: { webhookEndpoint: { update: Mock } }) => Promise<unknown>) =>
        fn({ webhookEndpoint: { update: vi.fn().mockResolvedValue({ id: 'ep-X' }) } }),
      );
    const out = await svcWithAudit.rotateSecret('ep-X');
    // New plaintext returned to caller exactly once.
    expect(out.secret).toMatch(/^[0-9a-f]{48}$/);
    // Audit row written.
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'webhook.endpoint.secret_rotated',
      subjectId: 'ep-X',
    }));
    // Plaintext secret NEVER in audit metadata.
    const metadata = audit.log.mock.calls[0]![0].metadata as Record<string, unknown>;
    expect(JSON.stringify(metadata)).not.toContain(out.secret);
  });
});

/**
 * SSRF blocklist sanity check at the re-export boundary — keeps the public
 * shape stable for any caller still importing `isPrivateOrReservedIp` from
 * webhooks.service.ts (we moved it to common/ssrf and re-exported).
 */
describe('isPrivateOrReservedIp re-export (SSRF blocklist)', () => {
  it.each([
    ['1.1.1.1', 4, false],
    ['127.0.0.1', 4, true],
    ['169.254.169.254', 4, true], // AWS IMDS
    ['168.63.129.16', 4, true], // Azure IMDS (Phase 1 F3 addition)
    ['10.0.0.1', 4, true],
    ['fe80::1', 6, true],
  ] as const)('isPrivateOrReservedIp(%s, %s) === %s', (ip, family, expected) => {
    expect(isPrivateOrReservedIp(ip, family)).toBe(expected);
  });
});
