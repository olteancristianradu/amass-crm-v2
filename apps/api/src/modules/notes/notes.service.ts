import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateNoteDto, UpdateNoteDto } from '@amass/shared';
import { Activity, Note, Prisma, SubjectType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { ActivitiesService } from '../activities/activities.service';
import { AuditService } from '../audit/audit.service';
import { SubjectResolver } from '../activities/subject-resolver';

/**
 * Timeline entry returned by `getTimeline()`. We discriminate via `kind` so
 * the FE can render notes (with author + body) and activities (with action +
 * metadata) without ambiguity.
 */
export type TimelineEntry =
  | { kind: 'note'; id: string; createdAt: Date; authorId: string | null; body: string }
  | {
      kind: 'activity';
      id: string;
      createdAt: Date;
      actorId: string | null;
      action: string;
      metadata: Prisma.JsonValue | null;
    };

export interface TimelinePage {
  data: TimelineEntry[];
  nextCursor: string | null;
}

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
    private readonly subjects: SubjectResolver,
  ) {}

  async create(subjectType: SubjectType, subjectId: string, dto: CreateNoteDto): Promise<Note> {
    await this.subjects.assertExists(subjectType, subjectId);
    const ctx = requireTenantContext();
    const note = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.note.create({
        data: {
          tenantId: ctx.tenantId,
          subjectType,
          subjectId,
          body: dto.body,
          authorId: ctx.userId,
        },
      }),
    );
    await this.audit.log({
      action: 'note.create',
      subjectType: subjectType.toLowerCase(),
      subjectId,
      metadata: { noteId: note.id },
    });
    await this.activities.log({
      subjectType,
      subjectId,
      action: 'note.added',
      metadata: { noteId: note.id, preview: dto.body.slice(0, 80) },
    });
    return note;
  }

  async list(subjectType: SubjectType, subjectId: string): Promise<Note[]> {
    await this.subjects.assertExists(subjectType, subjectId);
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.note.findMany({
        where: { tenantId: ctx.tenantId, subjectType, subjectId, deletedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  }

  async findOne(noteId: string): Promise<Note> {
    const ctx = requireTenantContext();
    const note = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.note.findFirst({
        where: { id: noteId, tenantId: ctx.tenantId, deletedAt: null },
      }),
    );
    if (!note) throw new NotFoundException({ code: 'NOTE_NOT_FOUND', message: 'Note not found' });
    return note;
  }

  async update(noteId: string, dto: UpdateNoteDto): Promise<Note> {
    const existing = await this.findOne(noteId);
    const ctx = requireTenantContext();
    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.note.update({ where: { id: noteId }, data: dto }),
    );
    await this.audit.log({
      action: 'note.update',
      subjectType: existing.subjectType.toLowerCase(),
      subjectId: existing.subjectId,
      metadata: { noteId },
    });
    return updated;
  }

  async remove(noteId: string): Promise<void> {
    const existing = await this.findOne(noteId);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.note.update({ where: { id: noteId }, data: { deletedAt: new Date() } }),
    );
    await this.audit.log({
      action: 'note.delete',
      subjectType: existing.subjectType.toLowerCase(),
      subjectId: existing.subjectId,
      metadata: { noteId },
    });
  }

  /**
   * Merged timeline of notes + activities for a given subject. We fetch
   * `limit + 1` from each table, merge in memory by createdAt desc, then
   * truncate. This is fast for typical timelines (<100 entries) and avoids
   * a UNION ALL query that Prisma can't easily express.
   *
   * Cursor format: ISO timestamp of the last returned entry. We use the
   * timestamp (not an id) because the two tables have independent id spaces.
   * On next call we ask for `createdAt < cursor` from both tables.
   */
  async getTimeline(
    subjectType: SubjectType,
    subjectId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<TimelinePage> {
    await this.subjects.assertExists(subjectType, subjectId);
    const ctx = requireTenantContext();
    const cursorDate = cursor ? new Date(cursor) : undefined;
    if (cursor && Number.isNaN(cursorDate?.getTime())) {
      // Bad cursor → start from the top instead of crashing.
      return this.getTimeline(subjectType, subjectId, undefined, limit);
    }

    const baseWhere = {
      tenantId: ctx.tenantId,
      subjectType,
      subjectId,
      ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
    };

    const [notes, activities] = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      Promise.all([
        tx.note.findMany({
          where: { ...baseWhere, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: limit + 1,
        }),
        tx.activity.findMany({
          where: baseWhere,
          orderBy: { createdAt: 'desc' },
          take: limit + 1,
        }),
      ]),
    );

    const merged: TimelineEntry[] = [
      ...notes.map(
        (n: Note): TimelineEntry => ({
          kind: 'note',
          id: n.id,
          createdAt: n.createdAt,
          authorId: n.authorId,
          body: n.body,
        }),
      ),
      ...activities.map(
        (a: Activity): TimelineEntry => ({
          kind: 'activity',
          id: a.id,
          createdAt: a.createdAt,
          actorId: a.actorId,
          action: a.action,
          metadata: a.metadata,
        }),
      ),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (merged.length > limit) {
      const data = merged.slice(0, limit);
      return { data, nextCursor: data[data.length - 1].createdAt.toISOString() };
    }
    return { data: merged, nextCursor: null };
  }
}
