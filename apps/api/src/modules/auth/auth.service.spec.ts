import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, HttpException, UnauthorizedException } from '@nestjs/common';
import { AuthService, hashToken, parseTtlSeconds } from './auth.service';

/**
 * AuthService tests. This is the most security-critical surface in the
 * codebase — every failure mode is exercised:
 *
 *   - register: tenant conflict, happy-path (creates tenant + owner +
 *     default pipeline with 5 stages), audit log on success.
 *   - login: account lockout TTL short-circuit, tenant / user / password
 *     misses all yield the same opaque INVALID_CREDENTIALS, TOTP_REQUIRED
 *     when 2FA on, TOTP-code fallback to backup code (single-use splice),
 *     legacy bcrypt hash triggers a fire-and-forget rehash, counters
 *     cleared on success.
 *   - recordFailedAttempt promotes to lockout once threshold hit.
 *   - refresh: INVALID_REFRESH for revoked/expired/missing/inactive,
 *     rotation revokes the old session row.
 *   - logout: idempotent on missing session, adds access jti to Redis
 *     blocklist under the correct TTL.
 *   - me: returns SafeUser / null; never leaks passwordHash.
 *
 * bcrypt is mocked so tests run in ms, not hundreds of ms per compare.
 *
 * Pure helpers hashToken + parseTtlSeconds are already covered by
 * auth.service.spec's sibling file; a smoke case here re-asserts the
 * re-exports still resolve.
 */

vi.mock('bcrypt', () => ({
  hash: vi.fn(async (pw: string, _cost: number) => `hashed(${pw})`),
  compare: vi.fn(async (pw: string, hashVal: string) => hashVal === `hashed(${pw})`),
}));

vi.mock('../../config/env', () => ({
  loadEnv: () => ({
    JWT_SECRET: 'test-secret',
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL_DAYS: 30,
  }),
}));

import * as bcrypt from 'bcrypt';

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    tenantId: 'tenant-1',
    email: 'owner@example.com',
    passwordHash: 'hashed(pw)',
    fullName: 'Owner Example',
    role: 'OWNER',
    isActive: true,
    totpEnabled: false,
    totpSecret: null,
    totpBackupCodes: null,
    ...overrides,
  };
}

