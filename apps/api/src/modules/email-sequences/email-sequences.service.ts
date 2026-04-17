import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateEmailSequenceDto,
  EnrollContactDto,
  UpdateEmailSequenceDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

@Injectable()
export class EmailSequencesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEmailSequenceDto) {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailSequence.create({
        data: {
          tenantId: ctx.tenantId,
          name: dto.name,
          description: dto.description ?? null,
          createdById: ctx.userId ?? null,
          steps: {
            create: dto.steps.map((s) => ({
              tenantId: ctx.tenantId,
              order: s.order,
              delayDays: s.delayDays,
              subject: s.subject,
              bodyHtml: s.bodyHtml,
              bodyText: s.bodyText ?? null,
            })),
          },
        },
        include: { steps: { orderBy: { order: 'asc' } } },
      }),
    );
  }

  async list(status?: string) {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailSequence.findMany({
        where: {
          tenantId: ctx.tenantId,
          deletedAt: null,
          ...(status ? { status: status as Prisma.EnumSequenceStatusFilter } : {}),
        },
        include: {
          steps: { orderBy: { order: 'asc' } },
          _count: { select: { enrollments: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async findOne(id: string) {
    const ctx = requireTenantContext();
    const seq = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailSequence.findFirst({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
        include: {
          steps: { orderBy: { order: 'asc' } },
          enrollments: { orderBy: { enrolledAt: 'desc' }, take: 20 },
        },
      }),
    );
    if (!seq) throw new NotFoundException({ code: 'SEQUENCE_NOT_FOUND', message: 'Email sequence not found' });
    return seq;
  }

  async update(id: string, dto: UpdateEmailSequenceDto) {
    const ctx = requireTenantContext();
    await this.findOne(id);

    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailSequence.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.steps
            ? {
                steps: {
                  deleteMany: { sequenceId: id },
                  create: dto.steps.map((s) => ({
                    tenantId: ctx.tenantId,
                    order: s.order,
                    delayDays: s.delayDays,
                    subject: s.subject,
                    bodyHtml: s.bodyHtml,
                    bodyText: s.bodyText ?? null,
                  })),
                },
              }
            : {}),
        },
        include: { steps: { orderBy: { order: 'asc' } } },
      }),
    );
  }

  async activate(id: string) {
    const ctx = requireTenantContext();
    const seq = await this.findOne(id);
    if (seq.steps.length === 0) {
      throw new BadRequestException({ code: 'NO_STEPS', message: 'Cannot activate a sequence with no steps' });
    }
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailSequence.update({ where: { id }, data: { status: 'ACTIVE' } }),
    );
  }

  async pause(id: string) {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailSequence.update({ where: { id }, data: { status: 'PAUSED' } }),
    );
  }

  async archive(id: string) {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.emailSequence.update({ where: { id }, data: { status: 'ARCHIVED', deletedAt: new Date() } }),
    );
  }

  async enroll(dto: EnrollContactDto) {
    const ctx = requireTenantContext();
    const seq = await this.findOne(dto.sequenceId);
    if (seq.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'SEQUENCE_NOT_ACTIVE', message: 'Sequence must be ACTIVE to enroll contacts' });
    }
    const firstStep = seq.steps[0];
    const nextSendAt = firstStep
      ? new Date(Date.now() + firstStep.delayDays * 86400000)
      : null;

    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.sequenceEnrollment.create({
        data: {
          tenantId: ctx.tenantId,
          sequenceId: dto.sequenceId,
          toEmail: dto.toEmail,
          contactId: dto.contactId ?? null,
          nextSendAt,
        },
      }),
    );
  }

  async listEnrollments(sequenceId: string) {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.sequenceEnrollment.findMany({
        where: { tenantId: ctx.tenantId, sequenceId },
        orderBy: { enrolledAt: 'desc' },
      }),
    );
  }

  async unenroll(enrollmentId: string) {
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'UNSUBSCRIBED', completedAt: new Date() },
      }),
    );
  }
}
