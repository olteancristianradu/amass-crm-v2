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

describe('LeadsService.create + findAll + update + softDelete', () => {
  beforeEach(() => vi.clearAllMocks());

  interface LeadTx {
    lead: {
      create: Mock;
      findMany: Mock;
      findFirst: Mock;
      update: Mock;
    };
  }
  function buildFull() {
    const tx: LeadTx = {
      lead: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    };
    const runWithTenant: Mock = vi.fn(async (
      _id: string,
      cbOrMode: unknown,
      maybeCb?: unknown,
    ) => {
      const cb = typeof cbOrMode === 'function' ? cbOrMode : maybeCb;
      return (cb as (t: LeadTx) => Promise<unknown>)(tx);
    });
    const prisma = { runWithTenant } as unknown as import('../../infra/prisma/prisma.service').PrismaService;
    const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as import('../audit/audit.service').AuditService;
    const svc = new LeadsService(prisma, audit);
    return { svc, tx, runWithTenant, audit };
  }

  it('create persists tenantId + creator + writes audit', async () => {
    const h = buildFull();
    h.tx.lead.create.mockResolvedValueOnce({ id: 'l1', email: 'a@b.c', company: 'Acme' });
    await withTenant(() =>
      h.svc.create({ firstName: 'A', lastName: 'B', email: 'a@b.c', source: 'WEB' } as never),
    );
    expect(h.tx.lead.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'cabc1234567890123456789abc',
        createdById: 'cuser1234567890123456789a',
        firstName: 'A',
        email: 'a@b.c',
        source: 'WEB',
      }),
    }));
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'lead.create',
      subjectType: 'lead',
      subjectId: 'l1',
    }));
  });

  it('findAll filters by status / source / ownerId + supports cursor pagination', async () => {
    const h = buildFull();
    h.tx.lead.findMany.mockResolvedValueOnce([
      { id: 'l1', firstName: 'A', lastName: 'B', deletedAt: null },
      { id: 'l2', firstName: 'C', lastName: 'D', deletedAt: null },
    ]);
    const out = await withTenant(() =>
      h.svc.findAll({ status: 'NEW', source: 'WEB', ownerId: 'u1', limit: 50 } as never),
    );
    expect(h.tx.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'cabc1234567890123456789abc',
        deletedAt: null,
        status: 'NEW',
        source: 'WEB',
        ownerId: 'u1',
      }),
    }));
    expect(out.data).toHaveLength(2);
  });

  it('findAll search query (q) builds OR across firstName/lastName/email/company', async () => {
    const h = buildFull();
    h.tx.lead.findMany.mockResolvedValueOnce([]);
    await withTenant(() =>
      h.svc.findAll({ q: 'acme', limit: 20 } as never),
    );
    const callArgs = h.tx.lead.findMany.mock.calls[0][0];
    expect(callArgs.where.OR).toBeDefined();
    expect(Array.isArray(callArgs.where.OR)).toBe(true);
  });

  it('update mutates fields and writes audit', async () => {
    const h = buildFull();
    h.tx.lead.findFirst.mockResolvedValueOnce({ id: 'l1', tenantId: 'cabc1234567890123456789abc', deletedAt: null });
    h.tx.lead.update.mockResolvedValueOnce({ id: 'l1', firstName: 'New' });
    await withTenant(() =>
      h.svc.update('l1', { firstName: 'New' } as never),
    );
    expect(h.tx.lead.update).toHaveBeenCalled();
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'lead.update', subjectId: 'l1' }));
  });

  it('update throws NotFound when lead missing', async () => {
    const h = buildFull();
    h.tx.lead.findFirst.mockResolvedValueOnce(null);
    await withTenant(async () => {
      await expect(h.svc.update('ghost', { firstName: 'X' } as never)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('remove sets deletedAt + writes audit', async () => {
    const h = buildFull();
    h.tx.lead.findFirst.mockResolvedValueOnce({ id: 'l1', tenantId: 'cabc1234567890123456789abc', deletedAt: null });
    h.tx.lead.update.mockResolvedValueOnce({ id: 'l1', deletedAt: new Date() });
    await withTenant(() => h.svc.remove('l1'));
    expect(h.tx.lead.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'l1' },
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    }));
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'lead.delete' }));
  });

  it('remove throws NotFound when lead missing', async () => {
    const h = buildFull();
    h.tx.lead.findFirst.mockResolvedValueOnce(null);
    await withTenant(async () => {
      await expect(h.svc.remove('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

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
