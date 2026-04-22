import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { tenantStorage } from '../../infra/prisma/tenant-context';

type Mock = ReturnType<typeof vi.fn>;

/**
 * LeadsService.convert has several pre-transaction guards:
 *  - lead already CONVERTED → 400 LEAD_ALREADY_CONVERTED
 *  - createDeal without pipelineId/stageId → 400 DEAL_MISSING_PIPELINE_STAGE
 *  - lead not found in this tenant → 404
 *
 * These are pure branching and covered here. Transactional side effects
 * (create contact + company + deal atomically) belong in the e2e suite
 * that runs against Docker Postgres.
 */
function build(stubLead: unknown | null) {
  const findFirst: Mock = vi.fn().mockResolvedValue(stubLead);
  // runWithTenant invokes the callback with a tx stub. findOne() reads
  // tx.lead.findFirst — that's the call we need to intercept.
  const runWithTenant: Mock = vi.fn((_t: string, cbOrMode: unknown, maybeCb?: unknown) => {
    const cb = typeof cbOrMode === 'function' ? cbOrMode : maybeCb;
    return (cb as (tx: { lead: { findFirst: Mock } }) => Promise<unknown>)({
      lead: { findFirst },
    });
  });

  const prisma = {
    runWithTenant,
  } as unknown as import('../../infra/prisma/prisma.service').PrismaService;

  const svc = new LeadsService(
    prisma,
    { log: vi.fn() } as unknown as import('../audit/audit.service').AuditService,
  );

  return { svc, runWithTenant, findFirst };
}

function withTenant<T>(fn: () => Promise<T> | T): Promise<T> {
  return tenantStorage.run(
    { tenantId: 'cabc1234567890123456789abc', userId: 'cuser1234567890123456789a' },
    () => Promise.resolve(fn()),
  );
}

describe('LeadsService.convert', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws LEAD_ALREADY_CONVERTED when the lead is already converted', async () => {
    const { svc } = build({
      id: 'l1',
      tenantId: 'cabc1234567890123456789abc',
      status: 'CONVERTED',
      firstName: 'Ion',
      lastName: 'Pop',
      deletedAt: null,
    });

    await withTenant(async () => {
      await expect(
        svc.convert('l1', { createCompany: false, createDeal: false }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'LEAD_ALREADY_CONVERTED' }),
      });
    });
  });

  it('throws DEAL_MISSING_PIPELINE_STAGE when createDeal=true without pipelineId/stageId', async () => {
    const { svc } = build({
      id: 'l1',
      tenantId: 'cabc1234567890123456789abc',
      status: 'NEW',
      firstName: 'Ion',
      lastName: 'Pop',
      deletedAt: null,
    });

    await withTenant(async () => {
      await expect(
        svc.convert('l1', { createCompany: false, createDeal: true }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'DEAL_MISSING_PIPELINE_STAGE' }),
      });
    });
  });

  it('throws NotFound when the lead does not exist (or belongs to another tenant)', async () => {
    const { svc } = build(null);

    await withTenant(async () => {
      await expect(
        svc.convert('nonexistent', { createCompany: false, createDeal: false }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('throws BadRequest when createDeal=true and only pipelineId is provided', async () => {
    const { svc } = build({
      id: 'l1',
      tenantId: 'cabc1234567890123456789abc',
      status: 'NEW',
      firstName: 'Ion',
      lastName: 'Pop',
      deletedAt: null,
    });

    await withTenant(async () => {
      await expect(
        svc.convert('l1', {
          createCompany: false,
          createDeal: true,
          dealPipelineId: 'p1',
          // dealStageId deliberately missing
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
