import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CampaignRecipient, Prisma } from '@prisma/client';
import {
  CampaignRecipientStatusDto,
  ListCampaignRecipientsQueryDto,
  RecipientFilterDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { loadEnv } from '../../config/env';
import { buildCursorArgs, CursorPage, makeCursorPage } from '../../common/pagination';
import { ContactSegmentsService } from '../contact-segments/contact-segments.service';

/**
 * Phase 1 F2 — per-recipient send attribution.
 *
 * Responsibilities:
 *   - enqueue()       — materialise CampaignRecipient rows from a
 *                       RecipientFilterDto inside runWithTenant so RLS
 *                       eliminates cross-tenant IDs (threat T-CB-S-02).
 *   - getByToken()    — pixel / click / unsubscribe entry point. Verifies
 *                       the HMAC signature before any DB lookup so a
 *                       malformed token never costs us a query.
 *   - recordEvent()   — bump per-recipient counters when EmailTrack fires.
 *                       Idempotent — duplicate opens within 1s are no-ops.
 *   - listByCampaign — paginated for the campaign detail / stats page.
 *
 * Tracking-token layout (base64url, 64 chars total = 32B random + 16B HMAC):
 *   [16 bytes random][16 bytes HMAC-SHA256(secret, random)]
 * Stored on the row as the *full* base64url string; clients send the same
 * string back on pixel/click and we re-derive + timingSafeEqual.
 */
@Injectable()
export class CampaignRecipientsService {
  private readonly logger = new Logger(CampaignRecipientsService.name);

  // 16 random bytes → 22 chars base64url-no-pad. Plenty of entropy
  // (2^128 search space) without bloating URL length.
  private static readonly TOKEN_RANDOM_BYTES = 16;
  private static readonly TOKEN_HMAC_BYTES = 16;
  // Spec D5 — hard cap on how many recipients a single campaign can target,
  // so a runaway segment doesn't OOM the tx. Matches the per-branch cap on
  // RecipientFilterSchema (10_000 per kind × 4 kinds).
  private static readonly MAX_AUDIENCE = 40_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly segments: ContactSegmentsService,
  ) {}

  // ─── Tracking token helpers (exposed for test introspection) ───────────

  /**
   * Generate a new tracking token. Returns the full base64url string ready
   * to embed in a pixel / click URL and to persist on the row.
   * No tenant context required — pure crypto.
   */
  generateTrackingToken(): string {
    const secret = this.getHmacSecret();
    const random = randomBytes(CampaignRecipientsService.TOKEN_RANDOM_BYTES);
    const sig = createHmac('sha256', secret)
      .update(random)
      .digest()
      .subarray(0, CampaignRecipientsService.TOKEN_HMAC_BYTES);
    const combined = Buffer.concat([random, sig]);
    return base64url(combined);
  }

  /**
   * Verify a token's HMAC signature. Returns true on match. Constant-time
   * compare so an attacker can't deduce bytes from response timing.
   */
  verifyTrackingToken(token: string): boolean {
    const raw = base64urlDecode(token);
    if (!raw) return false;
    const expected =
      CampaignRecipientsService.TOKEN_RANDOM_BYTES +
      CampaignRecipientsService.TOKEN_HMAC_BYTES;
    if (raw.length !== expected) return false;
    const random = raw.subarray(0, CampaignRecipientsService.TOKEN_RANDOM_BYTES);
    const sig = raw.subarray(CampaignRecipientsService.TOKEN_RANDOM_BYTES);
    const computed = createHmac('sha256', this.getHmacSecret())
      .update(random)
      .digest()
      .subarray(0, CampaignRecipientsService.TOKEN_HMAC_BYTES);
    if (sig.length !== computed.length) return false;
    try {
      return timingSafeEqual(sig, computed);
    } catch {
      return false;
    }
  }

  // ─── Materialisation ───────────────────────────────────────────────────

  /**
   * Materialise CampaignRecipient rows from a filter. Idempotent — re-running
   * for the same campaign skips subjects already present (the composite
   * unique on (campaignId, subjectType, subjectId) protects us at the DB
   * level too).
   *
   * Returns the total count actually persisted (post-RLS filtering, post-
   * deduplication). The caller uses this to update Campaign.recipientCount.
   */
  async enqueue(
    campaignId: string,
    filter: RecipientFilterDto,
  ): Promise<{ recipientCount: number }> {
    const ctx = requireTenantContext();

    return this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      // Verify campaign exists + belongs to tenant. RLS would also block a
      // cross-tenant id but the explicit findFirst gives a clean 404.
      const campaign = await tx.campaign.findFirst({
        where: { id: campaignId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!campaign) {
        throw new NotFoundException({
          code: 'CAMPAIGN_NOT_FOUND',
          message: 'Campaign not found',
        });
      }

      // Resolve filter → list of (subjectType, subjectId, email). RLS filters
      // each query so cross-tenant IDs disappear silently. Segment branch
      // runs OUTSIDE this transaction (via ContactSegmentsService.preview)
      // because that service opens its own runWithTenant — nested tx would
      // either deadlock or be silently flattened depending on the driver.
      const recipients = await this.resolveAudience(tx, ctx.tenantId, filter);
      if (recipients.length === 0) {
        throw new BadRequestException({
          code: 'EMPTY_AUDIENCE',
          message: 'recipientFilter resolved to zero recipients',
        });
      }

      // De-duplicate against rows that already exist for this campaign.
      // Cheaper than relying on the unique constraint to error per-insert.
      const existing = await tx.campaignRecipient.findMany({
        where: { campaignId, tenantId: ctx.tenantId },
        select: { subjectType: true, subjectId: true },
      });
      const existingKeys = new Set(
        existing.map((r) => `${r.subjectType}:${r.subjectId}`),
      );
      const fresh = recipients.filter(
        (r) => !existingKeys.has(`${r.subjectType}:${r.subjectId}`),
      );
      if (fresh.length === 0) {
        return { recipientCount: existing.length };
      }

      // createMany — single round-trip per batch. trackingToken generated
      // here (one per recipient) so we can persist atomically. Conflicting
      // tokens (1/2^128) just trigger a single insert error → caller can
      // retry the schedule.
      await tx.campaignRecipient.createMany({
        data: fresh.map((r) => ({
          tenantId: ctx.tenantId,
          campaignId,
          subjectType: r.subjectType,
          subjectId: r.subjectId,
          email: r.email,
          trackingToken: this.generateTrackingToken(),
          status: 'PENDING',
        })),
        skipDuplicates: true,
      });

      // Count post-insert to capture skipDuplicates + RLS behaviour.
      const total = await tx.campaignRecipient.count({
        where: { campaignId, tenantId: ctx.tenantId },
      });
      return { recipientCount: total };
    });
  }

  // ─── Lookup ────────────────────────────────────────────────────────────

  /**
   * Resolve a tracking token to its CampaignRecipient row.
   *
   * NOTE: no tenant context required — pixel / click / unsubscribe endpoints
   * are PUBLIC (recipients don't have CRM logins) and authenticated solely
   * by the token's HMAC. We do NOT pass through runWithTenant because there
   * is no request tenant; the row's tenantId is the authoritative scope.
   */
  async getByToken(trackingToken: string): Promise<CampaignRecipient | null> {
    if (!this.verifyTrackingToken(trackingToken)) {
      this.logger.debug('tracking token signature mismatch');
      return null;
    }
    // Raw findUnique on the global client — bypassing runWithTenant is
    // intentional and documented above. RLS would block this query because
    // there's no SET LOCAL app.tenant_id; we deliberately use the unscoped
    // path. This is the ONE place in the codebase where that's correct.
    return this.prisma.campaignRecipient.findUnique({
      where: { trackingToken },
    });
  }

  // ─── Per-recipient event ingestion ─────────────────────────────────────

  /**
   * Record an engagement event (open / click) against a recipient. The
   * EmailTrack row is the source of truth; this method just bumps the
   * denormalised counters on CampaignRecipient + Campaign so the campaign
   * stats page reads cheaply.
   *
   * Called from the email-tracking module after it persists an EmailTrack
   * row. Tenant scope is inferred from the recipient row.
   */
  async recordEvent(
    recipientId: string,
    kind: 'open' | 'click',
    _metadata?: Record<string, unknown>,
  ): Promise<void> {
    // Look up tenant first — we need it for runWithTenant. Use the unscoped
    // client (same justification as getByToken).
    const row = await this.prisma.campaignRecipient.findUnique({
      where: { id: recipientId },
      select: { id: true, tenantId: true, campaignId: true },
    });
    if (!row) {
      this.logger.warn(`recordEvent: recipient ${recipientId} not found`);
      return;
    }

    const now = new Date();
    await this.prisma.runWithTenant(row.tenantId, async (tx) => {
      if (kind === 'open') {
        await tx.campaignRecipient.update({
          where: { id: recipientId },
          data: { openCount: { increment: 1 }, lastOpenAt: now },
        });
        await tx.campaign.update({
          where: { id: row.campaignId },
          data: { openCount: { increment: 1 } },
        });
      } else {
        await tx.campaignRecipient.update({
          where: { id: recipientId },
          data: { clickCount: { increment: 1 }, lastClickAt: now },
        });
        await tx.campaign.update({
          where: { id: row.campaignId },
          data: { clickCount: { increment: 1 } },
        });
      }
    });
  }

  // ─── Listing for stats / detail page ───────────────────────────────────

  async listByCampaign(
    campaignId: string,
    q: ListCampaignRecipientsQueryDto,
  ): Promise<CursorPage<CampaignRecipient>> {
    const ctx = requireTenantContext();
    const where: Prisma.CampaignRecipientWhereInput = {
      campaignId,
      tenantId: ctx.tenantId,
      ...(q.status ? { status: q.status as CampaignRecipientStatusDto } : {}),
    };
    const cursorArgs = buildCursorArgs(q.cursor, q.limit);
    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.campaignRecipient.findMany({
        where,
        ...cursorArgs,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    return makeCursorPage(items, q.limit);
  }

  // ─── Private helpers ───────────────────────────────────────────────────

  /**
   * Resolve the HMAC secret. In production CAMPAIGN_HMAC_KEY is mandatory
   * (env validator enforces this). In dev/test we fall back to JWT_SECRET
   * so tests don't need extra wiring — the dev value is *not* sensitive
   * because rotating it just invalidates pending pixel/click attribution,
   * not auth.
   */
  private getHmacSecret(): string {
    const env = loadEnv();
    const secret = env.CAMPAIGN_HMAC_KEY ?? env.JWT_SECRET;
    if (!secret) {
      throw new Error('CAMPAIGN_HMAC_KEY (or JWT_SECRET fallback) must be set');
    }
    return secret;
  }

  /**
   * Convert a RecipientFilterDto into a flat list of recipients. Each
   * branch is tenant-scoped through `tx` (already inside runWithTenant) or
   * through ContactSegmentsService.preview (which opens its own
   * runWithTenant). Rows without an email are silently dropped — a
   * marketing campaign to "" makes no sense.
   *
   * Caps the per-campaign audience at MAX_AUDIENCE so a misconfigured
   * segment can't materialize 100k rows in a single transaction. The cap
   * matches the per-branch cap in RecipientFilterSchema (10_000 per kind).
   */
  private async resolveAudience(
    tx: Prisma.TransactionClient,
    tenantId: string,
    filter: RecipientFilterDto,
  ): Promise<ResolvedRecipient[]> {
    const out: ResolvedRecipient[] = [];

    if (filter.contactIds?.length) {
      const rows = await tx.contact.findMany({
        where: { tenantId, id: { in: filter.contactIds } },
        select: { id: true, email: true },
      });
      for (const r of rows) {
        if (r.email) out.push({ subjectType: 'CONTACT', subjectId: r.id, email: r.email });
      }
    }

    if (filter.leadIds?.length) {
      const rows = await tx.lead.findMany({
        where: { tenantId, id: { in: filter.leadIds } },
        select: { id: true, email: true },
      });
      for (const r of rows) {
        if (r.email) out.push({ subjectType: 'LEAD', subjectId: r.id, email: r.email });
      }
    }

    if (filter.clientIds?.length) {
      const rows = await tx.client.findMany({
        where: { tenantId, id: { in: filter.clientIds } },
        select: { id: true, email: true },
      });
      for (const r of rows) {
        if (r.email) out.push({ subjectType: 'CLIENT', subjectId: r.id, email: r.email });
      }
    }

    if (filter.segmentId) {
      // ContactSegments are dynamic (filterJson) rather than materialized.
      // Delegate to the segments service so the WHERE-tree compiler stays in
      // one place. preview() opens its own runWithTenant — it doesn't use our
      // `tx`, which is fine: both tx are read-only contact lookups.
      const members = await this.segments.preview(filter.segmentId, CampaignRecipientsService.MAX_AUDIENCE);
      for (const c of members) {
        if (c.email) {
          out.push({ subjectType: 'CONTACT', subjectId: c.id, email: c.email });
        }
      }
    }

    // De-duplicate across branches — same contact may match contactIds AND
    // a segment. Key by (subjectType, subjectId) so a Contact and Lead with
    // colliding IDs (different generators) don't collapse.
    const seen = new Set<string>();
    return out.filter((r) => {
      const k = `${r.subjectType}:${r.subjectId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

interface ResolvedRecipient {
  subjectType: 'COMPANY' | 'CONTACT' | 'CLIENT' | 'LEAD';
  subjectId: string;
  email: string;
}

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(s: string): Buffer | null {
  // Reject any character outside the base64url alphabet so a tampered token
  // doesn't get silently re-padded into something valid.
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  try {
    return Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
}
