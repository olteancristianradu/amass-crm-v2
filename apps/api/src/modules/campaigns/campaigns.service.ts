import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Campaign, Prisma } from '@prisma/client';
import {
  CreateCampaignDto,
  ListCampaignsQueryDto,
  RecipientFilterDto,
  ScheduleCampaignDto,
  SendTestCampaignDto,
  UpdateCampaignDto,
} from '@amass/shared';
import { buildCursorArgs, CursorPage, makeCursorPage } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { RedisService } from '../../infra/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { QUEUE_CAMPAIGN_DISPATCH } from '../../infra/queue/queue.constants';
import { CampaignRecipientsService } from '../campaign-recipients/campaign-recipients.service';

/**
 * Phase 1 F2 — campaign builder. Extends the S58 CRUD scaffold with:
 *   - sendTest()    — single-recipient preview send (rate-limited 5/h per
 *                     [campaign, user], threat D7).
 *   - schedule()    — materialises CampaignRecipient rows + enqueues a
 *                     delayed BullMQ job for dispatch.
 *   - cancel() / pause() / resume() — lifecycle transitions that also
 *                     manage the delayed BullMQ job.
 *
 * All public methods run inside runWithTenant() so the tenantExtension +
 * RLS layers (CLAUDE.md rule #3) enforce isolation even if a caller forgets
 * the explicit `where: { tenantId }`.
 */
