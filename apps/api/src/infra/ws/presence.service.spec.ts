import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PresenceService } from './presence.service';
import type { RedisService } from '../redis/redis.service';

/**
 * Unit tests for PresenceService. Backs the service with a tiny in-memory
 * Set/Map fake of the Redis surface it actually uses (sadd/srem/smembers/
 * expire/del + multi pipeline). That's enough to assert real behaviour
 * (TTL refresh, idempotent enter, cross-tenant isolation) without a real
 * Redis container.
 */

interface FakePipelineOp {
  cmd: 'sadd' | 'srem' | 'expire' | 'del';
  args: unknown[];
}

interface FakeStore {
  sets: Map<string, Set<string>>;
  expires: Map<string, number>;
}

function makeFakeRedis(): { redis: RedisService; store: FakeStore; expireCalls: Array<[string, number]> } {
  const store: FakeStore = {
    sets: new Map(),
    expires: new Map(),
  };
  const expireCalls: Array<[string, number]> = [];

  function sadd(key: string, ...members: string[]): number {
    const set = store.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added += 1;
      }
    }
    store.sets.set(key, set);
    return added;
  }

  function srem(key: string, ...members: string[]): number {
    const set = store.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const m of members) {
      if (set.delete(m)) removed += 1;
    }
    if (set.size === 0) store.sets.delete(key);
    return removed;
  }

  function smembers(key: string): string[] {
    const set = store.sets.get(key);
    return set ? Array.from(set) : [];
  }

  function expire(key: string, ttl: number): number {
    expireCalls.push([key, ttl]);
    store.expires.set(key, ttl);
    return store.sets.has(key) ? 1 : 0;
  }

  function del(key: string): number {
    const had = store.sets.delete(key);
    store.expires.delete(key);
    return had ? 1 : 0;
  }

  // multi() returns a chainable pipeline; .exec() runs every queued op.
  function multi(): {
    sadd: (k: string, ...m: string[]) => unknown;
    srem: (k: string, ...m: string[]) => unknown;
    expire: (k: string, ttl: number) => unknown;
    del: (k: string) => unknown;
    exec: () => Promise<unknown[]>;
  } {
    const ops: FakePipelineOp[] = [];
    const chain = {
      sadd(k: string, ...m: string[]) {
        ops.push({ cmd: 'sadd', args: [k, ...m] });
        return chain;
      },
      srem(k: string, ...m: string[]) {
        ops.push({ cmd: 'srem', args: [k, ...m] });
        return chain;
      },
      expire(k: string, ttl: number) {
        ops.push({ cmd: 'expire', args: [k, ttl] });
        return chain;
      },
      del(k: string) {
        ops.push({ cmd: 'del', args: [k] });
        return chain;
      },
      async exec() {
        const results: unknown[] = [];
        for (const op of ops) {
          switch (op.cmd) {
            case 'sadd':
              results.push([null, sadd(op.args[0] as string, ...(op.args.slice(1) as string[]))]);
              break;
            case 'srem':
              results.push([null, srem(op.args[0] as string, ...(op.args.slice(1) as string[]))]);
              break;
            case 'expire':
              results.push([null, expire(op.args[0] as string, op.args[1] as number)]);
              break;
            case 'del':
              results.push([null, del(op.args[0] as string)]);
              break;
          }
        }
        return results;
      },
    };
    return chain;
  }

  const redis = {
    client: {
      sadd: vi.fn(async (k: string, ...m: string[]) => sadd(k, ...m)),
      srem: vi.fn(async (k: string, ...m: string[]) => srem(k, ...m)),
      smembers: vi.fn(async (k: string) => smembers(k)),
      expire: vi.fn(async (k: string, ttl: number) => expire(k, ttl)),
      del: vi.fn(async (k: string) => del(k)),
      multi: vi.fn(() => multi()),
    },
  } as unknown as RedisService;

  return { redis, store, expireCalls };
}

