import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import IORedis from 'ioredis';
import { buildRedisConnection } from './redis-connection';

/**
 * Thin Redis wrapper for non-BullMQ use-cases (lockout, caching, sessions).
 * BullMQ has its own connection (queue.module.ts) with maxRetriesPerRequest:null —
 * that flag must NOT be set here or blocking commands will abort after 20 retries.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: IORedis;

  constructor() {
    this.client = buildRedisConnection({ lazyConnect: true });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  /** Increment a counter and set TTL (seconds) on first creation. Returns new count. */
  async incr(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.expire(key, ttlSeconds);
    }
    return count;
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }
}
