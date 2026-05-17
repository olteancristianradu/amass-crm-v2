/**
 * Outbox poller (Phase 1 F3, T-WH-T-05).
 *
 * Wakes every 5s (via the repeatable job registered by OutboxScheduler) and
 * drains up to OUTBOX_BATCH_SIZE PENDING rows. Per row:
 *   1. Find all active WebhookEndpoint rows for the same tenant whose
 *      `events` array contains the row's eventType.
 *   2. Enqueue one job on the `webhook-delivery` queue per (endpoint, event)
 *      pair so a failure on endpoint A doesn't block delivery to endpoint B.
 *   3. Mark the outbox row PUBLISHED (or "no subscribers" — still PUBLISHED,
 *      we just emit no fan-out jobs).
 *   4. On any throw during enqueue, bump `attempts` and stash `lastError`;
 *      the row stays PENDING and the next tick retries it. A row that has
 *      tripped MAX_ATTEMPTS gets marked FAILED so the poller stops trying.
 *
 * Concurrency: 1 worker per replica, and the queue's repeatable job key
 * collapses to a single tick across the whole cluster. So at any moment
 * AT MOST one drainer is running — eliminates the "two drainers grab the
 * same row" race without needing SELECT ... FOR UPDATE SKIP LOCKED.
 *
 * Why we do not use SKIP LOCKED:
 *   - With ≤1 active drainer, locking gives us nothing.
 *   - The partial index `outbox_events_pending_idx` already keeps the scan
 *     cheap. Adding row-level locking would force the worker to keep a
 *     long-running tx open while it enqueues N BullMQ jobs.
 *   - When we DO want to scale to multiple drainers (Phase 1.6+), the move
 *     is `SELECT ... ORDER BY created_at LIMIT N FOR UPDATE SKIP LOCKED`
 *     inside the same tx, then mark PUBLISHED inside that tx after enqueue.
 */
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { OutboxEventStatus, Prisma, WebhookEvent } from '@prisma/client';
import { BusinessMetricsService } from '../metrics/business-metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_OUTBOX_POLL, QUEUE_WEBHOOK_DELIVERY } from '../queue/queue.constants';

export const OUTBOX_BATCH_SIZE = 100;
export const OUTBOX_MAX_ATTEMPTS = 10;
export const WEBHOOK_DELIVERY_JOB_NAME = 'deliver';

/**
 * Payload shape for a webhook-delivery job. Consumers must Zod-validate
 * before use (DTO discipline holds inside the worker boundary too).
 */
export interface WebhookDeliveryJob {
  outboxEventId: string;
  endpointId: string;
  tenantId: string;
  event: string;
  payload: Record<string, unknown>;
  /** RFC4122 UUID — sent as X-Amass-Idempotency-Key so receivers can dedupe. */
  idempotencyKey: string;
  /**
   * ISO timestamp of when the outbox row was inserted. Used inside the
   * signed payload and the X-Amass-Timestamp header for replay defense.
   */
  occurredAt: string;
}

