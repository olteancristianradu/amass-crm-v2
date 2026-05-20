import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApprovalsService } from './approvals.service';
import type { ApprovalsNotifierService } from './approvals-notifier.service';

// Mock tenant context for the whole suite — every call inside the service
// expects { tenantId, userId } via requireTenantContext.
vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

const makeDecimal = (n: number) => new Prisma.Decimal(n);

/**
 * Build a fake PrismaService whose `runWithTenant(tenantId, ...args)` proxies
 * to a fake tx object. Tests inject the tx behaviour per-test by stubbing the
 * methods they need.
 */
function buildFakePrisma() {
  const tx = {
    approvalPolicy: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    approvalRequest: {
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    approvalStep: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    approvalDecision: {
      create: vi.fn(),
    },
    quote: {
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };
  // runWithTenant signature: (tenantId, fn) | (tenantId, mode, fn). We unwrap
  // the trailing function argument and call it with the tx mock.
  const runWithTenant = vi.fn(async (...args: unknown[]) => {
    const fn = args[args.length - 1] as (tx: unknown) => Promise<unknown>;
    return fn(tx);
  });
  const tenant = {
    findMany: vi.fn(),
  };
  const prisma = { runWithTenant, tenant } as any;
  return { prisma, tx, runWithTenant };
}

function buildFakeNotifier(): ApprovalsNotifierService {
  return {
    notifyApproverAssigned: vi.fn().mockResolvedValue(undefined),
    notifyTerminal: vi.fn().mockResolvedValue(undefined),
    notifyWithdrawn: vi.fn().mockResolvedValue(undefined),
    notifyExpired: vi.fn().mockResolvedValue(undefined),
  } as unknown as ApprovalsNotifierService;
}

describe('ApprovalsService — policy CRUD', () => {
  let svc: ApprovalsService;
  let tx: ReturnType<typeof buildFakePrisma>['tx'];

  beforeEach(() => {
    const fakes = buildFakePrisma();
    tx = fakes.tx;
    svc = new ApprovalsService(fakes.prisma, buildFakeNotifier());
  });

  it('createPolicy rejects when triggerConfig fails strict shape', async () => {
    await expect(
      svc.createPolicy({
        name: 'P',
        trigger: 'QUOTE_ABOVE_VALUE',
        config: { threshold: -1 }, // negative — TriggerConfigQuoteAboveValue.threshold.positive
        approverId: 'u1',
        subjectType: 'QUOTE',
        isActive: true,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('createPolicy stores stepsConfig as Json and stamps tenantId', async () => {
    tx.approvalPolicy.create.mockResolvedValue({ id: 'pol-1' });
    await svc.createPolicy({
      name: 'P',
      trigger: 'QUOTE_ABOVE_VALUE',
      config: { threshold: 50000, currency: 'RON' },
      subjectType: 'QUOTE',
      stepsConfig: [
        { order: 0, approverId: 'u-mgr', slaHours: 24 },
        { order: 1, approverId: 'u-vp', slaHours: 48 },
      ],
      isActive: true,
    });
    expect(tx.approvalPolicy.create).toHaveBeenCalledOnce();
    const args = tx.approvalPolicy.create.mock.calls[0][0];
    expect(args.data.tenantId).toBe('tenant-1');
    expect(Array.isArray(args.data.stepsConfig)).toBe(true);
  });

  it('updatePolicy refuses snapshot-bearing change when in-flight requests exist', async () => {
    tx.approvalPolicy.findFirst.mockResolvedValueOnce({ id: 'pol-1', tenantId: 'tenant-1' });
    tx.approvalRequest.count.mockResolvedValueOnce(2);
    await expect(
      svc.updatePolicy('pol-1', {
        trigger: 'QUOTE_ABOVE_VALUE',
        config: { threshold: 100000 },
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('updatePolicy allows isActive flip even with in-flight requests', async () => {
    tx.approvalPolicy.findFirst.mockResolvedValueOnce({ id: 'pol-1', tenantId: 'tenant-1' });
    tx.approvalPolicy.update.mockResolvedValueOnce({ id: 'pol-1', isActive: false });
    const out = await svc.updatePolicy('pol-1', { isActive: false });
    expect(out).toBeDefined();
    expect(tx.approvalRequest.count).not.toHaveBeenCalled();
  });

  it('removePolicy soft-deletes', async () => {
    tx.approvalPolicy.findFirst.mockResolvedValueOnce({ id: 'pol-1' });
    tx.approvalPolicy.update.mockResolvedValueOnce({ id: 'pol-1' });
    await svc.removePolicy('pol-1');
    expect(tx.approvalPolicy.update).toHaveBeenCalledWith({
      where: { id: 'pol-1' },
      data: expect.objectContaining({ deletedAt: expect.any(Date), isActive: false }),
    });
  });
});

describe('ApprovalsService — checkAndRequestApproval (polymorphic + legacy)', () => {
  let svc: ApprovalsService;
  let tx: ReturnType<typeof buildFakePrisma>['tx'];

  beforeEach(() => {
    const fakes = buildFakePrisma();
    tx = fakes.tx;
    svc = new ApprovalsService(fakes.prisma, buildFakeNotifier());
  });

  it('returns false when no active policies match the subject type', async () => {
    tx.approvalPolicy.findMany.mockResolvedValueOnce([]);
    const result = await svc.checkAndRequestApproval('quote-1', makeDecimal(100), 'RON');
    expect(result).toBe(false);
  });

  it('returns true and opens a request when a QUOTE policy matches', async () => {
    tx.approvalPolicy.findMany.mockResolvedValueOnce([
      {
        id: 'pol-1',
        trigger: 'QUOTE_ABOVE_VALUE',
        config: { threshold: 50, currency: 'RON' },
        stepsConfig: [{ order: 0, approverId: 'u-mgr' }],
        approverId: null,
      },
    ]);
    // existing in-flight lookup
    tx.approvalRequest.findFirst.mockResolvedValue(null);
    // assertPolicy fetch inside openRequest
    tx.approvalPolicy.findFirst.mockResolvedValue({
      id: 'pol-1',
      stepsConfig: [{ order: 0, approverId: 'u-mgr' }],
      approverId: null,
    });
    tx.approvalRequest.create.mockResolvedValue({ id: 'req-1' });
    tx.approvalStep.create.mockResolvedValue({ id: 'step-1', order: 0 });
    // advanceUntilHumanStep loop reads
    tx.approvalRequest.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      status: 'PENDING',
      currentStepId: null,
      currentStep: null,
    });
    tx.approvalStep.findFirst.mockResolvedValueOnce({
      id: 'step-1',
      order: 0,
      approverId: 'u-mgr',
      slaHours: 24,
    });
    tx.approvalStep.update.mockResolvedValue({});
    tx.approvalRequest.update.mockResolvedValue({});
    // getRequest tail
    tx.approvalRequest.findFirst.mockResolvedValue({
      id: 'req-1',
      status: 'PENDING',
      steps: [],
      decisions: [],
    });

    const result = await svc.checkAndRequestApproval('quote-1', makeDecimal(200), 'RON');
    expect(result).toBe(true);
  });

  it('returns false when quote value is below threshold', async () => {
    tx.approvalPolicy.findMany.mockResolvedValueOnce([
      {
        id: 'pol-1',
        trigger: 'QUOTE_ABOVE_VALUE',
        config: { threshold: 500 },
        stepsConfig: [{ order: 0, approverId: 'u-mgr' }],
        approverId: null,
      },
    ]);
    const result = await svc.checkAndRequestApproval('quote-1', makeDecimal(100), 'RON');
    expect(result).toBe(false);
  });

  it('returns false when currency does not match policy config', async () => {
    tx.approvalPolicy.findMany.mockResolvedValueOnce([
      {
        id: 'pol-1',
        trigger: 'QUOTE_ABOVE_VALUE',
        config: { threshold: 50, currency: 'EUR' },
        stepsConfig: [{ order: 0, approverId: 'u-mgr' }],
        approverId: null,
      },
    ]);
    const result = await svc.checkAndRequestApproval('quote-1', makeDecimal(200), 'RON');
    expect(result).toBe(false);
  });

  it('skips duplicate request for the same (policy, subject) when one is already in-flight', async () => {
    tx.approvalPolicy.findMany.mockResolvedValueOnce([
      {
        id: 'pol-1',
        trigger: 'QUOTE_ABOVE_VALUE',
        config: { threshold: 50, currency: 'RON' },
        stepsConfig: [{ order: 0, approverId: 'u-mgr' }],
        approverId: null,
      },
    ]);
    // Existing in-flight match → service skips opening another.
    tx.approvalRequest.findFirst.mockResolvedValue({ id: 'req-existing', status: 'PENDING' });
    const result = await svc.checkAndRequestApproval('quote-1', makeDecimal(200), 'RON');
    expect(result).toBe(true);
    expect(tx.approvalRequest.create).not.toHaveBeenCalled();
  });
});

describe('ApprovalsService — decide', () => {
  let svc: ApprovalsService;
  let tx: ReturnType<typeof buildFakePrisma>['tx'];

  beforeEach(() => {
    const fakes = buildFakePrisma();
    tx = fakes.tx;
    svc = new ApprovalsService(fakes.prisma, buildFakeNotifier());
  });

  it('rejects when request is in a terminal state (REQUEST_NOT_PENDING)', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'req-1' }]);
    tx.approvalRequest.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      status: 'APPROVED',
      requestedBy: 'u2',
      currentStepId: null,
      currentStep: null,
      policy: {},
    });
    await expect(svc.decide('req-1', { status: 'APPROVED' })).rejects.toThrow(ConflictException);
  });

  it('rejects when caller is the requester (T-APPR-E-01 hard guard)', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'req-1' }]);
    tx.approvalRequest.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      status: 'PENDING',
      requestedBy: 'user-1', // same as mocked context userId
      currentStepId: 'step-1',
      currentStep: { id: 'step-1', status: 'ACTIVE', approverId: 'user-1', order: 0 },
      policy: {},
    });
    await expect(svc.decide('req-1', { status: 'APPROVED' })).rejects.toThrow(ForbiddenException);
  });

  it('rejects when caller is not the assigned approver', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'req-1' }]);
    tx.approvalRequest.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      status: 'PENDING',
      requestedBy: 'u2',
      currentStepId: 'step-1',
      currentStep: { id: 'step-1', status: 'ACTIVE', approverId: 'someone-else', order: 0 },
      policy: {},
    });
    await expect(svc.decide('req-1', { status: 'APPROVED' })).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFound when SELECT FOR UPDATE returns 0 rows', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(svc.decide('req-1', { status: 'APPROVED' })).rejects.toThrow(NotFoundException);
  });

  it('rejects when current step is not ACTIVE (STALE_REQUEST)', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'req-1' }]);
    tx.approvalRequest.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      status: 'PENDING',
      requestedBy: 'u2',
      currentStepId: 'step-1',
      currentStep: { id: 'step-1', status: 'PENDING', approverId: 'user-1', order: 0 },
      policy: {},
    });
    await expect(svc.decide('req-1', { status: 'APPROVED' })).rejects.toThrow(ConflictException);
  });

  it('approves and advances to next pending step', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'req-1' }]);
    tx.approvalRequest.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      status: 'PENDING',
      requestedBy: 'u2',
      currentStepId: 'step-1',
      currentStep: { id: 'step-1', status: 'ACTIVE', approverId: 'user-1', order: 0 },
      policy: {},
    });
    tx.approvalDecision.create.mockResolvedValue({});
    tx.approvalStep.update.mockResolvedValue({});
    tx.approvalStep.findFirst.mockResolvedValueOnce({
      id: 'step-2',
      order: 1,
      slaHours: 24,
    });
    tx.approvalRequest.update.mockResolvedValue({});
    // post-commit calls
    tx.approvalRequest.findFirst.mockResolvedValue({
      id: 'req-1',
      status: 'IN_PROGRESS',
      requestedBy: 'u2',
      currentStep: { id: 'step-2', status: 'ACTIVE', approverId: 'next' },
    });
    tx.approvalStep.findFirst.mockResolvedValueOnce(null);

    const out = await svc.decide('req-1', { status: 'APPROVED' });
    expect(out.status).toBe('IN_PROGRESS');
  });

  it('approves at last step → request status APPROVED', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'req-1' }]);
    tx.approvalRequest.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      status: 'IN_PROGRESS',
      requestedBy: 'u2',
      currentStepId: 'step-final',
      currentStep: { id: 'step-final', status: 'ACTIVE', approverId: 'user-1', order: 1 },
      policy: {},
    });
    tx.approvalDecision.create.mockResolvedValue({});
    tx.approvalStep.update.mockResolvedValue({});
    tx.approvalStep.findFirst.mockResolvedValueOnce(null); // no next step
    tx.approvalRequest.update.mockResolvedValue({});
    // applySubjectSideEffects tail
    tx.approvalRequest.findFirst.mockResolvedValue({
      id: 'req-1',
      status: 'APPROVED',
      subjectType: 'QUOTE',
      subjectId: 'q-1',
      quoteId: 'q-1',
    });
    tx.approvalRequest.findMany.mockResolvedValueOnce([{ id: 'req-1', status: 'APPROVED' }]);

    const out = await svc.decide('req-1', { status: 'APPROVED' });
    expect(out.status).toBe('APPROVED');
  });

  it('rejects at any step → request status REJECTED (chain terminated)', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'req-1' }]);
    tx.approvalRequest.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      status: 'PENDING',
      requestedBy: 'u2',
      currentStepId: 'step-1',
      currentStep: { id: 'step-1', status: 'ACTIVE', approverId: 'user-1', order: 0 },
      policy: {},
    });
    tx.approvalDecision.create.mockResolvedValue({});
    tx.approvalStep.update.mockResolvedValue({});
    tx.approvalRequest.update.mockResolvedValue({});
    tx.approvalRequest.findFirst.mockResolvedValue({
      id: 'req-1',
      status: 'REJECTED',
      subjectType: 'QUOTE',
      subjectId: 'q-1',
      quoteId: 'q-1',
    });
    tx.approvalRequest.findMany.mockResolvedValueOnce([{ id: 'req-1', status: 'REJECTED' }]);
    tx.quote.update.mockResolvedValue({});

    const out = await svc.decide('req-1', { status: 'REJECTED', comment: 'too high' });
    expect(out.status).toBe('REJECTED');
  });
});

