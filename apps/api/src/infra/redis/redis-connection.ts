import type { RedisOptions } from 'ioredis';
import IORedis from 'ioredis';
import { loadEnv } from '../../config/env';

/**
 * B-scaling: build an IORedis connection that transparently upgrades to
 * Sentinel mode when `REDIS_SENTINEL_HOSTS` + `REDIS_SENTINEL_MASTER` are set.
 * Falls back to the single-node `REDIS_URL` otherwise, preserving dev-mode
 * behaviour.
 *
 * Callers pass per-site overrides (e.g. BullMQ needs `maxRetriesPerRequest:
 * null`; the lockout client must NOT set that flag or blocking commands get
 * cancelled after 20 retries).
 */
export function buildRedisConnection(overrides: RedisOptions = {}): IORedis {
  const env = loadEnv();

  if (env.REDIS_SENTINEL_HOSTS && env.REDIS_SENTINEL_MASTER) {
    const sentinels = env.REDIS_SENTINEL_HOSTS.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((hostPort) => {
        const [host, port] = hostPort.split(':');
        if (!host || !port) {
          throw new Error(`REDIS_SENTINEL_HOSTS entry "${hostPort}" must be host:port`);
        }
        return { host, port: Number(port) };
      });
    if (sentinels.length === 0) {
      throw new Error('REDIS_SENTINEL_HOSTS set but empty after parse');
    }
    return new IORedis({
      sentinels,
      name: env.REDIS_SENTINEL_MASTER,
      sentinelPassword: env.REDIS_SENTINEL_PASSWORD,
      ...overrides,
    });
  }

  return new IORedis(env.REDIS_URL, overrides);
}
