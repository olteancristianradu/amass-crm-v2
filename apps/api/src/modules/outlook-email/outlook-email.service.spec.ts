import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
  tenantStorage: { run: (_ctx: unknown, fn: () => unknown) => fn() },
}));

vi.mock('../../common/crypto/encryption', () => ({
  encrypt: vi.fn((s: string) => `ENC(${s})`),
  decrypt: vi.fn((s: string) => s.replace(/^ENC\(|\)$/g, '')),
}));

import { OutlookEmailService } from './outlook-email.service';

const ORIG_ENV = { ...process.env };

function build() {
  const tx = {
    outlookToken: {
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof OutlookEmailService>[0];
  const redisStore = new Map<string, string>();
  const redis = {
    client: {
      set: vi.fn(async (k: string, v: string) => {
        redisStore.set(k, v);
        return 'OK';
      }),
      get: vi.fn(async (k: string) => redisStore.get(k) ?? null),
      del: vi.fn(async (k: string) => {
        redisStore.delete(k);
        return 1;
      }),
    },
  } as unknown as ConstructorParameters<typeof OutlookEmailService>[1];
  const svc = new OutlookEmailService(prisma, redis);
  return { svc, prisma, tx, redis };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIG_ENV };
  process.env.OUTLOOK_CLIENT_ID = 'o-cid';
  process.env.OUTLOOK_CLIENT_SECRET = 'o-sec';
});
afterEach(() => {
  process.env = { ...ORIG_ENV };
});

describe('OutlookEmailService.buildAuthUrl', () => {
  it('builds MS auth URL with required scopes + state nonce', async () => {
    const { svc } = build();
    const url = await svc.buildAuthUrl('https://app/cb');

    // Path is fixed regardless of env-overridden base URL.
    expect(url).toContain('/common/oauth2/v2.0/authorize');
    expect(url).toContain('client_id=o-cid');
    // URLSearchParams encodes spaces as '+', decode for assertion.
    const decoded = decodeURIComponent(url.replace(/\+/g, ' '));
    expect(decoded).toContain('Mail.ReadWrite');
    expect(decoded).toContain('Mail.Send');
    expect(decoded).toContain('offline_access');
    // CSRF mitigation: state must be present.
    expect(url).toMatch(/state=[0-9a-f]+/);
    // Forces consent so refresh_token is always returned.
    expect(url).toContain('prompt=consent');
  });

  it('persists state in Redis with 10min TTL bound to tenant+user', async () => {
    const { svc, redis } = build();
    await svc.buildAuthUrl('https://app/cb');

    expect(redis.client.set).toHaveBeenCalledWith(
      expect.stringMatching(/^oauth:outlook-email:state:[0-9a-f]+$/),
      expect.stringContaining('tenant-1'),
      'EX',
      600,
    );
  });
});

describe('OutlookEmailService.handleCallback', () => {
  it('rejects unknown state (CSRF defense)', async () => {
    const { svc } = build();
    await expect(
      svc.handleCallback('any-code', 'unknown-state', 'https://app/cb'),
    ).rejects.toThrowError(/invalid or expired/i);
  });

  it('rejects state bound to different tenant/user (replay defense)', async () => {
    const { svc, redis } = build();
    await redis.client.set(
      'oauth:outlook-email:state:foreign',
      JSON.stringify({ tenantId: 'OTHER', userId: 'OTHER' }),
      'EX',
      600,
    );
    await expect(
      svc.handleCallback('any-code', 'foreign', 'https://app/cb'),
    ).rejects.toThrowError(/state mismatch/i);
  });
});

describe('OutlookEmailService.getStatus', () => {
  it('returns connected:false when no token row exists', async () => {
    const { svc, tx } = build();
    tx.outlookToken.findFirst.mockResolvedValueOnce(null);
    const out = await svc.getStatus();
    expect(out).toEqual({ connected: false });
  });

  it('returns connected:true with email/displayName when active', async () => {
    const { svc, tx } = build();
    tx.outlookToken.findFirst.mockResolvedValueOnce({
      email: 'andrei@firma.ro',
      displayName: 'Andrei Popescu',
      isActive: true,
    });
    const out = await svc.getStatus();
    expect(out).toEqual({
      connected: true,
      email: 'andrei@firma.ro',
      displayName: 'Andrei Popescu',
    });
  });
});
