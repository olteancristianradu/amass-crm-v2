import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

/**
 * Cockpit feed item — a single actionable card surfaced to the user on
 * the home screen. Each item carries enough context to decide whether
 * to act now or snooze, plus a link to the full record.
 *
 * `widget` identifies which selectable widget the item belongs to so the
 * FE can group items even when fetched in one call.
 */
export interface CockpitFeedItem {
  id: string;
  widget: 'deals-in-danger' | 'reminders-due-today' | 'tasks-overdue' | 'leads-hot';
  /** Score 0-100 — higher is more urgent. Used for sorting. */
  score: number;
  title: string;
  subtitle?: string;
  /** ISO timestamp shown to the user as "due Tuesday", etc. */
  dueAt?: string;
  /** Where the FE should navigate when the user clicks the item. */
  href: string;
  /** Tenant entity id — for log/click tracking. */
  entityId: string;
  entityType: 'deal' | 'reminder' | 'task' | 'lead';
  /**
   * Related entity refs — populated when the underlying record carries
   * a foreign key to that entity. Lets the FE filter the feed for an
   * Entity 360 "next action" header (`apps/web/src/features/entity-detail/`)
   * without re-fetching.
   */
  relatedCompanyId?: string;
  relatedContactId?: string;
  relatedClientId?: string;
}

/**
 * What "in danger" means for a deal:
 *   - Status open (not WON/LOST)
 *   - No activity in last 7+ days
 *   - Past expectedCloseDate, OR within 3 days of it without recent updates
 *
 * Score is value-weighted so a stalled €50k deal sorts above a stalled
 * €500 deal.
 */
const DEAL_DANGER_DAYS = 7;
const TASK_OVERDUE_HOURS = 0; // anything past dueAt
const REMINDER_TODAY_WINDOW_HOURS = 24;

@Injectable()
export class CockpitService {
  constructor(private readonly prisma: PrismaService) {}

  async feed(): Promise<CockpitFeedItem[]> {
    const ctx = requireTenantContext();
    const now = new Date();
    const dangerCutoff = new Date(now.getTime() - DEAL_DANGER_DAYS * 24 * 3600 * 1000);
    const reminderCutoff = new Date(now.getTime() + REMINDER_TODAY_WINDOW_HOURS * 3600 * 1000);

    const items = await this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const dealsInDanger = await tx.deal.findMany({
        where: {
          tenantId: ctx.tenantId,
          deletedAt: null,
          status: 'OPEN',
          updatedAt: { lt: dangerCutoff },
        },
        select: {
          id: true,
          title: true,
          value: true,
          currency: true,
          expectedCloseAt: true,
          updatedAt: true,
          companyId: true,
          contactId: true,
        },
        orderBy: [{ value: 'desc' }, { updatedAt: 'asc' }],
        take: 10,
      });

      const remindersDue = await tx.reminder.findMany({
        where: {
          tenantId: ctx.tenantId,
          deletedAt: null,
          status: { in: ['PENDING', 'FIRED'] },
          remindAt: { lte: reminderCutoff },
        },
        select: { id: true, title: true, remindAt: true, subjectType: true, subjectId: true },
        orderBy: { remindAt: 'asc' },
        take: 10,
      });

      const tasksOverdue = await tx.task.findMany({
        where: {
          tenantId: ctx.tenantId,
          deletedAt: null,
          status: 'OPEN',
          dueAt: { lt: now },
        },
        select: {
          id: true,
          title: true,
          priority: true,
          dueAt: true,
          dealId: true,
          subjectType: true,
          subjectId: true,
        },
        orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
        take: 10,
      });

      return { dealsInDanger, remindersDue, tasksOverdue };
    });

    const out: CockpitFeedItem[] = [];

    for (const d of items.dealsInDanger) {
      const value = Number(d.value ?? 0);
      const daysIdle = Math.floor((now.getTime() - d.updatedAt.getTime()) / (24 * 3600 * 1000));
      const score = Math.min(100, Math.floor(value / 1000) + daysIdle * 2);
      out.push({
        id: `deal:${d.id}`,
        widget: 'deals-in-danger',
        score,
        title: d.title,
        subtitle: `Idle ${daysIdle}d · ${value.toLocaleString('ro-RO')} ${d.currency ?? 'RON'}`,
        dueAt: d.expectedCloseAt?.toISOString(),
        href: `/app/deals/${d.id}`,
        entityId: d.id,
        entityType: 'deal',
        ...(d.companyId ? { relatedCompanyId: d.companyId } : {}),
        ...(d.contactId ? { relatedContactId: d.contactId } : {}),
      });
    }

    for (const r of items.remindersDue) {
      const minutesUntil = Math.max(0, Math.floor((r.remindAt.getTime() - now.getTime()) / 60_000));
      const score = minutesUntil < 60 ? 95 : minutesUntil < 240 ? 80 : 60;
      const subjectKey = subjectIdField(r.subjectType, r.subjectId);
      out.push({
        id: `reminder:${r.id}`,
        widget: 'reminders-due-today',
        score,
        title: r.title,
        subtitle: minutesUntil === 0 ? 'Now' : `In ${minutesUntil}m`,
        dueAt: r.remindAt.toISOString(),
        href: r.subjectId
          ? `/app/${r.subjectType.toLowerCase()}s/${r.subjectId}`
          : '/app/reminders',
        entityId: r.id,
        entityType: 'reminder',
        ...subjectKey,
      });
    }

    for (const t of items.tasksOverdue) {
      const overdueHours = Math.max(
        0,
        Math.floor((now.getTime() - (t.dueAt?.getTime() ?? now.getTime())) / 3600_000),
      );
      const priorityBoost = t.priority === 'HIGH' ? 25 : 0;
      const score = Math.min(100, 50 + Math.floor(overdueHours / 4) + priorityBoost);
      const subjectKey = t.subjectType && t.subjectId ? subjectIdField(t.subjectType, t.subjectId) : {};
      out.push({
        id: `task:${t.id}`,
        widget: 'tasks-overdue',
        score,
        title: t.title,
        subtitle: `Overdue ${overdueHours}h · ${t.priority}`,
        dueAt: t.dueAt?.toISOString(),
        href: t.dealId ? `/app/deals/${t.dealId}` : '/app/tasks',
        entityId: t.id,
        entityType: 'task',
        ...subjectKey,
      });
    }

    out.sort((a, b) => b.score - a.score);
    return out;
  }
}