@Processor(QUEUE_OUTBOX_POLL, {
  concurrency: 1,
  lockDuration: 30_000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
})
export class OutboxPoller extends WorkerHost {
  private readonly logger = new Logger(OutboxPoller.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_WEBHOOK_DELIVERY) private readonly deliveryQueue: Queue,
    private readonly metrics: BusinessMetricsService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'drain') {
      this.logger.warn(`Unknown job name on ${QUEUE_OUTBOX_POLL}: ${job.name}`);
      return;
    }

    // Pick up PENDING rows globally (no tenant filter — the poller is
    // platform-scoped). We bypass runWithTenant() because there is no
    // single tenant; the underlying $extends layer no-ops on missing ALS
    // context (verified in prisma.service.ts:298). Each row carries its
    // own tenantId so downstream processing stays scoped.
    const candidates = await this.prisma.outboxEvent.findMany({
      where: { status: OutboxEventStatus.PENDING, attempts: { lt: OUTBOX_MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: OUTBOX_BATCH_SIZE,
    });

    // HIGH-3 (Phase 1.1): filter out events whose tenant is currently
    // suspended/deactivated. We do this as a separate query (no Prisma
    // @relation between OutboxEvent and Tenant — adding one would force a
    // schema migration on a hot table). The query fetches only the unique
    // tenantIds in the batch and returns the active set; events for
    // inactive tenants are silently held back so a suspend can later be
    // reversed and the events delivered (instead of dropping them).
    //
    // Why "held back" not "dropped": tenant suspension is sometimes
    // operational (billing dispute under review). We don't want to lose
    // events forever just because the resolution takes a day.
    const rows = await this.filterActiveTenants(candidates);

    // Lag gauge — measured from the oldest row we just observed.
    if (rows.length > 0) {
      const oldest = rows[0]!.createdAt.getTime();
      this.metrics.setOutboxLagSeconds(Math.max(0, (Date.now() - oldest) / 1000));
    } else {
      // No backlog → report 0 lag (not NaN; Prometheus treats 0 as "fresh").
      this.metrics.setOutboxLagSeconds(0);
    }

    if (rows.length === 0) return;

    this.logger.debug(`outbox drain batch=${rows.length}`);

    for (const row of rows) {
      try {
        await this.dispatchOne(row);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`outbox row ${row.id} dispatch failed: ${msg}`);
        await this.markFailed(row.id, msg);
        this.metrics.recordOutboxProcessed('failed');
      }
    }
  }

  /**
   * Per-row work: find matching active endpoints, enqueue one delivery job
   * each, mark the row PUBLISHED. Runs OUTSIDE a transaction because the
   * BullMQ enqueue is a network call we don't want to hold a Postgres
   * connection open for. If we crash between the enqueue and the status
   * update, the row stays PENDING and the next tick re-enqueues —
   * deliveries are idempotent thanks to the deterministic jobId built from
   * (outboxEventId, endpointId).
   */
  private async dispatchOne(row: {
    id: string;
    tenantId: string;
    eventType: string;
    payload: Prisma.JsonValue;
    createdAt: Date;
  }): Promise<void> {
    // Validate eventType against the WebhookEvent enum — outbox column is a
    // free-form varchar (so we don't need a migration for every new enum
    // value), but only canonical values get delivered.
    if (!Object.values(WebhookEvent).includes(row.eventType as WebhookEvent)) {
      this.logger.warn(`outbox row ${row.id} has unknown eventType=${row.eventType} — marking PUBLISHED with no fan-out`);
      await this.markPublished(row.id);
      this.metrics.recordOutboxProcessed('skipped');
      return;
    }

    // Tenant-scoped read of matching endpoints. RLS + the extension stamp
    // tenantId on the where automatically when runWithTenant supplies ALS.
    const endpoints = await this.prisma.runWithTenant(row.tenantId, (tx) =>
      tx.webhookEndpoint.findMany({
        where: {
          tenantId: row.tenantId,
          isActive: true,
          events: { has: row.eventType as WebhookEvent },
        },
        select: { id: true },
      }),
    );

    if (endpoints.length === 0) {
      await this.markPublished(row.id);
      this.metrics.recordOutboxProcessed('skipped');
      return;
    }

    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const occurredAt = row.createdAt.toISOString();

    let enqueued = 0;
    for (const ep of endpoints) {
      const jobData: WebhookDeliveryJob = {
        outboxEventId: row.id,
        endpointId: ep.id,
        tenantId: row.tenantId,
        event: row.eventType,
        payload,
        idempotencyKey: `${row.id}::${ep.id}`,
        occurredAt,
      };
      await this.deliveryQueue.add(WEBHOOK_DELIVERY_JOB_NAME, jobData, {
        // Deterministic jobId → BullMQ dedup. If the poller crashes after
        // enqueue but before markPublished, the next tick re-enqueues with
        // the same jobId and BullMQ silently no-ops the duplicate.
        jobId: `${row.id}::${ep.id}`,
        attempts: 8,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      });
      enqueued++;
    }

    await this.markPublished(row.id);
    this.metrics.recordOutboxProcessed('published', enqueued);
  }

  /**
   * HIGH-3 (Phase 1.1): drop candidates whose tenant is inactive or
   * suspended. Returns the surviving rows in the original order so the
   * poller's "oldest first" lag-measurement still works on a representative
   * row.
   *
   * Single query over the distinct tenantIds in the batch — N+1 free.
   */
  private async filterActiveTenants<
    T extends { tenantId: string },
  >(candidates: T[]): Promise<T[]> {
    if (candidates.length === 0) return candidates;
    const tenantIds = Array.from(new Set(candidates.map((c) => c.tenantId)));
    const active = await this.prisma.tenant.findMany({
      where: { id: { in: tenantIds }, isActive: true, suspendedAt: null },
      select: { id: true },
    });
    const activeSet = new Set(active.map((t) => t.id));
    const surviving = candidates.filter((c) => activeSet.has(c.tenantId));
    const dropped = candidates.length - surviving.length;
    if (dropped > 0) {
      this.logger.warn(
        `outbox: held back ${dropped} event(s) for suspended/inactive tenants`,
      );
    }
    return surviving;
  }

  private async markPublished(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { status: OutboxEventStatus.PUBLISHED, publishedAt: new Date() },
    });
  }

  private async markFailed(id: string, lastError: string): Promise<void> {
    // Bump attempts. If we've hit MAX_ATTEMPTS, transition to FAILED so the
    // partial index stops returning the row (poller stops trying).
    const row = await this.prisma.outboxEvent.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        lastError: lastError.slice(0, 512),
      },
      select: { attempts: true },
    });
    if (row.attempts >= OUTBOX_MAX_ATTEMPTS) {
      await this.prisma.outboxEvent.update({
        where: { id },
        data: { status: OutboxEventStatus.FAILED },
      });
      this.logger.error(`outbox row ${id} exceeded MAX_ATTEMPTS=${OUTBOX_MAX_ATTEMPTS} — marked FAILED`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(`outbox-poll job ${job.id} failed: ${err.message}`);
  }
}
