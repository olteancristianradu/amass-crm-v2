import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ChatterPost, Prisma } from '@prisma/client';
import {
  CreateChatterPostDto,
  ListChatterQueryDto,
  UpdateChatterPostDto,
} from '@amass/shared';
import { buildCursorArgs, CursorPage, makeCursorPage } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ChatterService {
  private readonly logger = new Logger(ChatterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(dto: CreateChatterPostDto): Promise<ChatterPost> {
    const ctx = requireTenantContext();
    if (!ctx.userId) {
      throw new ForbiddenException({ code: 'NO_USER', message: 'Authenticated user required' });
    }
    const post = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.chatterPost.create({
        data: {
          tenantId: ctx.tenantId,
          subjectType: dto.subjectType,
          subjectId: dto.subjectId,
          authorId: ctx.userId!,
          body: dto.body,
          mentions: dto.mentions,
        },
      }),
    );

    // Fan-out notifications to mentioned users (fire-and-forget — mention failures
    // shouldn't block the post itself; errors are logged for observability).
    if (dto.mentions && dto.mentions.length > 0) {
      const preview = dto.body.length > 100 ? `${dto.body.slice(0, 100)}…` : dto.body;
      for (const userId of dto.mentions) {
        if (userId === ctx.userId) continue;
        this.notifications
          .create(ctx.tenantId, {
            userId,
            type: 'SYSTEM',
            title: 'Ai fost menționat într-o postare',
            body: preview,
            data: {
              postId: post.id,
              subjectType: post.subjectType,
              subjectId: post.subjectId,
            },
          })
          .catch((err) => this.logger.warn(`Failed to notify ${userId}: ${String(err)}`));
      }
    }

    return post;
  }

  async list(q: ListChatterQueryDto): Promise<CursorPage<ChatterPost>> {
    const ctx = requireTenantContext();
    const where: Prisma.ChatterPostWhereInput = {
      tenantId: ctx.tenantId,
      subjectType: q.subjectType,
      subjectId: q.subjectId,
      deletedAt: null,
    };
    const cursorArgs = buildCursorArgs(q.cursor, q.limit);
    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.chatterPost.findMany({ where, ...cursorArgs, orderBy: { createdAt: 'desc' } }),
    );
    return makeCursorPage(items, q.limit);
  }

  async update(id: string, dto: UpdateChatterPostDto): Promise<ChatterPost> {
    const ctx = requireTenantContext();
    const existing = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.chatterPost.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } }),
    );
    if (!existing) throw new NotFoundException({ code: 'POST_NOT_FOUND', message: 'Chatter post not found' });
    if (existing.authorId !== ctx.userId) {
      throw new ForbiddenException({ code: 'NOT_AUTHOR', message: 'Only the author can edit this post' });
    }
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.chatterPost.update({ where: { id }, data: { body: dto.body } }),
    );
  }

  async remove(id: string): Promise<void> {
    const ctx = requireTenantContext();
    const existing = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.chatterPost.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } }),
    );
    if (!existing) throw new NotFoundException({ code: 'POST_NOT_FOUND', message: 'Chatter post not found' });
    if (existing.authorId !== ctx.userId) {
      throw new ForbiddenException({ code: 'NOT_AUTHOR', message: 'Only the author can delete this post' });
    }
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.chatterPost.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }
}
