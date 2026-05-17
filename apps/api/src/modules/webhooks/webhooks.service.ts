/**
 * Outbound webhooks — tenants register HTTPS endpoints to receive CRM events.
 *
 * Phase 1 F3 refactor (recovery):
 *   - SSRF URL validation moved to UrlValidatorService (common/ssrf) so SIEM
 *     forwarder + any future outbound HTTP feature reuses the same blocklist
 *     (includes Azure IMDS 168.63.129.16, *.amass-crm.com platform apex,
 *     *.cluster.local/internal/consul, operator deny-list).
 *   - Webhook signing secret is dual-written: legacy plaintext `secret` column
 *     stays for the 30-day migration window, AND `secretEncrypted` + `secretKid`
 *     hold the EnvelopeService-wrapped value. Read path prefers encrypted.
 *   - Rotate now MOVES the active envelope-wrapped secret into
 *     `previousSecretEncrypted` + `previousSecretValidUntil = now+24h`, so the
 *     delivery worker signs with BOTH active+previous during grace
 *     (T-WH-T-03 — subscribers can roll over without dropping events).
 *   - `dispatch()` no longer fires HTTP inline. It publishes to OutboxService
 *     within whatever transaction the caller provides; the BullMQ poller
 *     handles fan-out + retries (T-WH-T-05).
 *
 * Signature scheme (T-WH-S-01, sent by the delivery worker):
 *   X-Amass-Signature: t=<epoch>,v1=<hex>[,v1prev=<hex>]
 *   X-Amass-Timestamp: <epoch>
 *   X-Amass-Idempotency-Key: <outboxEventId>::<endpointId>
 *
 *   Subscribers MUST reject requests where t is older than ~5min (replay defense).
 */
import { randomBytes } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, WebhookEvent } from '@prisma/client';
import { EnvelopeService } from '../../common/crypto/envelope.service';
import { UrlValidatorService } from '../../common/ssrf/url-validator.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { AuditService } from '../audit/audit.service';

// Re-exported from the SSRF helper so legacy importers stay compiling.
export { isPrivateOrReservedIp } from '../../common/ssrf/url-validator.service';

export interface CreateWebhookEndpointDto {
  url: string;
  events: WebhookEvent[];
}

export interface UpdateWebhookEndpointDto {
  url?: string;
  events?: WebhookEvent[];
  isActive?: boolean;
}

const PUBLIC_ENDPOINT_SELECT = {
  id: true,
  url: true,
  events: true,
  isActive: true,
  createdAt: true,
} as const;

/**
 * 24-hour grace window for old secret after rotation. Wide enough that a
 * subscriber on a once-a-day deploy cadence won't drop events; short enough
 * that a leaked secret stops being valid quickly.
 */