describe('PresenceService', () => {
  let svc: PresenceService;
  let store: FakeStore;
  let expireCalls: Array<[string, number]>;

  beforeEach(() => {
    const fake = makeFakeRedis();
    svc = new PresenceService(fake.redis);
    store = fake.store;
    expireCalls = fake.expireCalls;
  });

  it('enter → list returns the userId', async () => {
    await svc.enter('tenant-A', 'company', 'co-1', 'user-1', 'sock-1');
    const viewers = await svc.list('tenant-A', 'company', 'co-1');
    expect(viewers).toEqual(['user-1']);
  });

  it('two users on the same resource → list returns both', async () => {
    await svc.enter('tenant-A', 'deal', 'd-1', 'user-1', 'sock-1');
    await svc.enter('tenant-A', 'deal', 'd-1', 'user-2', 'sock-2');
    const viewers = await svc.list('tenant-A', 'deal', 'd-1');
    expect(viewers.sort()).toEqual(['user-1', 'user-2']);
  });

  it('leave → list no longer contains that userId', async () => {
    await svc.enter('tenant-A', 'contact', 'c-1', 'user-1', 'sock-1');
    await svc.enter('tenant-A', 'contact', 'c-1', 'user-2', 'sock-2');

    await svc.leave('tenant-A', 'contact', 'c-1', 'user-1');

    const viewers = await svc.list('tenant-A', 'contact', 'c-1');
    expect(viewers).toEqual(['user-2']);
  });

  it('cleanupSocket → user removed from EVERY resource that socket was tracking', async () => {
    // One socket watching two resources at once (e.g. tabs of the same user).
    await svc.enter('tenant-A', 'company', 'co-1', 'user-1', 'sock-1');
    await svc.enter('tenant-A', 'deal', 'd-1', 'user-1', 'sock-1');
    // A different socket also watches one of them.
    await svc.enter('tenant-A', 'company', 'co-1', 'user-2', 'sock-2');

    const tracked = await svc.cleanupSocket('sock-1');

    // Both tracked resources surfaced in the return value (gateway uses
    // these to broadcast `presence:left`).
    expect(tracked).toHaveLength(2);
    expect(tracked.map((t) => t.resourceType).sort()).toEqual(['company', 'deal']);

    // user-1 is gone from both resources; user-2 still in company.
    expect(await svc.list('tenant-A', 'company', 'co-1')).toEqual(['user-2']);
    expect(await svc.list('tenant-A', 'deal', 'd-1')).toEqual([]);

    // Per-socket index key was dropped — calling cleanup again is a no-op.
    const second = await svc.cleanupSocket('sock-1');
    expect(second).toEqual([]);
  });

  it('TTL: enter sets EXPIRE 60s on both the resource key and the socket index', async () => {
    await svc.enter('tenant-A', 'company', 'co-1', 'user-1', 'sock-1');

    // Both the primary key and the secondary index get the 60s window.
    const ttls = expireCalls.filter(([, ttl]) => ttl === 60);
    expect(ttls.length).toBeGreaterThanOrEqual(2);
    const keys = ttls.map(([k]) => k);
    expect(keys).toContain('presence:tenant-A:company:co-1');
    expect(keys).toContain('presence:socket:sock-1');
  });

  it('TTL: re-enter refreshes the window (heartbeat path)', async () => {
    await svc.enter('tenant-A', 'company', 'co-1', 'user-1', 'sock-1');
    const initialCount = expireCalls.length;
    // Second call (the FE heartbeat) MUST re-issue EXPIRE so the key never
    // crosses the 60s edge while the user is still watching.
    await svc.enter('tenant-A', 'company', 'co-1', 'user-1', 'sock-1');
    expect(expireCalls.length).toBeGreaterThan(initialCount);
  });

  it('multi-tenant: enter under tenant A does NOT leak into tenant B list', async () => {
    await svc.enter('tenant-A', 'company', 'co-shared-id', 'user-1', 'sock-1');

    // Same resourceType + resourceId but a different tenant — MUST be
    // invisible. This is the WS-layer twin of the multi-tenant defense
    // in CLAUDE.md rule #3; the key prefix is what enforces it.
    const fromA = await svc.list('tenant-A', 'company', 'co-shared-id');
    const fromB = await svc.list('tenant-B', 'company', 'co-shared-id');

    expect(fromA).toEqual(['user-1']);
    expect(fromB).toEqual([]);
  });

  it('list on a non-existent resource returns empty array (no throw)', async () => {
    const viewers = await svc.list('tenant-A', 'company', 'does-not-exist');
    expect(viewers).toEqual([]);
  });

  it('leave on a non-existent membership is a no-op (does not throw)', async () => {
    await expect(
      svc.leave('tenant-A', 'company', 'co-1', 'never-joined-user'),
    ).resolves.not.toThrow();
    // Also: store remains clean.
    expect(store.sets.size).toBe(0);
  });
});
