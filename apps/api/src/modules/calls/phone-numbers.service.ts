import { Injectable, NotFoundException } from '@nestjs/common';
import { PhoneNumber, Prisma } from '@prisma/client';
import { CreatePhoneNumberDto } from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { AuditService } from '../audit/audit.service';

// Partial update type — all fields from CreatePhoneNumberDto optional
type UpdatePhoneNumberDto = Partial<CreatePhoneNumberDto>;

@Injectable()
export class PhoneNumbersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreatePhoneNumberDto): Promise<PhoneNumber> {
    const ctx = requireTenantContext();

    if (dto.isDefault) {
      await this.clearDefault(ctx.tenantId, dto.userId ?? null);
    }

    const pn = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.phoneNumber.create({
        data: {
          tenantId: ctx.tenantId,
          twilioSid: dto.twilioSid,
          number: dto.number,
          label: dto.label ?? null,
          userId: dto.userId ?? null,
          isDefault: dto.isDefault,
        },
      }),
    );

    await this.audit.log({
      action: 'phone_number.create',
      subjectType: 'phone_number',
      subjectId: pn.id,
      metadata: { number: pn.number, label: pn.label },
    });

    return pn;
  }

  async list(): Promise<PhoneNumber[]> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.phoneNumber.findMany({
        where: { tenantId: ctx.tenantId, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
    );
  }

  async findOne(id: string): Promise<PhoneNumber> {
    const ctx = requireTenantContext();
    const pn = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.phoneNumber.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } }),
    );
    if (!pn) throw new NotFoundException({ code: 'PHONE_NUMBER_NOT_FOUND', message: 'Phone number not found' });
    return pn;
  }

  async update(id: string, dto: UpdatePhoneNumberDto): Promise<PhoneNumber> {
    const existing = await this.findOne(id); // existence + tenant check
    const ctx = requireTenantContext();

    if (dto.isDefault) {
      await this.clearDefault(ctx.tenantId, existing.userId);
    }

    const data: Prisma.PhoneNumberUpdateInput = {
      ...(dto.label !== undefined ? { label: dto.label } : {}),
      ...(dto.number !== undefined ? { number: dto.number } : {}),
      ...(dto.userId !== undefined ? { userId: dto.userId } : {}),
      ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
    };

    const updated = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.phoneNumber.update({ where: { id }, data }),
    );

    await this.audit.log({
      action: 'phone_number.update',
      subjectType: 'phone_number',
      subjectId: id,
      metadata: { fields: Object.keys(dto) },
    });

    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id); // existence + tenant check
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.phoneNumber.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    await this.audit.log({
      action: 'phone_number.delete',
      subjectType: 'phone_number',
      subjectId: id,
    });
  }

  private async clearDefault(tenantId: string, userId: string | null): Promise<void> {
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.phoneNumber.updateMany({
        where: { tenantId, userId: userId ?? undefined, isDefault: true, deletedAt: null },
        data: { isDefault: false },
      }),
    );
  }
}