/**
 * Map a polymorphic subject (CONTACT/CLIENT/COMPANY) to the typed
 * `relatedXxxId` field on a feed item. Reminders + Tasks both use this.
 */
function subjectIdField(subjectType: string, subjectId: string): {
  relatedCompanyId?: string;
  relatedContactId?: string;
  relatedClientId?: string;
} {
  switch (subjectType) {
    case 'COMPANY':
      return { relatedCompanyId: subjectId };
    case 'CONTACT':
      return { relatedContactId: subjectId };
    case 'CLIENT':
      return { relatedClientId: subjectId };
    default:
      return {};
  }
}

// Re-export the constant tunable so tests and admin docs can reference
// without importing the whole service.
export const COCKPIT_TUNING = {
  DEAL_DANGER_DAYS,
  TASK_OVERDUE_HOURS,
  REMINDER_TODAY_WINDOW_HOURS,
} as const;

/** Default widget layout used when a user has never customized theirs. */
const DEFAULT_WIDGETS = ['deals-in-danger', 'reminders-due-today', 'tasks-overdue'] as const;
const VALID_WIDGETS = new Set([...DEFAULT_WIDGETS, 'leads-hot']);

@Injectable()
export class CockpitLayoutService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<{ widgets: string[] }> {
    const ctx = requireTenantContext();
    const row = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.cockpitLayout.findUnique({
        where: { tenantId_userId: { tenantId: ctx.tenantId, userId: ctx.userId ?? '' } },
      }),
    );
    if (!row) return { widgets: [...DEFAULT_WIDGETS] };
    const widgets = Array.isArray(row.widgets) ? (row.widgets as string[]) : [...DEFAULT_WIDGETS];
    return { widgets: widgets.filter((w) => VALID_WIDGETS.has(w)) };
  }

  async upsert(widgets: string[]): Promise<{ widgets: string[] }> {
    const ctx = requireTenantContext();
    if (!ctx.userId) {
      // Layout is per-user; without userId there's nothing to key on.
      return { widgets };
    }
    // Reject unknown widget ids — keeps a stale FE from corrupting the layout.
    const cleaned = widgets.filter((w) => VALID_WIDGETS.has(w));
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.cockpitLayout.upsert({
        where: { tenantId_userId: { tenantId: ctx.tenantId, userId: ctx.userId! } },
        update: { widgets: cleaned as Prisma.InputJsonValue },
        create: {
          tenantId: ctx.tenantId,
          userId: ctx.userId!,
          widgets: cleaned as Prisma.InputJsonValue,
        },
      }),
    );
    return { widgets: cleaned };
  }
}
