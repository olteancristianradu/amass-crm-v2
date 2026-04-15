import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EmailTrackKind } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { loadEnv } from '../../config/env';

/**
 * Email open/click tracking.
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
 */
@Injectable()
export class EmailTrackingService {
  private readonly logger = new Logger(EmailTrackingService.name);

  constructor(private readonly prisma: PrismaService) {}

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
   * - Appends a 1x1 tracking pixel to the end of the body.
   * - Rewrites every `<a href="http(s)://…">` to pass through the click
   *   endpoint. Anchors without a protocol (mailto:, tel:, #anchor) are
   *   left alone.
   */
  injectTracking(messageId: string, html: string): string {
    const base = this.publicBaseUrl();
    if (!base) return html;

    // Rewrite http/https anchors
    const rewritten = html.replace(
      /<a\b([^>]*?)href=("|')(https?:\/\/[^"']+)\2([^>]*)>/gi,
      (_match, pre: string, quote: string, url: string, post: string) => {
        const tracked = `${base}/e/t/${messageId}/click?u=${encodeURIComponent(url)}`;
        return `<a${pre}href=${quote}${tracked}${quote}${post}>`;
      },
    );

    const pixel = `<img src="${base}/e/t/${messageId}/open.gif" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px" />`;
    return `${rewritten}\n${pixel}`;
  }

  /**
   * Record an OPEN event. Returns the 1x1 transparent GIF bytes regardless
   * of whether the message exists (avoids leaking valid-ID probing).
   */
  async recordOpen(messageId: string, ip: string | null, ua: string | null): Promise<Buffer> {
    try {
      const message = await this.prisma.emailMessage.findUnique({
        where: { id: messageId },
        select: { id: true, tenantId: true },
      });
      if (message) {
        await this.prisma.runWithTenant(message.tenantId, (tx) =>
          tx.emailTrack.create({
            data: {
              tenantId: message.tenantId,
              messageId: message.id,
              kind: EmailTrackKind.OPEN,
              ipAddress: ip,
              userAgent: ua,
            },
          }),
        );
      }
    } catch (err) {
      // Tracking must never break email delivery UX.
      this.logger.warn(`recordOpen failed: ${err instanceof Error ? err.message : err}`);
    }
    return TRANSPARENT_GIF;
  }

  /**
   * Record a CLICK event and return the target URL to redirect to.
   * If the message doesn't exist or the url is invalid, returns null
   * (caller responds 404).
   */
  async recordClick(
    messageId: string,
    targetUrl: string,
    ip: string | null,
    ua: string | null,
  ): Promise<string | null> {
    if (!isSafeHttpUrl(targetUrl)) return null;

    try {
      const message = await this.prisma.emailMessage.findUnique({
        where: { id: messageId },
        select: { id: true, tenantId: true },
      });
      if (!message) return null;
      await this.prisma.runWithTenant(message.tenantId, (tx) =>
        tx.emailTrack.create({
          data: {
            tenantId: message.tenantId,
            messageId: message.id,
            kind: EmailTrackKind.CLICK,
            url: targetUrl,
            ipAddress: ip,
            userAgent: ua,
          },
        }),
      );
      return targetUrl;
    } catch (err) {
      this.logger.warn(`recordClick failed: ${err instanceof Error ? err.message : err}`);
      return targetUrl; // still redirect — tracking failure shouldn't brick links
    }
  }

  /** Summary stats for one message — authed callers only. */
  async statsForMessage(messageId: string): Promise<{ opens: number; clicks: number; lastOpenedAt: Date | null }> {
    // Caller must already be in tenant context via JwtAuthGuard. We'll
    // rely on RLS to scope reads.
    const message = await this.prisma.emailMessage.findUnique({
      where: { id: messageId },
      select: { id: true, tenantId: true },
    });
    if (!message) {
      throw new NotFoundException({ code: 'EMAIL_NOT_FOUND', message: 'Email message not found' });
    }
    return this.prisma.runWithTenant(message.tenantId, async (tx) => {
      const [opens, clicks, last] = await Promise.all([
        tx.emailTrack.count({
          where: { tenantId: message.tenantId, messageId, kind: 'OPEN' },
        }),
        tx.emailTrack.count({
          where: { tenantId: message.tenantId, messageId, kind: 'CLICK' },
        }),
        tx.emailTrack.findFirst({
          where: { tenantId: message.tenantId, messageId, kind: 'OPEN' },
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
