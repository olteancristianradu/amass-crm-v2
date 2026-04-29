import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

/**
 * F1.12 — Per-user product tour completion state.
 *
 * Stored as JSON array of string tour IDs on User.completedTours. Persisted
 * in DB (not localStorage) so a user gets the same tour state across browsers
 * and devices. Re-runable from /app/help: a user can mark a tour as
 * incomplete to make it re-fire on next page visit.
 *
 * Tour IDs are FE-defined slugs like "companies-list", "deals-kanban",
 * "calls-detail". Coordinated by the tours/ directory in the web app.
 */
@Injectable()
export class TourProgressService {
  constructor(private readonly prisma: PrismaService) {}

  /** All tour IDs the current user has completed or dismissed. */
  async getCompletedTours(): Promise<string[]> {
    const { userId } = requireTenantContext();
    if (!userId) return [];
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { completedTours: true },
    });
    const raw = user?.completedTours;
    if (!Array.isArray(raw)) return [];
    return raw.filter((v): v is string => typeof v === 'string');
  }

  /** Mark a tour as completed. Idempotent (no duplicates). */
  async markCompleted(tourId: string): Promise<string[]> {
    const current = await this.getCompletedTours();
    if (current.includes(tourId)) return current;
    const next = [...current, tourId];
    const { userId } = requireTenantContext();
    if (!userId) return next;
    await this.prisma.user.update({
      where: { id: userId },
      data: { completedTours: next },
    });
    return next;
  }

  /** Remove a tour from completed list — used by /help "Re-launch tour" button. */
  async markIncomplete(tourId: string): Promise<string[]> {
    const current = await this.getCompletedTours();
    const next = current.filter((id) => id !== tourId);
    if (next.length === current.length) return current;
    const { userId } = requireTenantContext();
    if (!userId) return next;
    await this.prisma.user.update({
      where: { id: userId },
      data: { completedTours: next },
    });
    return next;
  }
}