describe('ApprovalsService — withdraw', () => {
  let svc: ApprovalsService;
  let tx: ReturnType<typeof buildFakePrisma>['tx'];

  beforeEach(() => {
    const fakes = buildFakePrisma();
    tx = fakes.tx;
    svc = new ApprovalsService(fakes.prisma, buildFakeNotifier());
  });

  it('refuses withdraw from non-requester', async () => {
    tx.approvalRequest.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      requestedBy: 'someone-else',
      status: 'PENDING',
      currentStepId: 'step-1',
      currentStep: { id: 'step-1', approverId: 'user-1' },
    });
    await expect(svc.withdraw('req-1', { reason: 'changed mind' })).rejects.toThrow(ForbiddenException);
  });

  it('refuses withdraw on terminal request', async () => {
    tx.approvalRequest.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      requestedBy: 'user-1',
      status: 'APPROVED',
      currentStepId: null,
      currentStep: null,
    });
    await expect(svc.withdraw('req-1', { reason: 'too late' })).rejects.toThrow(ConflictException);
  });

  it('transitions to CANCELLED and skips current step on success', async () => {
    tx.approvalRequest.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      requestedBy: 'user-1',
      status: 'PENDING',
      currentStepId: 'step-1',
      currentStep: { id: 'step-1', approverId: 'other' },
    });
    tx.approvalDecision.create.mockResolvedValue({});
    tx.approvalStep.update.mockResolvedValue({});
    tx.approvalRequest.update.mockResolvedValue({});
    const out = await svc.withdraw('req-1', { reason: 'renegotiating' });
    expect(out.status).toBe('CANCELLED');
    expect(tx.approvalStep.update).toHaveBeenCalledWith({
      where: { id: 'step-1' },
      data: expect.objectContaining({ status: 'SKIPPED' }),
    });
  });
});