const SECRET_ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly urlValidator: UrlValidatorService,
    private readonly envelope: EnvelopeService,
    private readonly outbox: OutboxService,
    // HIGH-2 (Phase 1.1): every endpoint mutation now writes an audit row
    // (created/updated/deleted/secret_rotated/auto_disabled). Optional ctor
    // arg so existing unit tests building WebhooksService positional still
    // compile; production wiring injects via WebhooksModule.
    private readonly audit?: AuditService,
  ) {}

  async create(dto: CreateWebhookEndpointDto) {
    await this.urlValidator.validateUrl(dto.url);
    const { tenantId } = requireTenantContext();
    const secret = randomBytes(24).toString('hex');
    const wrapped = this.envelope.encrypt(secret);

    const created = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.webhookEndpoint.create({
        data: {
          tenantId,
          url: dto.url,
          // Dual-write: legacy plaintext kept additively for 30d migration
          // window (Phase 1.6 cleanup drops the column).
          secret,
          secretEncrypted: wrapped.ciphertext,
          secretKid: wrapped.kid,
          events: { set: dto.events },
        },
        select: { id: true, url: true, events: true, isActive: true, createdAt: true, secret: true },
      }),
    );
    if (this.audit) {
      await this.audit.log({
        action: 'webhook.endpoint.created',
        subjectType: 'WebhookEndpoint',
        subjectId: created.id,
        // No secret in audit metadata — operators see it via the
        // create-response (returned exactly once) and via rotation. The
        // audit row should never let a forensic dump leak the signing key.
        metadata: { url: created.url, events: dto.events, secretKid: wrapped.kid },
      });
    }
    return created;
  }

  async list() {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.webhookEndpoint.findMany({
        where: { tenantId },
        select: { id: true, url: true, events: true, isActive: true, createdAt: true },
      }),
    );
  }

  async get(id: string) {
    const { tenantId } = requireTenantContext();
    const ep = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.webhookEndpoint.findFirst({
        where: { id, tenantId },
        select: PUBLIC_ENDPOINT_SELECT,
      }),
    );
    if (!ep) throw new NotFoundException('Webhook endpoint not found');
    return ep;
  }

  async update(id: string, dto: UpdateWebhookEndpointDto) {
    await this.get(id);
    if (dto.url !== undefined) await this.urlValidator.validateUrl(dto.url);
    const { tenantId } = requireTenantContext();
    const updated = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.webhookEndpoint.update({
        where: { id },
        data: {
          ...(dto.url !== undefined ? { url: dto.url } : {}),
          ...(dto.events !== undefined ? { events: { set: dto.events } } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        select: PUBLIC_ENDPOINT_SELECT,
      }),
    );
    if (this.audit) {
      await this.audit.log({
        action: 'webhook.endpoint.updated',
        subjectType: 'WebhookEndpoint',
        subjectId: id,
        // Object.keys(dto) captures which fields the client actually
        // touched — useful for "who toggled isActive" forensics.
        metadata: { fields: Object.keys(dto), newUrl: dto.url, newIsActive: dto.isActive },
      });
    }
    return updated;
  }

  async delete(id: string) {
    const { tenantId } = requireTenantContext();
    const before = await this.get(id);
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.webhookEndpoint.delete({ where: { id } }),
    );
    if (this.audit) {
      await this.audit.log({
        action: 'webhook.endpoint.deleted',
        subjectType: 'WebhookEndpoint',
        subjectId: id,
        metadata: { url: before.url, events: before.events },
      });
    }
  }

  /**
   * SEC-008 + T-WH-T-03: webhook secret rotation with 24h grace.
   *
   * Flow:
   *   1. Generate new secret (24 random bytes → 48 hex chars).
   *   2. Encrypt with envelope.
   *   3. MOVE current encrypted secret + kid into `previousSecret*` columns
   *      and set `previousSecretValidUntil = now + 24h`. During the window
   *      the delivery worker signs each payload with BOTH active and previous,
   *      so subscribers can swap their stored key without dropping events.
   *   4. Persist new secret (dual-write: plaintext + encrypted).
   *   5. Return the new plaintext exactly once — never returned by read endpoints.
   */
  async rotateSecret(id: string): Promise<{ id: string; secret: string; rotatedAt: Date }> {
    const { tenantId } = requireTenantContext();
    // Read the current row (incl. encrypted columns) so we can demote it.
    const current = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.webhookEndpoint.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          secret: true,
          secretEncrypted: true,
          secretKid: true,
        },
      }),
    );
    if (!current) throw new NotFoundException('Webhook endpoint not found');

    const newSecret = randomBytes(24).toString('hex');
    const wrappedNew = this.envelope.encrypt(newSecret);
    const rotatedAt = new Date();
    const graceUntil = new Date(rotatedAt.getTime() + SECRET_ROTATION_GRACE_MS);

    // If the current row already has an encrypted secret, demote it to
    // previous. If not (pre-migration row that only has plaintext), wrap the
    // plaintext now so the grace window still works.
    const previousCiphertext =
      current.secretEncrypted ?? this.envelope.encrypt(current.secret).ciphertext;
    const previousKid = current.secretKid ?? wrappedNew.kid;

    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.webhookEndpoint.update({
        where: { id },
        data: {
          secret: newSecret,
          secretEncrypted: wrappedNew.ciphertext,
          secretKid: wrappedNew.kid,
          previousSecretEncrypted: previousCiphertext,
          previousSecretKid: previousKid,
          previousSecretValidUntil: graceUntil,
        },
        select: { id: true },
      }),
    );
    this.logger.warn(
      `Webhook secret rotated for endpoint ${id} (tenant ${tenantId}) — grace until ${graceUntil.toISOString()}`,
    );
    if (this.audit) {
      await this.audit.log({
        action: 'webhook.endpoint.secret_rotated',
        subjectType: 'WebhookEndpoint',
        subjectId: id,
        // NEVER include the new plaintext secret in audit metadata.
        // Caller sees it once in the HTTP response; that's the contract.
        metadata: {
          newKid: wrappedNew.kid,
          previousKid: previousKid,
          graceUntil: graceUntil.toISOString(),
        },
      });
    }
    return { id, secret: newSecret, rotatedAt };
  }

  async listDeliveries(endpointId: string) {
    await this.get(endpointId);
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.webhookDelivery.findMany({
        where: { endpointId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }

  /**
   * Publish an event to the outbox so the BullMQ poller can fan it out.
   * REQUIRES a Prisma transaction (the outbox row must share the commit
   * with the business write — that's the whole point of the pattern).
   *
   * Callers that already have a transaction (e.g. inside `runWithTenant`)
   * pass `tx` directly. For legacy callers that previously used the
   * fire-and-forget `dispatch(tenantId, event, payload)` we offer the
   * backward-compatible shim {@link dispatchLegacy} below — but new code
   * MUST use this transactional API.
   */
  async publishEvent(
    event: WebhookEvent,
    payload: Record<string, unknown>,
    opts: {
      tx: Prisma.TransactionClient;
      aggregateType?: string;
      aggregateId?: string;
    },
  ): Promise<string> {
    return this.outbox.publish(event, payload, opts);
  }

  /**
   * Backward-compatible shim for legacy call sites that fired
   * dispatch(tenantId, event, payload) without a transaction.
   *
   * Opens its own short transaction to write the outbox row; this loses
   * the atomicity guarantee with the business write (the original code
   * didn't have it either — it was a literal `Promise.allSettled` fan-out
   * AFTER the write committed), but the poller still gives us retries +
   * persistence which the old code lacked.
   *
   * New code should NOT use this — migrate to {@link publishEvent} with
   * a shared `tx`. Marked deprecated to surface the migration work.
   *
   * @deprecated Use publishEvent inside the same tx as the business write.
   */
  dispatch(tenantId: string, event: WebhookEvent, payload: Record<string, unknown>): void {
    this.publishLegacy(tenantId, event, payload).catch((err) =>
      this.logger.error(
        `dispatch (legacy) failed for ${event} on tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  private async publishLegacy(
    tenantId: string,
    event: WebhookEvent,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.runWithTenant(tenantId, (tx) =>
      this.outbox.publish(event, payload, { tx }),
    );
  }
}
