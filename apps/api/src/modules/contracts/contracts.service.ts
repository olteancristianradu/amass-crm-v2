import { Injectable, NotFoundException } from '@nestjs/common';
import { Contract, Prisma } from '@prisma/client';
import {
  CreateContractDto,
  ListContractsQueryDto,
  UpdateContractDto,
} from '@amass/shared';
import { buildCursorArgs, CursorPage, makeCursorPage } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateContractDto): Promise<Contract> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.contract.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: dto.companyId,
          title: dto.title,
          description: dto.description ?? null,
          value: dto.value ? new Prisma.Decimal(dto.value) : null,
          currency: dto.currency ?? 'RON',
          status: dto.status ?? 'DRAFT',
          signedAt: dto.signedAt ?? null,
          startDate: dto.startDate ?? null,
          endDate: dto.endDate ?? null,
          renewalDate: dto.renewalDate ?? null,
          autoRenew: dto.autoRenew ?? false,
          storageKey: dto.storageKey ?? null,
          createdById: ctx.userId ?? null,
        },
      }),
    );
  }

  async findAll(q: ListContractsQueryDto): Promise<CursorPage<Contract>> {
    const ctx = requireTenantContext();
    const now = new Date();
    const expiringBefore = q.expiringInDays
      ? new Date(now.getTime() + q.expiringInDays * 86400_000)
      : undefined;

    const where: Prisma.ContractWhereInput = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(q.companyId ? { companyId: q.companyId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(expiringBefore
        ? { endDate: { lte: expiringBefore, gt: now } }
        : {}),
    };
    const cursorArgs = buildCursorArgs(q.cursor, q.limit);
    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.contract.findMany({ where, ...cursorArgs, orderBy: { createdAt: 'desc' } }),
    );
    return makeCursorPage(items, q.limit);
  }

  async findOne(id: string): Promise<Contract> {
    const ctx = requireTenantContext();
    const contract = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.contract.findFirst({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
      }),
    );
    if (!contract) {
      throw new NotFoundException({ code: 'CONTRACT_NOT_FOUND', message: 'Contract not found' });
    }
    return contract;
  }

  async update(id: string, dto: UpdateContractDto): Promise<Contract> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    const data: Prisma.ContractUpdateInput = {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.value !== undefined ? { value: dto.value ? new Prisma.Decimal(dto.value) : null } : {}),
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.signedAt !== undefined ? { signedAt: dto.signedAt } : {}),
      ...(dto.startDate !== undefined ? { startDate: dto.startDate } : {}),
      ...(dto.endDate !== undefined ? { endDate: dto.endDate } : {}),
      ...(dto.renewalDate !== undefined ? { renewalDate: dto.renewalDate } : {}),
      ...(dto.autoRenew !== undefined ? { autoRenew: dto.autoRenew } : {}),
      ...(dto.storageKey !== undefined ? { storageKey: dto.storageKey } : {}),
    };
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.contract.update({ where: { id }, data }),
    );
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.contract.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }
}
