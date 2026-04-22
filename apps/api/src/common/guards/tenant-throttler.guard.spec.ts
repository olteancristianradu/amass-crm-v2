import { describe, it, expect } from 'vitest';
import { TenantThrottlerGuard } from './tenant-throttler.guard';
import { tenantStorage } from '../../infra/prisma/tenant-context';
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';

/**
 * Subclass to expose the protected getTracker() — Nest only exposes it to
 * subclasses, which is exactly what we want to verify here.
 */
class ExposedGuard extends TenantThrottlerGuard {
  public trackerFor(req: Record<string, unknown>): Promise<string> {
    return this.getTracker(req);
  }
}

/**
 * Minimal stand-ins for the throttler wiring — getTracker() doesn't touch
 * storage or options, but the constructor requires them.
 */
function buildGuard(): ExposedGuard {
  const options: ThrottlerModuleOptions = { throttlers: [{ name: 'global', ttl: 1000, limit: 10 }] };
  const storage: ThrottlerStorage = {
    increment: () =>
      Promise.resolve({ totalHits: 1, timeToExpire: 1000, isBlocked: false, timeToBlockExpire: 0 }),
  };
  return new ExposedGuard(options, storage, new Reflector());
}

describe('TenantThrottlerGuard.getTracker', () => {
  it('keys by tenantId + userId when both are present', async () => {
    const guard = buildGuard();
    const result = await tenantStorage.run(
      { tenantId: 'cabc1234567890123456789abc', userId: 'cuser1234567890123456789abc' },
      () => guard.trackerFor({ ips: [], ip: '1.2.3.4' }),
    );
    expect(result).toBe('t:cabc1234567890123456789abc:u:cuser1234567890123456789abc');
  });

  it('keys by tenantId only when userId is absent (pre-auth slug lookups)', async () => {
    const guard = buildGuard();
    const result = await tenantStorage.run(
      { tenantId: 'cabc1234567890123456789abc' },
      () => guard.trackerFor({ ips: [], ip: '1.2.3.4' }),
    );
    expect(result).toBe('t:cabc1234567890123456789abc');
  });

  it('falls back to upstream (IP) when no tenant context is set', async () => {
    const guard = buildGuard();
    // No tenantStorage.run → getTenantContext() returns undefined.
    const result = await guard.trackerFor({ ips: [], ip: '9.8.7.6' });
    // Stock ThrottlerGuard derives the tracker from req.ip — anything starting
    // with an IP-like token is fine; the important part is that it is NOT the
    // tenant-prefixed form.
    expect(result).not.toMatch(/^t:/);
  });
});