describe('ApprovalsService — listing', () => {
  let svc: ApprovalsService;
  let tx: ReturnType<typeof buildFakePrisma>['tx'];

  beforeEach(() => {
    const fakes = buildFakePrisma();
    tx = fakes.tx;
    svc = new ApprovalsService(fakes.prisma, buildFakeNotifier());
  });

  it('listRequests with assignedToMe scopes via currentStep.approverId', async () => {
    tx.approvalRequest.findMany.mockResolvedValueOnce([{ id: 'req-1' }]);
    await svc.listRequests({ assignedToMe: true });
    const args = tx.approvalRequest.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      tenantId: 'tenant-1',
      currentStep: { approverId: 'user-1', status: 'ACTIVE' },
    });
  });

  it('listMyInbox is a shortcut to listRequests({assignedToMe:true})', async () => {
    tx.approvalRequest.findMany.mockResolvedValueOnce([]);
    await svc.listMyInbox();
    expect(tx.approvalRequest.findMany).toHaveBeenCalledOnce();
  });
});

describe('ApprovalsService — expireOverdueForTenant', () => {
  let svc: ApprovalsService;
  let tx: ReturnType<typeof buildFakePrisma>['tx'];

  beforeEach(() => {
    const fakes = buildFakePrisma();
    tx = fakes.tx;
    svc = new ApprovalsService(fakes.prisma, buildFakeNotifier());
  });

  it('returns 0 when no overdue rows found', async () => {
    tx.approvalRequest.findMany.mockResolvedValueOnce([]);
    const out = await svc.expireOverdueForTenant('tenant-1');
    expect(out).toBe(0);
  });

  it('transitions overdue rows to EXPIRED and counts them', async () => {
    tx.approvalRequest.findMany.mockResolvedValueOnce([
      { id: 'req-1', requestedBy: 'u-rq', currentStepId: 'step-1' },
      { id: 'req-2', requestedBy: 'u-rq', currentStepId: null },
    ]);
    // For each row, the inner tx body queries findFirst → returns fresh row → updates.
    tx.approvalRequest.findFirst
      .mockResolvedValueOnce({ id: 'req-1', status: 'PENDING' })
      .mockResolvedValueOnce({ id: 'req-2', status: 'PENDING' });
    tx.approvalDecision.create.mockResolvedValue({});
    tx.approvalStep.update.mockResolvedValue({});
    tx.approvalRequest.update.mockResolvedValue({});

    const out = await svc.expireOverdueForTenant('tenant-1');
    expect(out).toBe(2);
  });

  it('skips rows that transitioned out of PENDING between SELECT and UPDATE (race)', async () => {
    tx.approvalRequest.findMany.mockResolvedValueOnce([
      { id: 'req-1', requestedBy: 'u-rq', currentStepId: 'step-1' },
    ]);
    // Inner re-check returns null (already terminal) → skip.
    tx.approvalRequest.findFirst.mockResolvedValueOnce(null);
    const out = await svc.expireOverdueForTenant('tenant-1');
    expect(out).toBe(0);
  });
});

