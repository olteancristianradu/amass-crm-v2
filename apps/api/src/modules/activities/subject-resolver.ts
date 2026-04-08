import { Injectable, NotFoundException } from '@nestjs/common';
import { SubjectType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

/**
 * Validates that a polymorphic subject (Company / Contact / Client) exists
 * in the current tenant. Used by NotesService and (later) AttachmentsService
 * before writing rows that reference (subjectType, subjectId).
 *
 * Throws 404 if missing — keeps the existence check in one place so every
 * polymorphic endpoint behaves identically.
 */
@Injectable()
export class SubjectResolver {
  constructor(private readonly prisma: PrismaService) {}

  async assertExists(subjectType: SubjectType, subjectId: string): Promise<void> {
    const ctx = requireTenantContext();
    const exists = await this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      switch (subjectType) {
        case 'COMPANY':
          return tx.company.findFirst({
            where: { id: subjectId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
          });
        case 'CONTACT':
          return tx.contact.findFirst({
            where: { id: subjectId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
          });
        case 'CLIENT':
          return tx.client.findFirst({
            where: { id: subjectId, tenantId: ctx.tenantId, deletedAt: null },
            select: { id: true },
          });
      }
    });
    if (!exists) {
      throw new NotFoundException({
        code: 'SUBJECT_NOT_FOUND',
        message: `${subjectType} ${subjectId} not found`,
      });
    }
  }
}
