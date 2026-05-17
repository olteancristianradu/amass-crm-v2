/**
 * Outbox pattern publisher (Phase 1 F3, T-WH-T-05).
 *
 * Why we need this:
 *   - webhooks.service.ts:160 used `Promise.allSettled(endpoints.map(...))`
 *     to fan out webhook deliveries inline. If the API restarted between the
 *     business write and the inline POST, the receiver never saw the event —
 *     no retry, no replay, no audit. Classic at-most-once with no upper
 *     bound on how lossy that is during a deploy.
 *   - Outbox table is INSERTed in the SAME Prisma transaction as the
 *     business write. Atomicity guarantees: if the row commits, the outbox
 *     row commits; if the row rolls back, the outbox row rolls back. No
 *     event without a business state change, no business state change
 *     without an event.
 *   - A separate BullMQ poller drains PENDING rows every 5s, enqueues one
 *     job per matching webhook subscription (so failure on endpoint A
 *     doesn't block endpoint B), and marks the row PUBLISHED on enqueue
 *     success.
 *
 * Usage from a feature service (campaigns, deals, invoices, …):
 *   ```ts
 *   await this.prisma.runWithTenant(tenantId, async (tx) => {
 *     const deal = await tx.deal.create({ ... });
 *     await this.outbox.publish('DEAL_CREATED', { id: deal.id, ... }, {
 *       aggregateType: 'Deal',
 *       aggregateId: deal.id,
 *       tx, // SAME transaction — atomicity
 *     });
 *     return deal;
 *   });
 *   ```
 *
 * The `tx` parameter is REQUIRED — calling publish() without a transaction
 * is a hard error because the whole point of the pattern is the shared
 * commit boundary. (Tests can bypass this with the internal `publishStandalone`
 * helper — never use that in production code.)
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WebhookEvent } from '@prisma/client';
import { requireTenantContext } from '../prisma/tenant-context';

export interface OutboxPublishOptions {
  /** Optional aggregate context — used by the FE/audit "where did this come from". */
  aggregateType?: string;
  aggregateId?: string;
  /** REQUIRED — the Prisma tx from the business write so we share the commit. */
  tx: Prisma.TransactionClient;
}

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  /**
   * Insert an outbox row in the caller's transaction. Returns the new row's
   * id so the caller can correlate logs (the poller will use it later as the
   * X-Amass-Idempotency-Key value).
   *
   * tenantId is pulled from ALS (requireTenantContext) — runWithTenant
   * guarantees an ALS context exists for the txn lifetime, so this works
   * even on the SCIM bearer path that bypasses TenantContextMiddleware.
   */
  async publish(
    eventType: WebhookEvent | string,
    payload: Record<string, unknown>,
    opts: OutboxPublishOptions,
  ): Promise<string> {
    if (!opts.tx) {
      throw new Error('OutboxService.publish: tx is required (outbox must share business commit)');
    }
    const { tenantId } = requireTenantContext();

    const row = await opts.tx.outboxEvent.create({
      data: {
        tenantId,
        eventType: String(eventType),
        aggregateType: opts.aggregateType ?? null,
        aggregateId: opts.aggregateId ?? null,
        payload: payload as Prisma.InputJsonObject,
        // status defaults to PENDING per schema.
      },
      select: { id: true },
    });

    this.logger.debug(
      `outbox publish id=${row.id} event=${eventType} tenant=${tenantId} aggregate=${opts.aggregateType ?? '-'}:${opts.aggregateId ?? '-'}`,
    );
    return row.id;
  }
}
