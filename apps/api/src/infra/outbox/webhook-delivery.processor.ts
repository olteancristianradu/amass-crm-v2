/**
 * Webhook delivery worker (Phase 1 F3).
 *
 * Consumes jobs from the `webhook-delivery` queue (one per (outboxEventId,
 * endpointId) pair, enqueued by OutboxPoller). For each job:
 *
 *   1. Resolve the endpoint (tenant-scoped). If it was deleted between
 *      outbox publish and now, log + drop the job (no retry).
 *   2. Re-validate the URL (DNS rebinding defense — the attacker's DNS
 *      could have flipped to 127.0.0.1 since the create-time check).
 *   3. Decrypt the active secret (envelope) + the previous secret if the
 *      24h rotation grace window is still open.
 *   4. Build the signed body: `{event, tenantId, occurredAt, data}`.
 *   5. HMAC-SHA256 with the active secret → `v1=<hex>`.
 *      If previous secret present: ALSO HMAC with it → `v1prev=<hex>`.
 *      Combined into `X-Amass-Signature: t=<epoch>,v1=<...>,v1prev=<...>`
 *      so subscribers see both during grace and roll over their stored key.
 *   6. POST with pinned IP (defeats DNS rebinding). 10s hard timeout.
 *   7. Persist WebhookDelivery row regardless of outcome (response, attempt,
 *      duration, signature, idempotencyKey).
 *   8. On 410 Gone → auto-disable the endpoint (subscriber says "stop").
 *      On 2xx → success counters.
 *      On non-2xx → throw to trigger BullMQ exponential backoff.
 *
 * Idempotency contract: receivers MUST treat repeated requests with the
 * same `X-Amass-Idempotency-Key` as the same logical event. We send the
 * stable `{outboxEventId}::{endpointId}` as that key.
 */
import { createHmac } from 'node:crypto';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Job } from 'bullmq';
import { z } from 'zod';
import { EnvelopeService } from '../../common/crypto/envelope.service';
import { UrlValidatorService, type ValidatedUrl } from '../../common/ssrf/url-validator.service';
import { AuditService } from '../../modules/audit/audit.service';
import { BusinessMetricsService } from '../metrics/business-metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_WEBHOOK_DELIVERY } from '../queue/queue.constants';
import { WEBHOOK_DELIVERY_JOB_NAME, type WebhookDeliveryJob } from './outbox.poller';

const DeliveryJobSchema = z.object({
  outboxEventId: z.string().min(1),
  endpointId: z.string().min(1),
  tenantId: z.string().min(1),
  event: z.string().min(1),
  payload: z.record(z.unknown()),
  idempotencyKey: z.string().min(1),
  occurredAt: z.string().min(1),
});

const RESPONSE_BODY_CAP = 2000;
const REQUEST_TIMEOUT_MS = 10_000;
const CONSECUTIVE_FAILURE_DISABLE_THRESHOLD = 20;