describe('ApprovalsService — Phase 2.1 regression (CRIT-4, B-1, B-2/B-3)', () => {
  let svc: ApprovalsService;
  let tx: ReturnType<typeof buildFakePrisma>['tx'];
  let notifier: ApprovalsNotifierService;

  beforeEach(() => {
    const fakes = buildFakePrisma();
    tx = fakes.tx;
    notifier = buildFakeNotifier();
    svc = new ApprovalsService(fakes.prisma, notifier);
  });

  // CRIT-4 — a role-based step (approverId null + approverRole set) must NOT
  // be decidable by any authenticated user. Before the fix the guard
  // short-circuited on `approverId &&` and let anyone through.
  it('CRIT-4: rejects decision on a role-based step when decider role does not match', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'req-1' }]);
    tx.approvalRequest.findFirst.mockResolvedValueOnce({
      id: 'req-1',
      status: 'PENDING',
      requestedBy: 'u2',
      currentStepId: 'step-1',
      currentStep: { id: 'step-1', status: 'ACTIVE', approverId: null, approverRole: 'OWNER', order: 0 },
      policy: {},
    });
    // Mocked context role is undefined → fail closed.
    await expect(svc.decide('req-1', { status: 'APPROVED' })).rejects.toThrow(ForbiddenException);
    expect(tx.approvalDecision.create).not.toHaveBeenCalled();
  });

  // B-1 / MED-1 — the gate must treat an existing APPROVED request as
  // satisfying the policy: do not block, do not duplicate.
  it('B-1: gate returns false and opens no new request when an APPROVED request exists', async () => {
    tx.approvalPolicy.findMany.mockResolvedValueOnce([
      { id: 'p1', trigger: 'QUOTE_ABOVE_VALUE', config: { threshold: 50 }, subjectType: 'QUOTE' },
    ]);
    tx.approvalRequest.findFirst.mockResolvedValueOnce({ id: 'r1', status: 'APPROVED' });

    const blocked = await svc.checkAndRequestApproval('quote-1', makeDecimal(100), 'RON');
    expect(blocked).toBe(false);
    expect(tx.approvalRequest.create).not.toHaveBeenCalled();
  });

  // B-1 — an in-flight PENDING request blocks the transition but is not duplicated.
  it('B-1: gate blocks but does not duplicate when a PENDING request exists', async () => {
    tx.approvalPolicy.findMany.mockResolvedValueOnce([
      { id: 'p1', trigger: 'QUOTE_ABOVE_VALUE', config: { threshold: 50 }, subjectType: 'QUOTE' },
    ]);
    tx.approvalRequest.findFirst.mockResolvedValueOnce({ id: 'r1', status: 'PENDING' });

    const blocked = await svc.checkAndRequestApproval('quote-1', makeDecimal(100), 'RON');
    expect(blocked).toBe(true);
    expect(tx.approvalRequest.create).not.toHaveBeenCalled();
  });

  // B-2 / B-3 — decide() must NOT activate the next step in-transaction. It
  // clears currentStepId so advanceUntilHumanStep activates + notifies the
  // next approver post-commit.
  it('B-2/B-3: approving a non-final step clears currentStepId and notifies the next approver', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'req-1' }]);
    tx.approvalRequest.findFirst
      .mockResolvedValueOnce({
        id: 'req-1',
        status: 'IN_PROGRESS',
        requestedBy: 'u2',
        currentStepId: 'step-1',
        currentStep: { id: 'step-1', status: 'ACTIVE', approverId: 'user-1', order: 0 },
        policy: {},
      })
      .mockResolvedValueOnce({
        id: 'req-1',
        status: 'IN_PROGRESS',
        subjectType: 'CONTRACT',
        subjectId: 'c-1',
        quoteId: null,
      })
      .mockResolvedValueOnce({
        id: 'req-1',
        status: 'IN_PROGRESS',
        currentStepId: null,
        currentStep: null,
      });
    tx.approvalStep.findFirst
      .mockResolvedValueOnce({ id: 'step-2', order: 1, slaHours: null })
      .mockResolvedValueOnce({
        id: 'step-2',
        order: 1,
        approverId: 'next-approver',
        approverRole: null,
        slaHours: null,
      });
    tx.approvalDecision.create.mockResolvedValue({});
    tx.approvalStep.update.mockResolvedValue({});
    tx.approvalRequest.update.mockResolvedValue({});

    const out = await svc.decide('req-1', { status: 'APPROVED' });

    expect(out.status).toBe('IN_PROGRESS');
    expect(tx.approvalRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { status: 'IN_PROGRESS', currentStepId: null },
    });
    expect(notifier.notifyApproverAssigned).toHaveBeenCalledWith('tenant-1', 'req-1', 'step-2');
  });
});