function build() {
  const tx = {
    tenant: { create: vi.fn() },
    user: { create: vi.fn() },
    pipeline: { create: vi.fn() },
    pipelineStage: { createMany: vi.fn() },
  };
  const prisma = {
    tenant: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    session: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    pipeline: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof AuthService>[0];
  const jwt = {
    signAsync: vi.fn(async () => 'signed.jwt.token'),
  } as unknown as ConstructorParameters<typeof AuthService>[1];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof AuthService>[2];
  // Simple Redis store — tracks counters, supports incr / del / ttl.
  const store = new Map<string, { v: number; exp: number }>();
  const now = () => Math.floor(Date.now() / 1000);
  const redis = {
    ttl: vi.fn(async (k: string) => {
      const row = store.get(k);
      if (!row) return -2;
      const left = row.exp - now();
      return left > 0 ? left : -2;
    }),
    incr: vi.fn(async (k: string, ttl: number) => {
      const row = store.get(k) ?? { v: 0, exp: now() + ttl };
      row.v += 1;
      store.set(k, row);
      return row.v;
    }),
    del: vi.fn(async (k: string) => { store.delete(k); }),
    client: {
      setex: vi.fn(async () => 'OK'),
    },
  } as unknown as ConstructorParameters<typeof AuthService>[3];
  const totpSvc = {
    verify: vi.fn(async () => true),
  } as unknown as ConstructorParameters<typeof AuthService>[4];

  const svc = new AuthService(prisma, jwt, audit, redis, totpSvc);
  return { svc, prisma, tx, jwt, audit, redis, store, totpSvc };
}

// ─────────────────────────────────────────────────────────────────────────
// Pure-helper smoke (full helper tests live in auth.service.spec.ts sibling)
// ─────────────────────────────────────────────────────────────────────────

describe('auth.service helpers re-exports', () => {
  it('hashToken + parseTtlSeconds resolve', () => {
    expect(hashToken('x')).toHaveLength(64);
    expect(parseTtlSeconds('1h')).toBe(3600);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// register
// ─────────────────────────────────────────────────────────────────────────

describe('AuthService.register', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws TENANT_EXISTS when the slug is taken', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue({ id: 't-1', slug: 'taken' } as never);
    await expect(
      h.svc.register({
        tenantSlug: 'taken', tenantName: 'X', email: 'a@b.com', password: 'pw', fullName: 'A B',
      } as never),
    ).rejects.toThrow(ConflictException);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates tenant + OWNER user + default pipeline with 5 stages, logs audit', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue(null);
    h.tx.tenant.create.mockResolvedValue({ id: 'tenant-new', slug: 'new-co' });
    const user = makeUser({ id: 'user-new', tenantId: 'tenant-new', role: 'OWNER' });
    h.tx.user.create.mockResolvedValue(user);
    h.tx.pipeline.create.mockResolvedValue({ id: 'pipe-1' });
    h.tx.pipelineStage.createMany.mockResolvedValue({ count: 5 });

    const out = await h.svc.register({
      tenantSlug: 'new-co', tenantName: 'NewCo', email: 'OWNER@EX.com', password: 'pw', fullName: 'Owner',
    } as never);

    expect(h.tx.tenant.create).toHaveBeenCalledWith({ data: { slug: 'new-co', name: 'NewCo' } });
    // Email must be lowercased
    expect(h.tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-new',
          email: 'owner@ex.com',
          role: 'OWNER',
          passwordHash: 'hashed(pw)',
        }),
      }),
    );
    expect(h.tx.pipeline.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isDefault: true, name: 'Vânzări' }) }),
    );
    const stageArg = h.tx.pipelineStage.createMany.mock.calls[0]![0] as { data: unknown[] };
    expect(stageArg.data).toHaveLength(5);

    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.register', subjectId: 'user-new' }),
    );
    expect(out.user.email).toBe('owner@example.com'); // comes from makeUser.user.email
    expect(out.tokens.accessToken).toBe('signed.jwt.token');
    expect(out.tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
  });

  it('falls back to tenantSlug when tenantName is missing', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue(null);
    h.tx.tenant.create.mockResolvedValue({ id: 'tenant-new' });
    h.tx.user.create.mockResolvedValue(makeUser());
    h.tx.pipeline.create.mockResolvedValue({ id: 'p-1' });
    h.tx.pipelineStage.createMany.mockResolvedValue({ count: 5 });
    await h.svc.register({
      tenantSlug: 'onlyslug', email: 'a@b.com', password: 'pw', fullName: 'A',
    } as never);
    expect(h.tx.tenant.create).toHaveBeenCalledWith({ data: { slug: 'onlyslug', name: 'onlyslug' } });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// login
// ─────────────────────────────────────────────────────────────────────────

describe('AuthService.login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('short-circuits with ACCOUNT_LOCKED when the lockout TTL is positive', async () => {
    const h = build();
    vi.mocked(h.redis.ttl).mockResolvedValueOnce(600);
    await expect(
      h.svc.login({ tenantSlug: 't', email: 'a@b.com', password: 'pw' } as never),
    ).rejects.toThrow(HttpException);
    expect(h.prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('returns opaque INVALID_CREDENTIALS on unknown tenant slug (and bumps fail counter)', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue(null);
    await expect(
      h.svc.login({ tenantSlug: 'nope', email: 'a@b.com', password: 'pw' } as never),
    ).rejects.toThrow(UnauthorizedException);
    expect(h.redis.incr).toHaveBeenCalled();
  });

  it('returns INVALID_CREDENTIALS when user is missing', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue({ id: 'tenant-1' } as never);
    vi.mocked(h.prisma.user.findUnique).mockResolvedValue(null);
    await expect(
      h.svc.login({ tenantSlug: 't', email: 'a@b.com', password: 'pw' } as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('returns INVALID_CREDENTIALS when user is inactive', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue({ id: 'tenant-1' } as never);
    vi.mocked(h.prisma.user.findUnique).mockResolvedValue(makeUser({ isActive: false }) as never);
    await expect(
      h.svc.login({ tenantSlug: 't', email: 'a@b.com', password: 'pw' } as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('returns INVALID_CREDENTIALS on wrong password', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue({ id: 'tenant-1' } as never);
    vi.mocked(h.prisma.user.findUnique).mockResolvedValue(makeUser() as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);
    await expect(
      h.svc.login({ tenantSlug: 't', email: 'a@b.com', password: 'wrong' } as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('happy path — clears fail counter, issues tokens, audit-logs login', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue({ id: 'tenant-1' } as never);
    vi.mocked(h.prisma.user.findUnique).mockResolvedValue(makeUser() as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);
    vi.mocked(h.prisma.session.create).mockResolvedValue({ id: 'sess-1' } as never);
    const out = await h.svc.login(
      { tenantSlug: 't', email: 'a@b.com', password: 'pw' } as never,
      { ipAddress: '1.2.3.4', userAgent: 'ua' },
    );
    expect(out.tokens.accessToken).toBe('signed.jwt.token');
    // M-aud-H6: 4 dels — failKey, lockKey, globalFailKey, globalLockKey
    expect(h.redis.del).toHaveBeenCalledTimes(4);
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login', ipAddress: '1.2.3.4' }),
    );
  });

  it('triggers legacy rehash on successful login with a cost-10 hash (fire-and-forget)', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue({ id: 'tenant-1' } as never);
    vi.mocked(h.prisma.user.findUnique).mockResolvedValue(
      makeUser({ passwordHash: '$2b$10$legacyhash.value.padding...............' }) as never,
    );
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);
    vi.mocked(h.prisma.session.create).mockResolvedValue({ id: 'sess-1' } as never);
    vi.mocked(h.prisma.user.update).mockResolvedValue(makeUser() as never);
    await h.svc.login({ tenantSlug: 't', email: 'a@b.com', password: 'pw' } as never);
    // bcrypt.hash is called twice: once for the rehash, once in issueTokens path?
    // No — issueTokens doesn't hash the password. Only rehash does.
    // Flush the promise chain (.then on hash, then update).
    await Promise.resolve();
    await Promise.resolve();
    expect(bcrypt.hash).toHaveBeenCalled();
  });

  describe('2FA (TOTP) required', () => {
    const totpUser = makeUser({ totpEnabled: true, totpSecret: 'enc-secret' });

    it('throws TOTP_REQUIRED when 2FA is enabled and no code is supplied', async () => {
      const h = build();
      vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue({ id: 'tenant-1' } as never);
      vi.mocked(h.prisma.user.findUnique).mockResolvedValue(totpUser as never);
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);
      await expect(
        h.svc.login({ tenantSlug: 't', email: 'a@b.com', password: 'pw' } as never),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('accepts a valid TOTP code', async () => {
      const h = build();
      vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue({ id: 'tenant-1' } as never);
      vi.mocked(h.prisma.user.findUnique).mockResolvedValue(totpUser as never);
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);
      vi.mocked(h.totpSvc.verify).mockResolvedValueOnce(true as never);
      vi.mocked(h.prisma.session.create).mockResolvedValue({ id: 'sess-1' } as never);
      const out = await h.svc.login({
        tenantSlug: 't', email: 'a@b.com', password: 'pw', totpCode: '123456',
      } as never);
      expect(out.tokens.accessToken).toBe('signed.jwt.token');
    });

    it('falls back to a single-use backup code when TOTP fails', async () => {
      const h = build();
      // Match hashBackupCode's normalisation (trim + toLowerCase)
      const { createHash } = await import('node:crypto');
      const backup = 'abcd1234';
      const digest = createHash('sha256').update(backup).digest('hex');
      vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue({ id: 'tenant-1' } as never);
      vi.mocked(h.prisma.user.findUnique).mockResolvedValue(
        makeUser({ totpEnabled: true, totpSecret: 'enc', totpBackupCodes: [digest, 'other-digest'] }) as never,
      );
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);
      vi.mocked(h.totpSvc.verify).mockResolvedValueOnce(false as never);
      vi.mocked(h.prisma.user.update).mockResolvedValue(makeUser() as never);
      vi.mocked(h.prisma.session.create).mockResolvedValue({ id: 'sess-1' } as never);
      await h.svc.login({
        tenantSlug: 't', email: 'a@b.com', password: 'pw', totpCode: backup,
      } as never);
      // The consumed backup code hash must have been spliced out (one left)
      const updateArg = vi.mocked(h.prisma.user.update).mock.calls[0]![0] as unknown as {
        data: { totpBackupCodes: string[] };
      };
      expect(updateArg.data.totpBackupCodes).toEqual(['other-digest']);
      expect(h.audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.totp.backup_code_used' }),
      );
    });

    it('throws INVALID_TOTP when both the TOTP and backup codes fail', async () => {
      const h = build();
      vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue({ id: 'tenant-1' } as never);
      vi.mocked(h.prisma.user.findUnique).mockResolvedValue(
        makeUser({ totpEnabled: true, totpSecret: 'enc', totpBackupCodes: [] }) as never,
      );
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);
      vi.mocked(h.totpSvc.verify).mockResolvedValueOnce(false as never);
      await expect(
        h.svc.login({
          tenantSlug: 't', email: 'a@b.com', password: 'pw', totpCode: 'BADBAD',
        } as never),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  it('recordFailedAttempt promotes to a hard lockout once MAX_LOGIN_ATTEMPTS hit', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue(null);
    // Simulate 10 consecutive fails, last one crosses the threshold.
    vi.mocked(h.redis.incr).mockResolvedValueOnce(10 as never);
    await expect(
      h.svc.login({ tenantSlug: 'x', email: 'a@b.com', password: 'pw' } as never),
    ).rejects.toThrow(UnauthorizedException);
    // After crossing, both the lockout key was set AND the fail counter deleted.
    // M-aud-H6: 3 incrs — failKey (promotes to lockout), lockKey (set
    // by promotion), globalFailKey (the global counter increments on
    // every failure too; threshold is 3× higher so it doesn't promote here).
    expect(h.redis.incr).toHaveBeenCalledTimes(3);
    expect(h.redis.del).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// refresh
// ─────────────────────────────────────────────────────────────────────────

describe('AuthService.refresh', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws INVALID_REFRESH for missing session', async () => {
    const h = build();
    vi.mocked(h.prisma.session.findUnique).mockResolvedValue(null);
    await expect(
      h.svc.refresh({ refreshToken: 'rt' } as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws INVALID_REFRESH for a revoked session', async () => {
    const h = build();
    vi.mocked(h.prisma.session.findUnique).mockResolvedValue({
      id: 's', userId: 'u-1', refreshTokenHash: 'h',
      revokedAt: new Date('2020-01-01'), expiresAt: new Date('2099-01-01'),
    } as never);
    await expect(
      h.svc.refresh({ refreshToken: 'rt' } as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws INVALID_REFRESH for an expired session', async () => {
    const h = build();
    vi.mocked(h.prisma.session.findUnique).mockResolvedValue({
      id: 's', userId: 'u-1', refreshTokenHash: 'h',
      revokedAt: null, expiresAt: new Date('2000-01-01'),
    } as never);
    await expect(
      h.svc.refresh({ refreshToken: 'rt' } as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws INVALID_REFRESH when the owning user is gone / inactive', async () => {
    const h = build();
    vi.mocked(h.prisma.session.findUnique).mockResolvedValue({
      id: 's', userId: 'u-1', refreshTokenHash: 'h',
      revokedAt: null, expiresAt: new Date('2099-01-01'),
    } as never);
    vi.mocked(h.prisma.user.findUnique).mockResolvedValue(makeUser({ isActive: false }) as never);
    await expect(
      h.svc.refresh({ refreshToken: 'rt' } as never),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('happy path — revokes the old session + issues new tokens', async () => {
    const h = build();
    vi.mocked(h.prisma.session.findUnique).mockResolvedValue({
      id: 'sess-old', userId: 'u-1', refreshTokenHash: 'h',
      revokedAt: null, expiresAt: new Date('2099-01-01'),
    } as never);
    vi.mocked(h.prisma.user.findUnique).mockResolvedValue(makeUser() as never);
    vi.mocked(h.prisma.session.update).mockResolvedValue({ id: 'sess-old', revokedAt: new Date() } as never);
    vi.mocked(h.prisma.session.create).mockResolvedValue({ id: 'sess-new' } as never);
    const out = await h.svc.refresh({ refreshToken: 'rt' } as never);
    expect(out.tokens.accessToken).toBe('signed.jwt.token');
    expect(vi.mocked(h.prisma.session.update).mock.calls[0]![0]).toMatchObject({
      where: { id: 'sess-old' },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// logout + revokeAccessJti
// ─────────────────────────────────────────────────────────────────────────

describe('AuthService.logout', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is idempotent — swallows Prisma error when session row is missing', async () => {
    const h = build();
    vi.mocked(h.prisma.session.update).mockRejectedValue(new Error('P2025 not found'));
    await expect(h.svc.logout('rt')).resolves.toBeUndefined();
  });

  it('blocklists the access jti in Redis with a TTL up to the JWT exp', async () => {
    const h = build();
    vi.mocked(h.prisma.session.update).mockResolvedValue({} as never);
    const futureExp = Math.floor(Date.now() / 1000) + 900;
    await h.svc.logout('rt', 'jti-xyz', futureExp);
    const callArg = vi.mocked(h.redis.client.setex).mock.calls[0]!;
    expect(callArg[0]).toBe('auth:jwt:blocklist:jti-xyz');
    expect(callArg[1]).toBeGreaterThan(0);
    expect(callArg[1]).toBeLessThanOrEqual(900);
  });

  it('revokeAccessJti uses ttl=1 when exp is in the past (never sets 0 TTL)', async () => {
    const h = build();
    await h.svc.revokeAccessJti('jti-past', Math.floor(Date.now() / 1000) - 1000);
    expect(vi.mocked(h.redis.client.setex).mock.calls[0]![1]).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// me
// ─────────────────────────────────────────────────────────────────────────

describe('AuthService.me', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a SafeUser (no passwordHash) when the user exists', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findUnique).mockResolvedValue(makeUser() as never);
    const out = await h.svc.me('user-1');
    expect(out).not.toBeNull();
    expect(out).not.toHaveProperty('passwordHash');
    expect(out!.email).toBe('owner@example.com');
  });

  it('returns null for unknown userId', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findUnique).mockResolvedValue(null);
    const out = await h.svc.me('ghost');
    expect(out).toBeNull();
  });
});
