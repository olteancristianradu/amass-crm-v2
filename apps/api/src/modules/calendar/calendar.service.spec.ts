import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

vi.mock('../../common/crypto/encryption', () => ({
  encrypt: vi.fn((s: string) => `ENC(${s})`),
  decrypt: vi.fn((s: string) => s.replace(/^ENC\(|\)$/g, '')),
}));

import { CalendarService } from './calendar.service';

const ORIG_ENV = { ...process.env };

function build() {
  const tx = {
    calendarIntegration: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    calendarEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    calendarIntegration: { findMany: vi.fn() },
  } as unknown as ConstructorParameters<typeof CalendarService>[0];
  // M-aud-H8: redis stub for OAuth state nonces. set/get/del are the
  // only methods buildAuthUrl/consumeOAuthState touch.
  const redisStore = new Map<string, string>();
  const redis = {
    client: {
      set: vi.fn(async (k: string, v: string) => { redisStore.set(k, v); return 'OK'; }),
      get: vi.fn(async (k: string) => redisStore.get(k) ?? null),
      del: vi.fn(async (k: string) => { redisStore.delete(k); return 1; }),
    },
  } as unknown as ConstructorParameters<typeof CalendarService>[1];
  const svc = new CalendarService(prisma, redis);
  return { svc, prisma, tx, redis };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIG_ENV };
  process.env.GOOGLE_CLIENT_ID = 'g-cid';
  process.env.GOOGLE_CLIENT_SECRET = 'g-sec';
  process.env.OUTLOOK_CLIENT_ID = 'o-cid';
  process.env.OUTLOOK_CLIENT_SECRET = 'o-sec';
});
afterEach(() => {
  process.env = { ...ORIG_ENV };
});

// requireTenantContext is mocked at top of file — buildAuthUrl needs ALS context
vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
  tenantStorage: { run: (_ctx: unknown, fn: () => unknown) => fn() },
}));

describe('CalendarService.buildAuthUrl', () => {
  it('builds Google URL with offline access + consent prompt + state nonce', async () => {
    const url = await build().svc.buildAuthUrl('GOOGLE', 'https://app/cb');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    expect(url).toContain('client_id=g-cid');
    // M-aud-H8: state must be present and non-empty (CSRF mitigation)
    expect(url).toMatch(/state=[0-9a-f]{48}/);
  });

  it('builds Outlook URL with offline_access + Calendars.ReadWrite scopes + state', async () => {
    const url = await build().svc.buildAuthUrl('OUTLOOK', 'https://app/cb');
    expect(url).toContain('login.microsoftonline.com');
    // URLSearchParams encodes spaces as '+', so decode + handle that explicitly.
    const decoded = decodeURIComponent(url.replace(/\+/g, ' '));
    expect(decoded).toContain('Calendars.ReadWrite offline_access');
    expect(url).toMatch(/state=[0-9a-f]{48}/);
  });
});

describe('CalendarService.exchangeCode', () => {
  it('Google: returns accessToken/refreshToken/expiresAt with correct math', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
    } as Response);
    const before = Date.now();
    const out = await build().svc.exchangeCode('GOOGLE', 'CODE-123', 'https://app/cb');
    expect(out.accessToken).toBe('AT');
    expect(out.refreshToken).toBe('RT');
    expect(out.expiresAt.getTime() - before).toBeGreaterThanOrEqual(3600 * 1000 - 1000);
    expect(out.expiresAt.getTime() - before).toBeLessThan(3700 * 1000);
    fetchSpy.mockRestore();
  });

  it('Outlook: handles missing refresh token gracefully', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'AT', expires_in: 3600 }),
    } as Response);
    const out = await build().svc.exchangeCode('OUTLOOK', 'CODE', 'https://app/cb');
    expect(out.refreshToken).toBeUndefined();
    fetchSpy.mockRestore();
  });
});

describe('CalendarService.saveIntegration', () => {
  it('encrypts both access and refresh tokens at rest', async () => {
    const h = build();
    h.tx.calendarIntegration.upsert.mockResolvedValueOnce({ id: 'int-1' });
    await h.svc.saveIntegration('GOOGLE', 'plain-AT', 'plain-RT', new Date('2026-04-28'));
    const args = h.tx.calendarIntegration.upsert.mock.calls[0][0];
    expect(args.create.accessTokenEnc).toBe('ENC(plain-AT)');
    expect(args.create.refreshTokenEnc).toBe('ENC(plain-RT)');
  });

  it('persists null refreshTokenEnc when provider did not return one', async () => {
    const h = build();
    h.tx.calendarIntegration.upsert.mockResolvedValueOnce({ id: 'int-2' });
    await h.svc.saveIntegration('OUTLOOK', 'AT', undefined, new Date('2026-04-28'));
    const args = h.tx.calendarIntegration.upsert.mock.calls[0][0];
    expect(args.create.refreshTokenEnc).toBeNull();
  });
});

describe('CalendarService.listEvents', () => {
  it('applies from/to/subject facets when set', async () => {
    const h = build();
    h.tx.calendarEvent.findMany.mockResolvedValueOnce([]);
    const from = new Date('2026-04-01');
    const to = new Date('2026-04-30');
    await h.svc.listEvents({
      from,
      to,
      subjectType: 'CONTACT',
      subjectId: 'c-1',
    } as never);
    const where = h.tx.calendarEvent.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      tenantId: 'tenant-1',
      startAt: { gte: from },
      endAt: { lte: to },
      subjectType: 'CONTACT',
      subjectId: 'c-1',
    });
  });
});

describe('CalendarService.refreshExpiring', () => {
  it('refreshes integrations expiring within 1h horizon', async () => {
    const h = build();
    vi.mocked(h.prisma.calendarIntegration.findMany).mockResolvedValueOnce([
      {
        id: 'int-1',
        tenantId: 'tenant-1',
        provider: 'GOOGLE',
        refreshTokenEnc: 'ENC(RT)',
      },
    ] as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'NEW-AT', expires_in: 3600 }),
    } as Response);
    h.tx.calendarIntegration.update.mockResolvedValueOnce({});
    const out = await h.svc.refreshExpiring(new Date('2026-04-27T12:00:00Z'));
    expect(out).toEqual({ refreshed: 1, failed: 0 });
    const updateArgs = h.tx.calendarIntegration.update.mock.calls[0][0];
    expect(updateArgs.data.accessTokenEnc).toBe('ENC(NEW-AT)');
    fetchSpy.mockRestore();
  });

  it('counts failures without throwing — sweep stays alive across providers', async () => {
    const h = build();
    vi.mocked(h.prisma.calendarIntegration.findMany).mockResolvedValueOnce([
      {
        id: 'int-1',
        tenantId: 'tenant-1',
        provider: 'GOOGLE',
        refreshTokenEnc: 'ENC(RT)',
      },
    ] as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('boom'));
    const out = await h.svc.refreshExpiring();
    expect(out).toEqual({ refreshed: 0, failed: 1 });
    fetchSpy.mockRestore();
  });

  it('horizon math: looks 1h ahead of `now` argument', async () => {
    const h = build();
    vi.mocked(h.prisma.calendarIntegration.findMany).mockResolvedValueOnce([] as never);
    const now = new Date('2026-04-27T10:00:00Z');
    await h.svc.refreshExpiring(now);
    const where = vi.mocked(h.prisma.calendarIntegration.findMany).mock.calls[0][0]!.where as {
      tokenExpiresAt: { lt: Date };
    };
    expect(where.tokenExpiresAt.lt.toISOString()).toBe('2026-04-27T11:00:00.000Z');
  });
});
