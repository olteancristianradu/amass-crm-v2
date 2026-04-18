import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

export interface DuplicateCandidate {
  id: string;
  name: string;
  similarity: number;
}

@Injectable()
export class DuplicatesService {
  constructor(private readonly prisma: PrismaService) {}

  async findCompanyDuplicates(id: string): Promise<DuplicateCandidate[]> {
    const { tenantId } = requireTenantContext();
    const source = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.company.findFirst({ where: { id, tenantId, deletedAt: null } }),
    );
    if (!source) throw new NotFoundException('Company not found');

    const name = source.name ?? '';
    const vat = source.vatNumber ?? '';
    const email = source.email ?? '';

    return this.prisma.$queryRaw<DuplicateCandidate[]>`
      SELECT id, name,
        GREATEST(
          similarity(name, ${name}),
          CASE WHEN vat_number IS NOT NULL AND ${vat} <> '' THEN similarity(vat_number, ${vat}) ELSE 0 END,
          CASE WHEN email     IS NOT NULL AND ${email} <> '' THEN similarity(email, ${email}) ELSE 0 END
        )::float AS similarity
      FROM companies
      WHERE tenant_id = ${tenantId}
        AND id <> ${id}
        AND deleted_at IS NULL
        AND (
          similarity(name, ${name}) > 0.3
          OR (vat_number IS NOT NULL AND ${vat} <> '' AND similarity(vat_number, ${vat}) > 0.8)
          OR (email      IS NOT NULL AND ${email} <> '' AND similarity(email, ${email}) > 0.8)
        )
      ORDER BY similarity DESC
      LIMIT 10
    `;
  }

  async findContactDuplicates(id: string): Promise<DuplicateCandidate[]> {
    const { tenantId } = requireTenantContext();
    const source = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contact.findFirst({ where: { id, tenantId, deletedAt: null } }),
    );
    if (!source) throw new NotFoundException('Contact not found');

    const fullName = `${source.firstName} ${source.lastName}`;
    const email = source.email ?? '';

    return this.prisma.$queryRaw<DuplicateCandidate[]>`
      SELECT id, first_name || ' ' || last_name AS name,
        GREATEST(
          similarity(first_name || ' ' || last_name, ${fullName}),
          CASE WHEN email IS NOT NULL AND ${email} <> '' THEN similarity(email, ${email}) ELSE 0 END
        )::float AS similarity
      FROM contacts
      WHERE tenant_id = ${tenantId}
        AND id <> ${id}
        AND deleted_at IS NULL
        AND (
          similarity(first_name || ' ' || last_name, ${fullName}) > 0.4
          OR (email IS NOT NULL AND ${email} <> '' AND similarity(email, ${email}) > 0.8)
        )
      ORDER BY similarity DESC
      LIMIT 10
    `;
  }

  async findClientDuplicates(id: string): Promise<DuplicateCandidate[]> {
    const { tenantId } = requireTenantContext();
    const source = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.client.findFirst({ where: { id, tenantId, deletedAt: null } }),
    );
    if (!source) throw new NotFoundException('Client not found');

    const fullName = `${source.firstName} ${source.lastName}`;
    const email = source.email ?? '';

    return this.prisma.$queryRaw<DuplicateCandidate[]>`
      SELECT id, first_name || ' ' || last_name AS name,
        GREATEST(
          similarity(first_name || ' ' || last_name, ${fullName}),
          CASE WHEN email IS NOT NULL AND ${email} <> '' THEN similarity(email, ${email}) ELSE 0 END
        )::float AS similarity
      FROM clients
      WHERE tenant_id = ${tenantId}
        AND id <> ${id}
        AND deleted_at IS NULL
        AND (
          similarity(first_name || ' ' || last_name, ${fullName}) > 0.4
          OR (email IS NOT NULL AND ${email} <> '' AND similarity(email, ${email}) > 0.8)
        )
      ORDER BY similarity DESC
      LIMIT 10
    `;
  }

  async mergeCompanies(survivorId: string, victimIds: string[]): Promise<void> {
    const { tenantId } = requireTenantContext();
    if (victimIds.includes(survivorId)) throw new BadRequestException('survivorId cannot be in victimIds');

    await this.prisma.runWithTenant(tenantId, async (tx) => {
      const survivor = await tx.company.findFirst({ where: { id: survivorId, tenantId, deletedAt: null } });
      if (!survivor) throw new NotFoundException('Survivor company not found');

      for (const victimId of victimIds) {
        const victim = await tx.company.findFirst({ where: { id: victimId, tenantId, deletedAt: null } });
        if (!victim) continue;

        await tx.contact.updateMany({ where: { companyId: victimId, tenantId }, data: { companyId: survivorId } });
        await tx.quote.updateMany({ where: { companyId: victimId, tenantId }, data: { companyId: survivorId } });
        await tx.deal.updateMany({ where: { companyId: victimId, tenantId }, data: { companyId: survivorId } });
        await tx.note.updateMany({ where: { subjectType: 'COMPANY', subjectId: victimId, tenantId }, data: { subjectId: survivorId } });
        await tx.reminder.updateMany({ where: { subjectType: 'COMPANY', subjectId: victimId, tenantId }, data: { subjectId: survivorId } });
        await tx.activity.updateMany({ where: { subjectType: 'COMPANY', subjectId: victimId, tenantId }, data: { subjectId: survivorId } });
        await tx.attachment.updateMany({ where: { subjectType: 'COMPANY', subjectId: victimId, tenantId }, data: { subjectId: survivorId } });
        await tx.company.update({ where: { id: victimId }, data: { deletedAt: new Date() } });
      }
    });
  }

  async mergeContacts(survivorId: string, victimIds: string[]): Promise<void> {
    const { tenantId } = requireTenantContext();
    if (victimIds.includes(survivorId)) throw new BadRequestException('survivorId cannot be in victimIds');

    await this.prisma.runWithTenant(tenantId, async (tx) => {
      const survivor = await tx.contact.findFirst({ where: { id: survivorId, tenantId, deletedAt: null } });
      if (!survivor) throw new NotFoundException('Survivor contact not found');

      for (const victimId of victimIds) {
        const victim = await tx.contact.findFirst({ where: { id: victimId, tenantId, deletedAt: null } });
        if (!victim) continue;

        await tx.note.updateMany({ where: { subjectType: 'CONTACT', subjectId: victimId, tenantId }, data: { subjectId: survivorId } });
        await tx.reminder.updateMany({ where: { subjectType: 'CONTACT', subjectId: victimId, tenantId }, data: { subjectId: survivorId } });
        await tx.activity.updateMany({ where: { subjectType: 'CONTACT', subjectId: victimId, tenantId }, data: { subjectId: survivorId } });
        await tx.attachment.updateMany({ where: { subjectType: 'CONTACT', subjectId: victimId, tenantId }, data: { subjectId: survivorId } });
        await tx.deal.updateMany({ where: { contactId: victimId, tenantId }, data: { contactId: survivorId } });
        await tx.contact.update({ where: { id: victimId }, data: { deletedAt: new Date() } });
      }
    });
  }

  async mergeClients(survivorId: string, victimIds: string[]): Promise<void> {
    const { tenantId } = requireTenantContext();
    if (victimIds.includes(survivorId)) throw new BadRequestException('survivorId cannot be in victimIds');

    await this.prisma.runWithTenant(tenantId, async (tx) => {
      const survivor = await tx.client.findFirst({ where: { id: survivorId, tenantId, deletedAt: null } });
      if (!survivor) throw new NotFoundException('Survivor client not found');

      for (const victimId of victimIds) {
        const victim = await tx.client.findFirst({ where: { id: victimId, tenantId, deletedAt: null } });
        if (!victim) continue;

        await tx.note.updateMany({ where: { subjectType: 'CLIENT', subjectId: victimId, tenantId }, data: { subjectId: survivorId } });
        await tx.reminder.updateMany({ where: { subjectType: 'CLIENT', subjectId: victimId, tenantId }, data: { subjectId: survivorId } });
        await tx.activity.updateMany({ where: { subjectType: 'CLIENT', subjectId: victimId, tenantId }, data: { subjectId: survivorId } });
        await tx.attachment.updateMany({ where: { subjectType: 'CLIENT', subjectId: victimId, tenantId }, data: { subjectId: survivorId } });
        await tx.client.update({ where: { id: victimId }, data: { deletedAt: new Date() } });
      }
    });
  }
}
