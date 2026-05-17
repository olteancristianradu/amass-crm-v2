import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EmailTrackKind, EmailSuppressionReason, WebhookEvent } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { loadEnv } from '../../config/env';
import { AuditService } from '../audit/audit.service';
import { EmailSuppressionService } from '../email-suppression/email-suppression.service';
import { OutboxService } from '../../infra/outbox/outbox.service';

/**
 * Email open/click/unsubscribe/bounce tracking.
 *
 * Tracking endpoints are PUBLIC — they're hit by recipient mail clients,
 * who have no session. We look up the EmailMessage by id (using the
 * superuser connection, bypassing RLS), derive its tenantId, and write
 * the EmailTrack row inside that tenant context so RLS still enforces
 * cross-tenant isolation on the read side (reports, etc.).
 *
 * Per CLAUDE.md: GDPR-minded — we log IP + UA as "audit" data. Do NOT
 * store recipient-identifying strings in the tracking URL itself (they
 * would leak via email forwarding / client logs).
 *
 * Phase 1 (F1) additions:
 *  - Open-pixel HMAC: pixel URL now includes an HMAC signature so an
 *    attacker who knows a messageId cannot forge synthetic OPEN events
 *    to inflate engagement counters (T-MAIL-S-01).
 *  - Unsubscribe endpoint: HMAC-signed token redeemable at /e/u/<token>
 *    that records an UNSUBSCRIBE event and adds the recipient email to
 *    the suppression list (T-MAIL-E-02 + spec D9).
 *  - Bounce/spam recording: programmatic `recordBounce()` API for the
 *    eventual SMTP DSN parser / provider webhook; hard bounces auto-add
 *    the recipient to the suppression list with reason=BOUNCE_HARD.
 *  - GDPR PII purge: `purgePiiBatch()` nullifies ip_address + user_agent
 *    on rows older than 90 days and stamps pii_hashed_at (T-MAIL-I-01).
 *    Driven by a daily BullMQ cron at 03:00 Europe/Bucharest.
 */
@Injectable()
export class EmailTrackingService {
  private readonly logger = new Logger(EmailTrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Audit + suppression + outbox are OPTIONAL at construction time so
    // existing unit tests that build EmailTrackingService manually with
    // just the Prisma stub don't break. Production wiring always provides
    // them via EmailTrackingModule.
    private readonly audit?: AuditService,
    private readonly suppression?: EmailSuppressionService,
    private readonly outbox?: OutboxService,
  ) {}

  /**
   * Absolute base for tracking URLs. Falls back to TWILIO_WEBHOOK_BASE_URL
   * in dev — both point at the same public-reachable API host.
   */
  publicBaseUrl(): string | null {
    const env = loadEnv();
    const raw = env.PUBLIC_API_BASE_URL ?? env.TWILIO_WEBHOOK_BASE_URL ?? null;
    if (!raw) return null;
    // NestJS sets a global prefix of /api/v1 in main.ts — all our endpoints
    // live under that, including the tracking routes. Tolerate both cases
    // (host-only or host+/api/v1) so ops can set the env var either way.
    const trimmed = raw.replace(/\/$/, '');
    return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
  }

