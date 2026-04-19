import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChatterPost, Prisma } from '@prisma/client';
import {
  CreateChatterPostDto,
  ListChatterQueryDto,
  UpdateChatterPostDto,
} from '@amass/shared';
import { buildCursorArgs, CursorPage, makeCursorPage } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

@Injectable()
export class ChatterService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateChatterPostDto): Promise<ChatterPost> {
    const ctx = requireTenantContext();
    if (!ctx.userId) {
      throw new ForbiddenException({ code: 'NO_USER', message: 'Authenticated user required' });
    }
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
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