@Processor(QUEUE_WEBHOOK_DELIVERY, {
  concurrency: 10,
  lockDuration: 30_000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
})
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly envelope: EnvelopeService,
    private readonly urlValidator: UrlValidatorService,
    private readonly metrics: BusinessMetricsService,
    // Phase 1.1 HIGH-2: audit on auto-disable + tenant deactivation skip.
    // Optional so existing processor unit tests stay compileable.
    private readonly audit?: AuditService,
  ) {
    super();
  }

  async process(job: Job<WebhookDeliveryJob>): Promise<void> {
    if (job.name !== WEBHOOK_DELIVERY_JOB_NAME) {
      this.logger.warn(`Unknown job name on ${QUEUE_WEBHOOK_DELIVERY}: ${job.name}`);
      return;
    }
    const data = DeliveryJobSchema.parse(job.data);

    // HIGH-3 (Phase 1.1): skip delivery if the tenant has been suspended /
    // deactivated between outbox publish and delivery time. Otherwise we
    // continue to leak business events for tenants that paid us to stop —
    // a compliance failure for the "kill switch" semantics of
    // tenant.isActive=false + tenant.suspendedAt. Fetch the tenant via
    // the system-scope client (no runWithTenant — we WANT to see the row
    // even if RLS would normally hide it).
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: data.tenantId },
      select: { id: true, isActive: true, suspendedAt: true },
    });
    if (!tenant || !tenant.isActive || tenant.suspendedAt !== null) {
      this.logger.warn(
        `webhook delivery skipped — tenant ${data.tenantId} inactive/suspended (event=${data.event}, endpointId=${data.endpointId})`,
      );
      if (this.audit) {
        await this.audit.log({
          tenantId: data.tenantId,
          action: 'webhook.delivery.skipped_tenant_inactive',
          subjectType: 'WebhookEndpoint',
          subjectId: data.endpointId,
          metadata: {
            event: data.event,
            outboxEventId: data.outboxEventId,
            tenantIsActive: tenant?.isActive ?? false,
            tenantSuspendedAt: tenant?.suspendedAt?.toISOString() ?? null,
          },
        });
      }
      // Terminal — don't retry. The next outbox poll will skip them too
      // (see outbox.poller.ts which now joins on tenant.isActive).
      return;
    }

    // Tenant-scoped endpoint fetch — re-read so we get the current secret
    // (rotation could have happened between outbox publish and delivery).
    const endpoint = await this.prisma.runWithTenant(data.tenantId, (tx) =>
      tx.webhookEndpoint.findFirst({
        where: { id: data.endpointId, tenantId: data.tenantId },
        select: {
          id: true,
          url: true,
          isActive: true,
          secret: true,
          secretEncrypted: true,
          secretKid: true,
          previousSecretEncrypted: true,
          previousSecretKid: true,
          previousSecretValidUntil: true,
          consecutiveFailures: true,
        },
      }),
    );

    if (!endpoint) {
      this.logger.warn(`webhook endpoint ${data.endpointId} missing — dropping delivery`);
      return; // no throw → job marks complete, not retried
    }
    if (!endpoint.isActive) {
      this.logger.debug(`webhook endpoint ${data.endpointId} inactive — skipping`);
      return;
    }

    // Decrypt the active secret. Prefer the encrypted column (Phase 1 dual
    // write); fall back to plaintext for pre-migration endpoints.
    const activeSecret = this.resolveSecret(
      endpoint.secret,
      endpoint.secretEncrypted,
      endpoint.secretKid,
    );

    // Previous secret only counts if we're still inside the 24h grace.
    let prevSecret: string | null = null;
    if (
      endpoint.previousSecretEncrypted &&
      endpoint.previousSecretKid &&
      endpoint.previousSecretValidUntil &&
      endpoint.previousSecretValidUntil > new Date()
    ) {
      try {
        prevSecret = this.envelope.decrypt(
          endpoint.previousSecretEncrypted,
          endpoint.previousSecretKid,
        );
      } catch (err) {
        // Decryption of the previous secret failing is non-fatal — we just
        // sign with the active one. Log so operators see KEK rotation drift.
        this.logger.warn(
          `previous-secret decrypt failed for endpoint ${endpoint.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      event: data.event,
      tenantId: data.tenantId,
      occurredAt: data.occurredAt,
      data: data.payload,
    });

    // T-WH-S-01: include timestamp in the signed material so a captured
    // request can't be replayed after the receiver's freshness window.
    const signed = `${timestamp}.${body}`;
    const v1 = createHmac('sha256', activeSecret).update(signed).digest('hex');
    const sigParts = [`t=${timestamp}`, `v1=${v1}`];
    if (prevSecret) {
      const v1prev = createHmac('sha256', prevSecret).update(signed).digest('hex');
      sigParts.push(`v1prev=${v1prev}`);
    }
    const signatureHeader = sigParts.join(',');

    // T-WH-S-02: re-validate URL at delivery time (DNS rebinding defense).
    let target: ValidatedUrl;
    try {
      target = await this.urlValidator.validateUrl(endpoint.url);
    } catch (err) {
      // SSRF gate tripped between create and delivery (DNS flipped, or the
      // operator added the host to deny-list). Auto-disable to stop the
      // retry storm + record the delivery as a dead letter.
      const msg = err instanceof Error ? err.message : String(err);
      await this.persistDelivery({
        endpointId: endpoint.id,
        tenantId: data.tenantId,
        event: data.event,
        payload: data.payload,
        statusCode: null,
        responseBody: `URL validation failed: ${msg}`,
        success: false,
        attempt: job.attemptsMade + 1,
        signature: signatureHeader,
        signatureKid: endpoint.secretKid ?? null,
        idempotencyKey: data.idempotencyKey,
        durationMs: 0,
        deadLetter: true,
      });
      await this.disableEndpoint(endpoint.id, `URL validation failed: ${msg}`.slice(0, 256));
      this.metrics.recordWebhookDelivery(data.event, 'dead_letter');
      return; // no throw — dead letter is terminal, don't retry
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Amass-Signature': signatureHeader,
      'X-Amass-Timestamp': String(timestamp),
      'X-Amass-Event': data.event,
      'X-Amass-Idempotency-Key': data.idempotencyKey,
      'X-Amass-Delivery-Attempt': String(job.attemptsMade + 1),
      'User-Agent': 'amass-webhooks/1.0',
    };

    const startedAt = Date.now();
    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let success = false;
    let networkErrorMsg: string | null = null;

    try {
      const res = await this.postJson(target, headers, body);
      statusCode = res.status;
      responseBody = res.text.slice(0, RESPONSE_BODY_CAP);
      success = res.ok;
    } catch (err) {
      networkErrorMsg = err instanceof Error ? err.message : String(err);
      responseBody = networkErrorMsg.slice(0, RESPONSE_BODY_CAP);
    }
    const durationMs = Date.now() - startedAt;

    const attemptsRemaining = (job.opts.attempts ?? 1) - (job.attemptsMade + 1);
    const isGone = statusCode === 410;
    const exhausted = !success && attemptsRemaining <= 0;
    const deadLetter = isGone || exhausted;

    await this.persistDelivery({
      endpointId: endpoint.id,
      tenantId: data.tenantId,
      event: data.event,
      payload: data.payload,
      statusCode,
      responseBody,
      success,
      attempt: job.attemptsMade + 1,
      signature: signatureHeader,
      signatureKid: endpoint.secretKid ?? null,
      idempotencyKey: data.idempotencyKey,
      durationMs,
      deadLetter,
    });

    if (success) {
      this.metrics.recordWebhookDelivery(data.event, 'success');
      await this.recordHealthy(endpoint.id);
      return;
    }

    // 410 Gone → subscriber asked to stop. Disable + dead-letter, no retry.
    if (isGone) {
      this.metrics.recordWebhookDelivery(data.event, 'dead_letter');
      await this.disableEndpoint(endpoint.id, 'Subscriber returned 410 Gone');
      return;
    }

    // Track consecutive failures. After threshold, auto-disable so we stop
    // hammering a broken subscriber for days.
    await this.recordFailure(endpoint.id);

    if (exhausted) {
      this.metrics.recordWebhookDelivery(data.event, 'dead_letter');
      return; // terminal, don't throw → BullMQ marks complete (delivery row already says deadLetter)
    }
    this.metrics.recordWebhookDelivery(data.event, 'retry');

    // Throw so BullMQ honours the configured attempts + backoff schedule.
    const reason = statusCode != null ? `HTTP ${statusCode}` : `network error: ${networkErrorMsg}`;
    throw new Error(`Webhook delivery to ${endpoint.id} failed: ${reason}`);
  }

  /** Read the active signing secret. Encrypted path preferred, plaintext fallback. */
  private resolveSecret(
    plaintext: string,
    encrypted: string | null,
    kid: string | null,
  ): string {
    if (encrypted && kid) {
      try {
        return this.envelope.decrypt(encrypted, kid);
      } catch (err) {
        this.logger.error(
          `envelope decrypt failed for endpoint, falling back to plaintext: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return plaintext;
  }

  private async persistDelivery(params: {
    endpointId: string;
    tenantId: string;
    event: string;
    payload: Record<string, unknown>;
    statusCode: number | null;
    responseBody: string | null;
    success: boolean;
    attempt: number;
    signature: string;
    signatureKid: string | null;
    idempotencyKey: string;
    durationMs: number;
    deadLetter: boolean;
  }): Promise<void> {
    await this.prisma.runWithTenant(params.tenantId, (tx) =>
      tx.webhookDelivery.create({
        data: {
          tenantId: params.tenantId,
          endpointId: params.endpointId,
          event: params.event,
          payload: params.payload as Prisma.InputJsonObject,
          statusCode: params.statusCode,
          responseBody: params.responseBody,
          success: params.success,
          attempt: params.attempt,
          signature: params.signature.slice(0, 256),
          signatureKid: params.signatureKid,
          idempotencyKey: params.idempotencyKey.slice(0, 128),
          durationMs: params.durationMs,
          deadLetter: params.deadLetter,
          completedAt: params.success || params.deadLetter ? new Date() : null,
        },
      }),
    );
  }

  private async recordHealthy(endpointId: string): Promise<void> {
    await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: {
        consecutiveFailures: 0,
        lastDeliveryAt: new Date(),
        lastSuccessAt: new Date(),
      },
    });
  }

  private async recordFailure(endpointId: string): Promise<void> {
    const row = await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: {
        consecutiveFailures: { increment: 1 },
        lastDeliveryAt: new Date(),
      },
      select: { consecutiveFailures: true },
    });
    if (row.consecutiveFailures >= CONSECUTIVE_FAILURE_DISABLE_THRESHOLD) {
      await this.disableEndpoint(
        endpointId,
        `Auto-disabled after ${row.consecutiveFailures} consecutive failures`,
      );
    }
  }

  private async disableEndpoint(endpointId: string, reason: string): Promise<void> {
    // Need the tenantId for the audit row — fetch first (system-scope so
    // we see the row regardless of RLS).
    const row = await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: {
        isActive: false,
        disabledAt: new Date(),
        disabledReason: reason.slice(0, 256),
      },
      select: { id: true, tenantId: true },
    });
    this.logger.warn(`webhook endpoint ${endpointId} auto-disabled: ${reason}`);
    // HIGH-2 (Phase 1.1): operators want a structured record of
    // auto-disables for the deliverability dashboard. Async / fire-and-
    // forget — failure to audit must not block the disable itself.
    if (this.audit) {
      await this.audit.log({
        tenantId: row.tenantId,
        action: 'webhook.endpoint.auto_disabled',
        subjectType: 'WebhookEndpoint',
        subjectId: endpointId,
        metadata: { reason: reason.slice(0, 256) },
      });
    }
  }

  /**
   * POST the body to the validated URL. When pinnedAddress is set we issue
   * the request via node:http/https with `hostname` = the resolved IP and
   * `Host` header = the original hostname, defeating DNS rebinding. When
   * pinned is absent (test env or trusted hosts) we use plain fetch().
   */
  private async postJson(
    target: ValidatedUrl,
    headers: Record<string, string>,
    body: string,
  ): Promise<{ status: number; ok: boolean; text: string }> {
    if (!target.pinnedAddress) {
      const res = await fetch(target.parsed.toString(), {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      });
      return { status: res.status, ok: res.ok, text: await res.text() };
    }

    const pinned = target.pinnedAddress;
    return new Promise((resolve, reject) => {
      const isHttps = target.parsed.protocol === 'https:';
      const requestFn = isHttps ? httpsRequest : httpRequest;
      const options: RequestOptions & { servername?: string } = {
        protocol: target.parsed.protocol,
        hostname: pinned.address,
        port: Number(target.parsed.port) || (isHttps ? 443 : 80),
        method: 'POST',
        path: `${target.parsed.pathname}${target.parsed.search}`,
        headers: {
          ...headers,
          Host: target.parsed.host,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: REQUEST_TIMEOUT_MS,
      };
      if (isHttps) options.servername = target.parsed.hostname;

      const req = requestFn(options, (res) => {
        const chunks: Buffer[] = [];
        let captured = 0;
        res.on('data', (chunk: Buffer | string) => {
          if (captured >= RESPONSE_BODY_CAP) return;
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const remaining = RESPONSE_BODY_CAP - captured;
          chunks.push(buf.subarray(0, remaining));
          captured += Math.min(buf.length, remaining);
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });
      req.on('timeout', () => req.destroy(new Error('Webhook request timed out')));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `webhook-delivery job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`,
    );
  }
}
