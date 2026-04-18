import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalPolicyTrigger, ApprovalStatus, Prisma, QuoteStatus } from '@prisma/client';
import {
  CreateApprovalPolicyDto,
  MakeApprovalDecisionDto,
  UpdateApprovalPolicyDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Policies ──────────────────────────────────────────────────────────────

  async createPolicy(dto: CreateApprovalPolicyDto) {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalPolicy.create({
        data: {
          tenantId,
          name: dto.name,
          trigger: dto.trigger as ApprovalPolicyTrigger,
          config: dto.config as Prisma.InputJsonValue,
          approverId: dto.approverId ?? null,
          isActive: dto.isActive,
        },
      }),
    );
  }

  async listPolicies() {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalPolicy.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async updatePolicy(id: string, dto: UpdateApprovalPolicyDto) {
    const { tenantId } = requireTenantContext();
    await this.assertPolicy(tenantId, id);
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalPolicy.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.trigger ? { trigger: dto.trigger as ApprovalPolicyTrigger } : {}),
          ...(dto.config ? { config: dto.config as Prisma.InputJsonValue } : {}),
          ...(dto.approverId !== undefined ? { approverId: dto.approverId ?? null } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      }),
    );
  }

  async removePolicy(id: string) {
    const { tenantId } = requireTenantContext();
    await this.assertPolicy(tenantId, id);
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalPolicy.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
    );
  }

  private async assertPolicy(tenantId: string, id: string) {
    const p = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalPolicy.findFirst({ where: { id, tenantId, deletedAt: null } }),
    );
    if (!p) throw new NotFoundException('Approval policy not found');
    return p;
  }

  // ─── Requests ──────────────────────────────────────────────────────────────

  /**
   * Called by QuotesService when a quote is about to be sent.
   * Checks active policies; if any matches, creates a request and returns true.
   * Returns false if no policy matches (quote may proceed directly to SENT).
   */
  async checkAndRequestApproval(quoteId: string, quoteTotal: Prisma.Decimal, quoteCurrency: string): Promise<boolean> {
    const { tenantId, userId } = requireTenantContext();
    const policies = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalPolicy.findMany({ where: { tenantId, isActive: true, deletedAt: null } }),
    );

    const matched = policies.filter((policy) => {
      const config = policy.config as Record<string, unknown>;
      if (policy.trigger === 'QUOTE_ABOVE_VALUE') {
        const threshold = Number(config['threshold'] ?? 0);
        const currency = config['currency'] as string | undefined;
        return (
          quoteTotal.greaterThan(threshold) &&
          (!currency || currency === quoteCurrency)
        );
      }
      return false;
    });

    if (matched.length === 0) return false;

    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalRequest.createMany({
        data: matched.map((p) => ({
          tenantId,
          policyId: p.id,
          quoteId,
          requestedBy: userId ?? '',
          status: 'PENDING' as ApprovalStatus,
        })),
        skipDuplicates: true,
      }),
    );

    return true;
  }

  async listRequests(quoteId?: string) {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalRequest.findMany({
        where: { tenantId, ...(quoteId ? { quoteId } : {}) },
        include: { policy: true, decisions: { orderBy: { decidedAt: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async decide(requestId: string, dto: MakeApprovalDecisionDto) {
    const { tenantId, userId } = requireTenantContext();
    const request = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalRequest.findFirst({
        where: { id: requestId, tenantId },
        include: { policy: true },
      }),
    );
    if (!request) throw new NotFoundException('Approval request not found');
    if (request.status !== 'PENDING') throw new BadRequestException('Request is no longer pending');

    // If policy has a specific approver, enforce it
    if (request.policy.approverId && request.policy.approverId !== userId) {
      throw new ForbiddenException('Only the designated approver can decide on this request');
    }

    const newStatus = dto.status as ApprovalStatus;

    await this.prisma.runWithTenant(tenantId, async (tx) => {
      await tx.approvalDecision.create({
        data: {
          tenantId,
          requestId,
          deciderId: userId ?? '',
          status: newStatus,
          comment: dto.comment ?? null,
        },
      });
      await tx.approvalRequest.update({ where: { id: requestId }, data: { status: newStatus } });

      // Update quote status based on decision
      const allRequests = await tx.approvalRequest.findMany({ where: { quoteId: request.quoteId, tenantId } });
      const allApproved = allRequests.every((r) => r.id === requestId ? newStatus === 'APPROVED' : r.status === 'APPROVED');
      const anyRejected = allRequests.some((r) => r.id === requestId ? newStatus === 'REJECTED' : r.status === 'REJECTED');

      if (anyRejected) {
        await tx.quote.update({ where: { id: request.quoteId }, data: { status: 'DRAFT' as QuoteStatus } });
      } else if (allApproved) {
        await tx.quote.update({ where: { id: request.quoteId }, data: { status: 'SENT' as QuoteStatus } });
      }
    });

    return { message: dto.status === 'APPROVED' ? 'Quote approved and sent' : 'Quote rejected, returned to DRAFT' };
  }
}