  /**
   * Rewrite outbound HTML to inject tracking. No-op if PUBLIC_API_BASE_URL
   * is unset — we refuse to inject relative URLs that would break delivery.
   *
   * - Appends a 1x1 tracking pixel (with HMAC sig) to the end of the body.
   * - Rewrites every `<a href="http(s)://…">` to pass through the click
   *   endpoint (already HMAC-signed). Anchors without a protocol
   *   (mailto:, tel:, #anchor) are left alone.
   * - Each click URL is signed with HMAC(JWT_SECRET, messageId|url) so an
   *   attacker who knows a messageId cannot craft `?u=https://phishing` and
   *   abuse the legitimate CRM domain for phishing (open redirect defense).
   * - The pixel URL is signed with HMAC(JWT_SECRET, messageId) so an
   *   attacker cannot synthesize fake opens by hitting `/open.gif` with a
   *   guessed messageId (T-MAIL-S-01 — engagement-counter spoofing).
   */
  injectTracking(messageId: string, html: string): string {
    const base = this.publicBaseUrl();
    if (!base) return html;

    // Rewrite http/https anchors
    const rewritten = html.replace(
      /<a\b([^>]*?)href=("|')(https?:\/\/[^"']+)\2([^>]*)>/gi,
      (_match, pre: string, quote: string, url: string, post: string) => {
        const sig = signTrackingUrl(messageId, url);
        const tracked = `${base}/e/t/${messageId}/click?u=${encodeURIComponent(url)}&s=${sig}`;
        return `<a${pre}href=${quote}${tracked}${quote}${post}>`;
      },
    );

    const openSig = signOpenToken(messageId);
    // Pixel URL: messageId stays in the path for backward-compat with the
    // existing route shape; `?s=` carries the HMAC signature that the
    // pixel endpoint now requires (under EMAIL_TRACKING_REQUIRE_SIG).
    const pixel = `<img src="${base}/e/t/${messageId}/open.gif?s=${openSig}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px" />`;
    return `${rewritten}\n${pixel}`;
  }

  /**
   * Build an unsubscribe URL pointed at the public `/e/u/<token>` endpoint.
   * The token encodes (messageId, recipientEmail) under an HMAC so the
   * endpoint can resolve which suppression to write without taking
   * recipientEmail as a query param (which would leak via forwards/logs).
   *
   * Caller (templates / sequence sender / campaign dispatcher) splices the
   * returned URL into the `List-Unsubscribe` header AND a visible footer link.
   */
  buildUnsubscribeUrl(messageId: string, recipientEmail: string): string | null {
    const base = this.publicBaseUrl();
    if (!base) return null;
    const token = encodeUnsubscribeToken(messageId, recipientEmail);
    return `${base}/e/u/${token}`;
  }

  /**
   * Record an OPEN event. Returns the 1x1 transparent GIF bytes regardless
   * of whether the message exists OR whether the signature verifies — this
   * keeps the pixel response indistinguishable, so a probing attacker can't
   * tell a real from a fake messageId. Drops the DB write silently when
   * the signature is missing/wrong.
   */
  async recordOpen(
    messageId: string,
    sig: string | null,
    ip: string | null,
    ua: string | null,
  ): Promise<Buffer> {
    const env = loadEnv();
    const requireSig = env.EMAIL_TRACKING_REQUIRE_SIG !== 'false';
    if (requireSig || sig) {
      if (!sig || !verifyOpenToken(messageId, sig)) {
        // Silent drop — return the same pixel bytes a legit hit returns.
        this.logger.warn(`Open pixel rejected: invalid signature for messageId=${messageId}`);
        return TRANSPARENT_GIF;
      }
    }

    try {
      // Open-pixel is PUBLIC (no session). Lookup is by id alone — the
      // signature check above already gates write-side access. We use
      // findUnique (bypass RLS) intentionally to resolve the tenantId of
      // the message owner, then enter that tenant's RLS context for the
      // write. NOT a cross-tenant breach: the messageId came from the
      // signed pixel URL we generated for the recipient.
      const message = await this.prisma.emailMessage.findUnique({
        where: { id: messageId },
        select: { id: true, tenantId: true },
      });
      if (message) {
        const inserted = await this.prisma.runWithTenant(message.tenantId, async (tx) => {
          // HIGH-1 (Phase 1.1, T-MAIL-S-02): partial unique index
          // (message_id, kind, ip_address, hourBucket) collapses Outlook
          // prefetch / Gmail proxy multi-hits within the same hour into
          // one tracked open. We swallow P2002 here so the response stays
          // indistinguishable to the probing attacker.
          try {
            await tx.emailTrack.create({
              data: {
                tenantId: message.tenantId,
                messageId: message.id,
                kind: EmailTrackKind.OPEN,
                ipAddress: ip,
                userAgent: ua,
              },
            });
          } catch (err) {
            if (isUniqueConstraintError(err)) {
              this.logger.debug(
                `dedup hit on OPEN (messageId=${message.id}) — ignoring duplicate`,
              );
              return false;
            }
            throw err;
          }
          // BLOCKER-3 (Phase 1.1): close the F1↔F3 loop — emit EMAIL_OPENED
          // to the outbox INSIDE the same tx as the EmailTrack write so a
          // committed open guarantees a committed event row (and vice versa).
          // Emit only when we actually inserted (skip dups so subscribers
          // don't get N copies of the same logical open).
          if (this.outbox) {
            await this.outbox.publish(
              WebhookEvent.EMAIL_OPENED,
              { messageId: message.id, occurredAt: new Date().toISOString() },
              { tx, aggregateType: 'EmailMessage', aggregateId: message.id },
            );
          }
          return true;
        });
        // Audit hook is fire-and-forget — never breaks the pixel response.
        // Only audit on actual insert (skip dups to keep log noise down).
        if (inserted && this.audit) {
          await this.audit.log({
            tenantId: message.tenantId,
            action: 'email.opened',
            subjectType: 'email_message',
            subjectId: message.id,
            metadata: { messageId: message.id },
          });
        }
      }
    } catch (err) {
      // Tracking must never break email delivery UX.
      this.logger.warn(`recordOpen failed: ${err instanceof Error ? err.message : err}`);
    }
    return TRANSPARENT_GIF;
  }

  /**
   * Record a CLICK event and return the target URL to redirect to.
   *
   * Validation order:
   *   1. URL has http(s) scheme (drop javascript:, data:, etc.)
   *   2. HMAC signature matches messageId|url combo (defeats open-redirect
   *      attacks where attacker crafts ?u=https://phishing.example with a
   *      legitimate messageId — without our secret they cannot forge sig).
   *   3. Message exists in DB.
   *
   * Returns null on any validation failure → caller serves 404.
   *
   * Backward compat: if env.EMAIL_TRACKING_REQUIRE_SIG is "false", links
   * sent before this defense was deployed (no `s=` param) are still
   * accepted. Default is strict (require sig).
   */
  async recordClick(
    messageId: string,
    targetUrl: string,
    sig: string | null,
    ip: string | null,
    ua: string | null,
  ): Promise<string | null> {
    if (!isSafeHttpUrl(targetUrl)) return null;

    const env = loadEnv();
    const requireSig = env.EMAIL_TRACKING_REQUIRE_SIG !== 'false';
    if (requireSig || sig) {
      if (!sig || !verifyTrackingSig(messageId, targetUrl, sig)) {
        this.logger.warn(`Click rejected: invalid signature for messageId=${messageId}`);
        return null;
      }
    }

    try {
      const message = await this.prisma.emailMessage.findUnique({
        where: { id: messageId },
        select: { id: true, tenantId: true },
      });
      if (!message) return null;
      const inserted = await this.prisma.runWithTenant(message.tenantId, async (tx) => {
        try {
          await tx.emailTrack.create({
            data: {
              tenantId: message.tenantId,
              messageId: message.id,
              kind: EmailTrackKind.CLICK,
              url: targetUrl,
              ipAddress: ip,
              userAgent: ua,
            },
          });
        } catch (err) {
          if (isUniqueConstraintError(err)) {
            // HIGH-1 (Phase 1.1) dedup hit. Same recipient clicked the same
            // tracked link within the same hour bucket from the same IP —
            // still redirect them, just don't double-count.
            this.logger.debug(
              `dedup hit on CLICK (messageId=${message.id}) — ignoring duplicate`,
            );
            return false;
          }
          throw err;
        }
        // BLOCKER-3 (Phase 1.1): emit EMAIL_CLICKED in same tx so the outbox
        // poller fans it out to webhook subscribers. URL included in payload
        // so subscribers can correlate click destinations. Only on insert
        // (skip dups so subscribers don't get N copies per logical click).
        if (this.outbox) {
          await this.outbox.publish(
            WebhookEvent.EMAIL_CLICKED,
            {
              messageId: message.id,
              url: targetUrl,
              occurredAt: new Date().toISOString(),
            },
            { tx, aggregateType: 'EmailMessage', aggregateId: message.id },
          );
        }
        return true;
      });
      if (inserted && this.audit) {
        await this.audit.log({
          tenantId: message.tenantId,
          action: 'email.clicked',
          subjectType: 'email_message',
          subjectId: message.id,
          metadata: { url: targetUrl },
        });
      }
      return targetUrl;
    } catch (err) {
      this.logger.warn(`recordClick failed: ${err instanceof Error ? err.message : err}`);
      return targetUrl; // still redirect — tracking failure shouldn't brick links
    }
  }

  /**
   * Record an UNSUBSCRIBE event from the public `/e/u/<token>` endpoint.
   *
   * Resolves (messageId, recipientEmail) from the HMAC token, then:
   *   1. Adds the email to the EmailSuppression list with reason=USER_UNSUBSCRIBE
   *   2. Writes an EmailTrack row kind=UNSUBSCRIBE
   *   3. Writes an audit event `email.unsubscribed`
   *
   * Returns the masked email (for the confirmation HTML) on success,
   * or null on any validation failure (caller serves 404). Idempotent:
   * re-redeeming the same token returns the same masked email and no-ops
   * the suppression upsert.
   */
  async recordUnsubscribe(token: string): Promise<{ emailMasked: string } | null> {
    const decoded = decodeUnsubscribeToken(token);
    if (!decoded) {
      this.logger.warn('Unsubscribe token failed HMAC verification');
      return null;
    }
    const { messageId, email } = decoded;

    try {
      const message = await this.prisma.emailMessage.findUnique({
        where: { id: messageId },
        select: { id: true, tenantId: true },
      });
      if (!message) return null;

      // Add to suppression list (idempotent via upsert in service).
      let masked = '';
      if (this.suppression) {
        const row = await this.suppression.addSystem(
          message.tenantId,
          email,
          EmailSuppressionReason.USER_UNSUBSCRIBE,
          'user:unsubscribe',
          `Unsubscribed via email link from message ${messageId}`,
        );
        masked = row.emailMasked;
      }

      // Record the UNSUBSCRIBE event for engagement reporting.
      await this.prisma.runWithTenant(message.tenantId, async (tx) => {
        await tx.emailTrack.create({
          data: {
            tenantId: message.tenantId,
            messageId: message.id,
            kind: EmailTrackKind.UNSUBSCRIBE,
          },
        });
        // BLOCKER-3 (Phase 1.1): emit EMAIL_UNSUBSCRIBED to outbox in same
        // tx. We do NOT include the raw recipient email in the payload —
        // only the masked form — because webhook payloads are forwarded to
        // third-party subscribers and the unsubscribe is a privacy signal
        // (T-MAIL-I-01 + GDPR data-minimization).
        if (this.outbox) {
          await this.outbox.publish(
            WebhookEvent.EMAIL_UNSUBSCRIBED,
            {
              messageId: message.id,
              emailMasked: masked || '****',
              occurredAt: new Date().toISOString(),
            },
            { tx, aggregateType: 'EmailMessage', aggregateId: message.id },
          );
        }
      });

      if (this.audit) {
        await this.audit.log({
          tenantId: message.tenantId,
          action: 'email.unsubscribed',
          subjectType: 'email_message',
          subjectId: message.id,
          metadata: { messageId, emailMasked: masked || '****' },
        });
      }

      return { emailMasked: masked || '****' };
    } catch (err) {
      this.logger.warn(`recordUnsubscribe failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * Record a BOUNCE event from an upstream SMTP DSN parser or provider
   * webhook (Mailgun/SendGrid/Postmark). This is the programmatic surface
   * — there is no public HTTP route for it; callers (future webhook
   * handler, future DSN reader) invoke directly with a verified payload.
   *
   * Hard bounces (`bounceType === 'hard'`) auto-add the recipient to the
   * suppression list with reason=BOUNCE_HARD. Soft bounces are recorded
   * but not suppressed (transient: mailbox full, greylisting, etc.).
   *
   * Caller passes tenantId explicitly because this runs outside an HTTP
   * request ALS context (webhook handlers typically resolve tenant from
   * the endpoint id).
   */
  async recordBounce(
    tenantId: string,
    recipientEmail: string,
    bounceType: 'hard' | 'soft' | 'block' | 'spam' | string,
    bounceCode: string | null,
    messageId: string | null,
  ): Promise<{ suppressed: boolean }> {
    try {
      await this.prisma.runWithTenant(tenantId, async (tx) => {
        await tx.emailTrack.create({
          data: {
            tenantId,
            messageId: messageId ?? null,
            // recipientId resolution happens upstream — webhook handlers
            // typically have access to a per-(campaign, email) row id.
            recipientId: null,
            kind: bounceType === 'spam' ? EmailTrackKind.SPAM_REPORT : EmailTrackKind.BOUNCE,
            bounceType,
            bounceCode,
          },
        });
        // BLOCKER-3 (Phase 1.1): emit EMAIL_BOUNCED / EMAIL_SPAM_REPORTED
        // to outbox in same tx. recipientEmail is included because the
        // subscriber explicitly needs to act on the bounce (e.g. remove
        // from their own list); the tenant opted in to receive bounces by
        // subscribing to this event type.
        if (this.outbox) {
          const evt = bounceType === 'spam'
            ? WebhookEvent.EMAIL_SPAM_REPORTED
            : WebhookEvent.EMAIL_BOUNCED;
          await this.outbox.publish(
            evt,
            {
              messageId: messageId ?? null,
              recipientEmail,
              bounceType,
              bounceCode,
              occurredAt: new Date().toISOString(),
            },
            { tx, aggregateType: 'EmailMessage', aggregateId: messageId ?? undefined },
          );
        }
      });
    } catch (err) {
      // Constraint violation expected if neither messageId nor recipientId
      // is supplied — we log loudly so the integration is fixed, but the
      // suppression below still runs.
      this.logger.warn(`recordBounce track insert failed: ${err instanceof Error ? err.message : err}`);
    }

    const isHard = bounceType === 'hard' || bounceType === 'spam' || bounceType === 'block';
    let suppressed = false;
    if (isHard && this.suppression) {
      const reason = bounceType === 'spam'
        ? EmailSuppressionReason.SPAM_REPORT
        : EmailSuppressionReason.BOUNCE_HARD;
      await this.suppression.addSystem(
        tenantId,
        recipientEmail,
        reason,
        `webhook:bounce:${bounceType}`,
        bounceCode ? `code=${bounceCode}` : undefined,
      );
      suppressed = true;
    }

    if (this.audit) {
      await this.audit.log({
        tenantId,
        action: bounceType === 'spam' ? 'email.spam_reported' : 'email.bounced',
        subjectType: 'email_message',
        subjectId: messageId ?? 'unknown',
        metadata: { bounceType, bounceCode, suppressed },
      });
    }

    return { suppressed };
  }

  /**
   * GDPR daily PII purge — nullifies ip_address + user_agent on email_tracks
   * rows older than `olderThanDays` whose pii_hashed_at is still NULL.
   *
   * Walks the partial index `email_tracks_pii_pending_idx` in `batchSize`-row
   * batches; returns the count purged in this call so the caller (cron) can
   * loop until zero. Uses `updateMany` with a date predicate so we don't
   * have to round-trip per row.
   *
   * Per-tenant audit lines (one per batch hit) are written via the audit
   * service so a privacy review can prove the purge ran.
   *
   * Returns 0 if there's nothing to purge (the cron then sleeps until next day).
   */
  async purgePiiBatch(olderThanDays = 90, batchSize = 1000): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);

    // Step 1: pick a batch of candidate rows. We can't combine "select ids
    // then update by ids" into one updateMany without losing batch control —
    // updateMany lacks LIMIT in Prisma. So we do a small select then update
    // by primary key set. The partial index makes the select cheap.
    const candidates = await this.prisma.emailTrack.findMany({
      where: {
        piiHashedAt: null,
        createdAt: { lt: cutoff },
        OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }],
      },
      select: { id: true, tenantId: true },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    if (candidates.length === 0) return 0;

    // Step 2: update them. We bypass tenant context (system job) and rely
    // on the primary-key predicate — but the update predicate itself does
    // NOT include `piiHashedAt: null`, so a concurrent purge from another
    // pod would harmlessly re-stamp the same rows. Acceptable.
    const ids = candidates.map((r) => r.id);
    const now = new Date();
    const updated = await this.prisma.emailTrack.updateMany({
      where: { id: { in: ids } },
      data: {
        ipAddress: null,
        userAgent: null,
        piiHashedAt: now,
      },
    });

    // Step 3: per-tenant audit so privacy reviews can prove this ran.
    if (this.audit) {
      // Bucket by tenantId so we emit one audit row per tenant per batch
      // rather than one per record.
      const byTenant = new Map<string, number>();
      for (const c of candidates) {
        byTenant.set(c.tenantId, (byTenant.get(c.tenantId) ?? 0) + 1);
      }
      for (const [tenantId, count] of byTenant) {
        await this.audit.log({
          tenantId,
          action: 'gdpr.pii.purged',
          subjectType: 'email_track',
          metadata: { count, olderThanDays, batchSize, purgedAt: now.toISOString() },
        });
      }
    }

    this.logger.log(`purgePiiBatch nullified ${updated.count} rows (cutoff=${cutoff.toISOString()})`);
    return updated.count;
  }

  /**
   * Summary stats for one message — authed callers only.
   *
   * CRIT-2 fix (Phase 1.1): previously this used `findUnique({id})` to
   * resolve the tenantId from the message itself, then called
   * `runWithTenant(message.tenantId, ...)` — meaning Tenant A could look up
   * the messageId of Tenant B and the service would silently run reads
   * inside Tenant B's RLS context. We now derive tenantId from the AUTHED
   * caller's context FIRST, scope the message lookup with an explicit
   * `tenantId` filter, and return 404 (not "stats from elsewhere") when the
   * message doesn't belong to the caller. CLAUDE.md rule #3 — defense in
   * depth: tenant filter + runWithTenant + RLS all aligned on caller ctx.
   */
  async statsForMessage(messageId: string): Promise<{ opens: number; clicks: number; lastOpenedAt: Date | null }> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const message = await tx.emailMessage.findFirst({
        where: { id: messageId, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!message) {
        throw new NotFoundException({ code: 'EMAIL_NOT_FOUND', message: 'Email message not found' });
      }
      const [opens, clicks, last] = await Promise.all([
        tx.emailTrack.count({
          where: { tenantId: ctx.tenantId, messageId, kind: 'OPEN' },
        }),
        tx.emailTrack.count({
          where: { tenantId: ctx.tenantId, messageId, kind: 'CLICK' },
        }),
        tx.emailTrack.findFirst({
          where: { tenantId: ctx.tenantId, messageId, kind: 'OPEN' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);
      return { opens, clicks, lastOpenedAt: last?.createdAt ?? null };
    });
  }
}

/**
 * 1x1 fully transparent GIF89a. Used as the invisible tracking pixel
 * — picked over PNG because GIF bytes are tiny (43) and every mail
 * client renders them without opt-in prompts.
 */
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

function isSafeHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Detect Prisma's unique-constraint violation (P2002) without importing
 * `Prisma.PrismaClientKnownRequestError` directly — the import is awkward in
 * tests that stub `PrismaService`. Duck-type by code field.
 */
function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code === 'P2002';
}

/**
 * Sign a tracking URL using HMAC-SHA256. Domain-separated by `email-track:`
 * prefix so the same JWT_SECRET used for tokens cannot collide. Output
 * truncated to 16 hex chars (64 bits) — sufficient for non-financial
 * authentication when combined with rate-limiting and the messageId namespace.
 */
export function signTrackingUrl(messageId: string, url: string): string {
  const env = loadEnv();
  return createHmac('sha256', env.JWT_SECRET)
    .update(`email-track:${messageId}|${url}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Constant-time signature verification. Both inputs MUST be hex of the same
 * length; otherwise we still run a comparison against a dummy value to keep
 * timing constant (defeats length-leak side channel).
 */
export function verifyTrackingSig(messageId: string, url: string, providedSig: string): boolean {
  const expected = signTrackingUrl(messageId, url);
  // Pad/truncate provided to expected length to ensure timingSafeEqual works
  // even on malformed input — without this, attacker could distinguish "wrong
  // length" from "wrong value" via response timing.
  const provided = providedSig.padEnd(expected.length, '0').slice(0, expected.length);
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Sign an open-pixel token (T-MAIL-S-01). Domain-separated by `email-open:`
 * so it cannot be confused with a click signature. 16 hex chars / 64 bits is
 * sufficient because the message-id namespace + rate limiting + low payoff
 * (one fake "open" per crafted hit) make brute force pointless.
 */
export function signOpenToken(messageId: string): string {
  const env = loadEnv();
  return createHmac('sha256', env.JWT_SECRET)
    .update(`email-open:${messageId}`)
    .digest('hex')
    .slice(0, 16);
}

export function verifyOpenToken(messageId: string, providedSig: string): boolean {
  const expected = signOpenToken(messageId);
  const provided = providedSig.padEnd(expected.length, '0').slice(0, expected.length);
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Unsubscribe token format: base64url("<messageId>:<emailLowercase>:<sig>")
 * where sig = HMAC-SHA256(JWT_SECRET, "email-unsub:" + messageId + "|" + email)
 * truncated to 16 hex chars.
 *
 * We embed the email directly (lowercased) so the public endpoint never
 * needs a query param — the URL is self-contained and the email leaks ONLY
 * via the same channel that already had it (the recipient's own inbox).
 * Base64url is used so the token is one path segment with no special chars.
 */
export function encodeUnsubscribeToken(messageId: string, email: string): string {
  const env = loadEnv();
  const normEmail = email.trim().toLowerCase();
  const sig = createHmac('sha256', env.JWT_SECRET)
    .update(`email-unsub:${messageId}|${normEmail}`)
    .digest('hex')
    .slice(0, 16);
  // ":" is fine inside the base64url payload — only the resulting base64url
  // chars (A-Za-z0-9_-) end up in the URL path segment.
  return Buffer.from(`${messageId}:${normEmail}:${sig}`, 'utf8').toString('base64url');
}

export function decodeUnsubscribeToken(token: string): { messageId: string; email: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  // Email local-parts CAN contain ":" (rare), so split from the right: the
  // last 2 colons are the structural separators; everything before is the
  // messageId, and we'll re-derive the email by joining the middle pieces.
  const parts = decoded.split(':');
  if (parts.length < 3) return null;
  const sig = parts[parts.length - 1];
  const messageId = parts[0];
  const email = parts.slice(1, -1).join(':');
  if (!messageId || !email || !sig) return null;

  const env = loadEnv();
  const expected = createHmac('sha256', env.JWT_SECRET)
    .update(`email-unsub:${messageId}|${email}`)
    .digest('hex')
    .slice(0, 16);
  const provided = sig.padEnd(expected.length, '0').slice(0, expected.length);
  try {
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'))) return null;
  } catch {
    return null;
  }
  return { messageId, email };
}
