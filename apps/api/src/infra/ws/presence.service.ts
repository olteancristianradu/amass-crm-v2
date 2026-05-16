import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/**
 * B1-PR4 — Redis-backed presence tracking for "someone else is viewing
 * this resource" indicators.
 *
 * Key shape:
 *   presence:<tenantId>:<resourceType>:<resourceId>   Set<userId>   TTL 60s
 *   presence:socket:<socketId>                        Set<keys>     TTL 60s
 *
 * Why Redis (and not in-memory)? The API will eventually run >1 replica
 * behind a sticky-session proxy — presence MUST be visible across replicas
 * or "Dana editează acest deal" silently breaks when Dana and Mihai hit
 * different pods. Redis is already a dependency (rate-limit, BullMQ,
 * auth lockouts), so this is zero new infrastructure.
 *
 * Why TTL 60s? A heartbeat from the FE refreshes the entry every ~30s
 * (well inside the window). If the browser tab crashes / network drops /
 * laptop goes to sleep, the entry self-expires within a minute — no zombie
 * "phantom watchers" forever stuck in the set.
 *
 * Why the secondary `presence:socket:*` index? When a socket disconnects
 * we need to remove THAT user from EVERY resource they were watching, but
 * the primary key shape is `resource → users`. The secondary index lets
 * `cleanupSocket(socketId)` find all resource keys to touch in O(1) lookup
 * plus O(N) deletes (N = resources this socket was watching, typically 1).
 *
 * Multi-tenant: tenantId is the first segment of every primary key. There
 * is no API surface that takes a tenantId from one caller and queries
 * another — the gateway always sources tenantId from the verified JWT
 * stored on `client.data.tenantId`. Cross-tenant leak is impossible by
 * construction; the .spec test asserts it explicitly.
 */
const PRESENCE_TTL_SECONDS = 60;

export interface TrackedResource {
  resourceType: string;
  resourceId: string;
  tenantId: string;
  userId: string;
}

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(private readonly redis: RedisService) {}

  private key(tenantId: string, resourceType: string, resourceId: string): string {
    return `presence:${tenantId}:${resourceType}:${resourceId}`;
  }

  private socketIndexKey(socketId: string): string {
    return `presence:socket:${socketId}`;
  }

  /**
   * Add `userId` to the presence set for this resource and refresh TTLs.
   * Also records the resource in the per-socket secondary index so a later
   * disconnect can find it.
   *
   * Idempotent: calling enter() twice with the same (resource, user) is a
   * no-op for set membership but refreshes the TTL — that's the heartbeat
   * path. Gateway calls this every time a `presence:enter` event lands.
   */
  async enter(
    tenantId: string,
    resourceType: string,
    resourceId: string,
    userId: string,
    socketId: string,
  ): Promise<void> {
    const resourceKey = this.key(tenantId, resourceType, resourceId);
    const socketKey = this.socketIndexKey(socketId);

    // SADD + EXPIRE in a pipeline so a single round-trip handles both.
    // Index value encodes everything cleanupSocket() needs to broadcast
    // a `presence:left` (without re-deriving from the resource key).
    const indexEntry = JSON.stringify({ tenantId, resourceType, resourceId, userId });

    const pipeline = this.redis.client.multi();
    pipeline.sadd(resourceKey, userId);
    pipeline.expire(resourceKey, PRESENCE_TTL_SECONDS);
    pipeline.sadd(socketKey, indexEntry);
    pipeline.expire(socketKey, PRESENCE_TTL_SECONDS);
    await pipeline.exec();
  }

  /**
   * Remove `userId` from the presence set for this resource. Safe to call
   * even if the user was never added — Redis SREM is idempotent.
   */
  async leave(
    tenantId: string,
    resourceType: string,
    resourceId: string,
    userId: string,
  ): Promise<void> {
    const resourceKey = this.key(tenantId, resourceType, resourceId);
    await this.redis.client.srem(resourceKey, userId);
  }

  /**
   * Return the current set of viewer userIds for this resource.
   * Empty array if the key doesn't exist (Redis SMEMBERS on a missing
   * key returns []).
   */
  async list(
    tenantId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<string[]> {
    const resourceKey = this.key(tenantId, resourceType, resourceId);
    const members = await this.redis.client.smembers(resourceKey);
    return members;
  }

  /**
   * On socket disconnect, remove the user from every resource they were
   * watching. Returns the list of (resource, userId) tuples that were
   * touched so the gateway can broadcast `presence:left` for each.
   *
   * Drops the per-socket index key at the end. If the index already
   * expired (TTL elapsed before disconnect), returns [] without error.
   */
  async cleanupSocket(socketId: string): Promise<TrackedResource[]> {
    const socketKey = this.socketIndexKey(socketId);
    const rawEntries = await this.redis.client.smembers(socketKey);
    if (rawEntries.length === 0) {
      return [];
    }

    const tracked: TrackedResource[] = [];
    for (const raw of rawEntries) {
      try {
        const parsed = JSON.parse(raw) as TrackedResource;
        if (
          typeof parsed.tenantId === 'string' &&
          typeof parsed.resourceType === 'string' &&
          typeof parsed.resourceId === 'string' &&
          typeof parsed.userId === 'string'
        ) {
          tracked.push(parsed);
        }
      } catch (err) {
        // Defensive: a corrupted/legacy index entry should not abort
        // the whole cleanup. Log + skip.
        this.logger.warn(
          `presence cleanup: skipping malformed index entry for socket=${socketId}: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      }
    }

    // Remove the user from every resource set, then drop the index key.
    const pipeline = this.redis.client.multi();
    for (const t of tracked) {
      pipeline.srem(this.key(t.tenantId, t.resourceType, t.resourceId), t.userId);
    }
    pipeline.del(socketKey);
    await pipeline.exec();

    return tracked;
  }
}