@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);
  // Spec D7: max 5 send-test per (campaignId, userId) per hour. The 3600s
  // window is set by the Redis TTL on the first INCR — see RedisService.
  private static readonly SEND_TEST_LIMIT_PER_HOUR = 5;
  private static readonly SEND_TEST_TTL_SECONDS = 3600;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    // CampaignRecipientsService and CampaignsService depend on each other
    // transitively via the dispatch processor — `forwardRef` breaks the cycle
    // at Nest's DI graph build time.
    @Inject(forwardRef(() => CampaignRecipientsService))
    private readonly recipients: CampaignRecipientsService,
    @InjectQueue(QUEUE_CAMPAIGN_DISPATCH) private readonly dispatchQueue: Queue,
  ) {}

  /**
   * Transitions a DRAFT or PAUSED campaign into ACTIVE.
   * Called from the API directly or from the workflow engine's SEND_CAMPAIGN
   * action. Idempotent for ACTIVE state. Throws if campaign missing or
   * already COMPLETED (terminal).
   */
  async launch(campaignId: string, tenantId: string): Promise<Campaign> {
    const existing = await this.prisma.campaign.findFirst({
      where: { id: campaignId, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'CAMPAIGN_NOT_FOUND', message: 'Campaign not found' });
    }
    if (existing.status === 'COMPLETED') {
      this.logger.warn('Cannot launch completed campaign %s', campaignId);
      return existing;
    }
    if (existing.status === 'ACTIVE') return existing;
    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'ACTIVE', startDate: existing.startDate ?? new Date() },
    });
  }

  async create(dto: CreateCampaignDto): Promise<Campaign> {
    const ctx = requireTenantContext();
    const created = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.campaign.create({
        data: {
          tenantId: ctx.tenantId,
          name: dto.name,
          description: dto.description ?? null,
          channel: dto.channel,
          segmentId: dto.segmentId ?? null,
          startDate: dto.startDate ?? null,
          endDate: dto.endDate ?? null,
          budget: dto.budget ? new Prisma.Decimal(dto.budget) : null,
          currency: dto.currency,
          targetCount: dto.targetCount,
          createdById: ctx.userId ?? null,
          // Phase 1 builder envelope
          subject: dto.subject ?? null,
          fromName: dto.fromName ?? null,
          fromAddress: dto.fromAddress ?? null,
          replyTo: dto.replyTo ?? null,
          previewText: dto.previewText ?? null,
          templateJson: dto.templateJson ? (dto.templateJson as object) : Prisma.JsonNull,
          scheduledAt: dto.scheduledAt ?? null,
          recipientFilter: dto.recipientFilter
            ? (dto.recipientFilter as object)
            : Prisma.JsonNull,
        },
      }),
    );
    await this.audit.log({
      action: 'campaign.created',
      subjectType: 'Campaign',
      subjectId: created.id,
      metadata: { name: created.name, channel: created.channel },
    });
    return created;
  }

  async findAll(q: ListCampaignsQueryDto): Promise<CursorPage<Campaign>> {
    const ctx = requireTenantContext();
    const where: Prisma.CampaignWhereInput = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.channel ? { channel: q.channel } : {}),
    };
    const cursorArgs = buildCursorArgs(q.cursor, q.limit);
    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.campaign.findMany({ where, ...cursorArgs, orderBy: { createdAt: 'desc' } }),
    );
    return makeCursorPage(items, q.limit);
  }

  async findOne(id: string): Promise<Campaign> {
    const ctx = requireTenantContext();
    const c = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.campaign.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } }),
    );
    if (!c) {
      throw new NotFoundException({ code: 'CAMPAIGN_NOT_FOUND', message: 'Campaign not found' });
    }
    return c;
  }

  async update(id: string, dto: UpdateCampaignDto): Promise<Campaign> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    const data: Prisma.CampaignUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
      ...(dto.segmentId !== undefined ? { segmentId: dto.segmentId } : {}),
      ...(dto.startDate !== undefined ? { startDate: dto.startDate } : {}),
      ...(dto.endDate !== undefined ? { endDate: dto.endDate } : {}),
      ...(dto.budget !== undefined
        ? { budget: dto.budget ? new Prisma.Decimal(dto.budget) : null }
        : {}),
      ...(dto.targetCount !== undefined ? { targetCount: dto.targetCount } : {}),
      ...(dto.sentCount !== undefined ? { sentCount: dto.sentCount } : {}),
      ...(dto.conversions !== undefined ? { conversions: dto.conversions } : {}),
      ...(dto.revenue !== undefined ? { revenue: new Prisma.Decimal(dto.revenue) } : {}),
      // Phase 1 envelope
      ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
      ...(dto.fromName !== undefined ? { fromName: dto.fromName } : {}),
      ...(dto.fromAddress !== undefined ? { fromAddress: dto.fromAddress } : {}),
      ...(dto.replyTo !== undefined ? { replyTo: dto.replyTo } : {}),
      ...(dto.previewText !== undefined ? { previewText: dto.previewText } : {}),
      ...(dto.templateJson !== undefined
        ? { templateJson: dto.templateJson as Prisma.InputJsonValue }
        : {}),
      ...(dto.scheduledAt !== undefined ? { scheduledAt: dto.scheduledAt } : {}),
      ...(dto.recipientFilter !== undefined
        ? { recipientFilter: dto.recipientFilter as Prisma.InputJsonValue }
        : {}),
    };
    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.campaign.update({ where: { id }, data }),
    );
    await this.audit.log({
      action: 'campaign.updated',
      subjectType: 'Campaign',
      subjectId: id,
      metadata: { fields: Object.keys(data) },
    });
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.campaign.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    await this.audit.log({
      action: 'campaign.deleted',
      subjectType: 'Campaign',
      subjectId: id,
    });
  }

  // ─── Phase 1 F2 — send-test, schedule, lifecycle ──────────────────────

  /**
   * Send a single test email to `dto.email` using the campaign's template.
   *
   * Rate-limited per (campaignId, userId) at 5/hour (spec D7). The Redis
   * counter key includes both campaign + user so different users can each
   * have their own 5-test budget against the same campaign.
   *
   * Does NOT increment campaign counters or create a CampaignRecipient row —
   * test sends are deliberately invisible in stats so the dashboard reflects
   * only real recipient behaviour.
   */
  async sendTest(id: string, dto: SendTestCampaignDto): Promise<{ messageId: string | null }> {
    const ctx = requireTenantContext();
    if (!ctx.userId) {
      throw new BadRequestException({
        code: 'AUTH_REQUIRED',
        message: 'send-test requires an authenticated user',
      });
    }
    const campaign = await this.findOne(id);

    // Completeness check — template + subject + fromAddress mandatory.
    const missing: string[] = [];
    if (!campaign.templateJson) missing.push('templateJson');
    if (!campaign.subject) missing.push('subject');
    if (!campaign.fromAddress) missing.push('fromAddress');
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'CAMPAIGN_INCOMPLETE',
        message: `Cannot send test — missing required fields: ${missing.join(', ')}`,
        details: { missing },
      });
    }

    // Per-hour rate-limit. Bucket the key by floor(epochSec/3600) so the
    // window is wall-clock aligned and the TTL stays bounded even if the
    // first increment happens late in the hour.
    const hourBucket = Math.floor(Date.now() / 1000 / 3600);
    const key = `campaign:test:${id}:${ctx.userId}:${hourBucket}`;
    const count = await this.redis.incr(key, CampaignsService.SEND_TEST_TTL_SECONDS);
    if (count > CampaignsService.SEND_TEST_LIMIT_PER_HOUR) {
      const ttl = await this.redis.ttl(key);
      throw new BadRequestException({
        code: 'TOO_MANY_REQUESTS',
        message: `Max ${CampaignsService.SEND_TEST_LIMIT_PER_HOUR} test sends per campaign per hour`,
        details: { retryAfter: Math.max(ttl, 1) },
      });
    }

    // Render template + interpolate placeholders. For test sends we use
    // bracketed placeholders ([firstName]) since there's no real recipient
    // context. The actual HTML renderer is a follow-up — phase-1 spec §F2.1
    // ships render-on-send for the batch path; for the test path we ship a
    // minimal renderer that emits each block as a <div>.
    const html = renderTestPreview(campaign.templateJson as TemplateJsonRuntime, campaign.name);
    const text = stripHtml(html);

    const msg = await this.email.sendTransactional(ctx.tenantId, {
      to: dto.email,
      subject: `[TEST] ${campaign.subject as string}`,
      bodyHtml: html,
      bodyText: text,
      subjectType: 'CONTACT',
      subjectId: id, // attribute test mail to the campaign id for traceability
    });

    await this.audit.log({
      action: 'campaign.test_sent',
      subjectType: 'Campaign',
      subjectId: id,
      metadata: { to: dto.email, messageId: msg?.id ?? null },
    });

    return { messageId: msg?.id ?? null };
  }

  /**
   * Move a campaign to SCHEDULED, materialise the CampaignRecipient rows
   * from the stored recipientFilter, and enqueue a delayed BullMQ job that
   * the dispatcher will pick up at scheduledAt.
   *
   * Idempotent against re-scheduling: any existing delayed job with the
   * same jobId is removed before the new one is added.
   */
  async schedule(id: string, dto: ScheduleCampaignDto): Promise<Campaign> {
    const ctx = requireTenantContext();
    const campaign = await this.findOne(id);

    const missing: string[] = [];
    if (!campaign.templateJson) missing.push('templateJson');
    if (!campaign.subject) missing.push('subject');
    if (!campaign.fromAddress) missing.push('fromAddress');
    if (!campaign.recipientFilter) missing.push('recipientFilter');
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'CAMPAIGN_INCOMPLETE',
        message: `Cannot schedule — missing required fields: ${missing.join(', ')}`,
        details: { missing },
      });
    }
    if (campaign.status === 'COMPLETED' || campaign.status === 'CANCELLED') {
      throw new BadRequestException({
        code: 'CAMPAIGN_TERMINAL',
        message: `Cannot schedule a ${campaign.status} campaign`,
      });
    }

    // Materialise audience BEFORE flipping status — if it fails (e.g. zero
    // valid recipients after RLS filter) the campaign stays in DRAFT and
    // the UI surfaces the error.
    const { recipientCount } = await this.recipients.enqueue(
      id,
      campaign.recipientFilter as unknown as RecipientFilterDto,
    );

    // Remove any prior scheduled job so re-scheduling is idempotent. Using
    // a deterministic jobId means we don't have to track the BullMQ job id
    // separately in Postgres.
    const jobId = `campaign-${id}`;
    const existingJob = await this.dispatchQueue.getJob(jobId);
    if (existingJob) {
      await existingJob.remove();
    }

    const delay = Math.max(0, dto.scheduledAt.getTime() - Date.now());
    await this.dispatchQueue.add(
      'dispatch',
      { campaignId: id, tenantId: ctx.tenantId },
      { jobId, delay },
    );

    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.campaign.update({
        where: { id },
        data: {
          status: 'SCHEDULED',
          scheduledAt: dto.scheduledAt,
          recipientCount,
        },
      }),
    );

    await this.audit.log({
      action: 'campaign.scheduled',
      subjectType: 'Campaign',
      subjectId: id,
      metadata: { scheduledAt: dto.scheduledAt.toISOString(), recipientCount },
    });

    return updated;
  }

  async cancel(id: string): Promise<Campaign> {
    const ctx = requireTenantContext();
    const campaign = await this.findOne(id);
    if (campaign.status === 'COMPLETED') {
      throw new BadRequestException({
        code: 'CAMPAIGN_TERMINAL',
        message: 'Cannot cancel a COMPLETED campaign',
      });
    }
    if (campaign.status === 'CANCELLED') return campaign;

    const jobId = `campaign-${id}`;
    const existingJob = await this.dispatchQueue.getJob(jobId);
    if (existingJob) {
      await existingJob.remove();
    }

    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.campaign.update({ where: { id }, data: { status: 'CANCELLED' } }),
    );
    await this.audit.log({
      action: 'campaign.cancelled',
      subjectType: 'Campaign',
      subjectId: id,
    });
    return updated;
  }

  async pause(id: string): Promise<Campaign> {
    const ctx = requireTenantContext();
    const campaign = await this.findOne(id);
    if (campaign.status === 'COMPLETED' || campaign.status === 'CANCELLED') {
      throw new BadRequestException({
        code: 'CAMPAIGN_TERMINAL',
        message: `Cannot pause a ${campaign.status} campaign`,
      });
    }
    if (campaign.status === 'PAUSED') return campaign;

    // If a delayed job exists, remove it so dispatch doesn't proceed
    // mid-pause. Resume re-creates it.
    const jobId = `campaign-${id}`;
    const existingJob = await this.dispatchQueue.getJob(jobId);
    if (existingJob) {
      await existingJob.remove();
    }

    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.campaign.update({ where: { id }, data: { status: 'PAUSED' } }),
    );
    await this.audit.log({
      action: 'campaign.paused',
      subjectType: 'Campaign',
      subjectId: id,
    });
    return updated;
  }

  async resume(id: string): Promise<Campaign> {
    const ctx = requireTenantContext();
    const campaign = await this.findOne(id);
    if (campaign.status !== 'PAUSED') {
      throw new BadRequestException({
        code: 'CAMPAIGN_NOT_PAUSED',
        message: `Can only resume a PAUSED campaign (current: ${campaign.status})`,
      });
    }

    // Re-enqueue with delay if scheduledAt is in the future, otherwise
    // dispatch immediately.
    if (campaign.scheduledAt) {
      const delay = Math.max(0, campaign.scheduledAt.getTime() - Date.now());
      await this.dispatchQueue.add(
        'dispatch',
        { campaignId: id, tenantId: ctx.tenantId },
        { jobId: `campaign-${id}`, delay },
      );
    } else {
      await this.dispatchQueue.add(
        'dispatch',
        { campaignId: id, tenantId: ctx.tenantId },
        { jobId: `campaign-${id}` },
      );
    }

    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.campaign.update({
        where: { id },
        data: { status: campaign.scheduledAt ? 'SCHEDULED' : 'ACTIVE' },
      }),
    );
    await this.audit.log({
      action: 'campaign.resumed',
      subjectType: 'Campaign',
      subjectId: id,
    });
    return updated;
  }

  /**
   * Aggregated counters for the campaign detail / stats page.
   * Cheap — reads denormalised columns rather than aggregating
   * CampaignRecipient / EmailTrack.
   */
  async getStats(id: string): Promise<CampaignStats> {
    const c = await this.findOne(id);
    return {
      recipientCount: c.recipientCount,
      sentSuccessCount: c.sentSuccessCount,
      sentFailureCount: c.sentFailureCount,
      openCount: c.openCount,
      uniqueOpenCount: c.uniqueOpenCount,
      clickCount: c.clickCount,
      uniqueClickCount: c.uniqueClickCount,
      bounceCount: c.bounceCount,
      unsubscribeCount: c.unsubscribeCount,
      spamReportCount: c.spamReportCount,
      status: c.status,
      scheduledAt: c.scheduledAt,
      sentAt: c.sentAt,
    };
  }
}

// ─── helpers (local; small enough not to warrant a separate file) ────────

export interface CampaignStats {
  recipientCount: number;
  sentSuccessCount: number;
  sentFailureCount: number;
  openCount: number;
  uniqueOpenCount: number;
  clickCount: number;
  uniqueClickCount: number;
  bounceCount: number;
  unsubscribeCount: number;
  spamReportCount: number;
  status: string;
  scheduledAt: Date | null;
  sentAt: Date | null;
}

// Runtime shape of a templateJson value coming back from Prisma (JSON column).
// We treat it as `unknown`-but-known here because the schema-level
// validation already happened at the Zod boundary; the renderer just walks
// the blocks defensively.
interface TemplateJsonRuntime {
  version?: number;
  blocks?: Array<Record<string, unknown>>;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Minimal HTML renderer used by the test-send path. The batch dispatcher
 * uses the same primitive — see CampaignDispatchProcessor.renderForRecipient.
 * Placeholder tokens render as bracketed labels ([firstName]) so the test
 * recipient sees that personalization will happen, without exposing
 * unrelated CRM data.
 */
function renderTestPreview(template: TemplateJsonRuntime, campaignName: string): string {
  const blocks = template.blocks ?? [];
  const body = blocks
    .map((block) => {
      const type = String(block.type ?? '');
      if (type === 'heading') {
        const level = Number(block.level ?? 1);
        const text = interpolatePreview(String(block.text ?? ''));
        return `<h${level}>${text}</h${level}>`;
      }
      if (type === 'paragraph') {
        const text = interpolatePreview(String(block.text ?? ''));
        return `<p>${text}</p>`;
      }
      if (type === 'button') {
        const url = escapeHtml(String(block.url ?? '#'));
        const label = interpolatePreview(String(block.label ?? ''));
        return `<p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#0070f3;color:#fff;text-decoration:none;border-radius:4px">${label}</a></p>`;
      }
      if (type === 'image') {
        const src = escapeHtml(String(block.src ?? ''));
        const alt = escapeHtml(String(block.alt ?? ''));
        return `<p><img src="${src}" alt="${alt}" /></p>`;
      }
      if (type === 'divider') return '<hr />';
      if (type === 'spacer') {
        const h = Number(block.height ?? 16);
        return `<div style="height:${h}px"></div>`;
      }
      return '';
    })
    .join('\n');
  return `<!doctype html><html><body><div style="max-width:600px;margin:0 auto;font-family:sans-serif">${body}<p style="color:#888;font-size:11px;border-top:1px solid #eee;padding-top:8px;margin-top:24px">Test preview — campaign: ${escapeHtml(campaignName)}</p></div></body></html>`;
}

function interpolatePreview(text: string): string {
  // Replace {{contact.firstName}} → [firstName] etc. for the preview.
  return escapeHtml(text).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, token: string) => {
    const last = token.split('.').pop() ?? token;
    return `[${last}]`;
  });
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
