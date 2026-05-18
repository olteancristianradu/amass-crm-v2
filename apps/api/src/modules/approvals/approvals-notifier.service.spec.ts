import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationType } from '@prisma/client';
import { ApprovalsNotifierService } from './approvals-notifier.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

function buildFakes() {
  const tx = {
    approvalStep: {
      findFirst: vi.fn(),
    },
    approvalRequest: {
      findFirst: vi.fn(),
    },
    notification: {
      findFirst: vi.fn(),
    },
  };
  const runWithTenant = vi.fn(async (...args: unknown[]) => {
    const fn = args[args.length - 1] as (tx: unknown) => Promise<unknown>;
    return fn(tx);
  });
  const notifications = { create: vi.fn().mockResolvedValue({ id: 'n-1' }) };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const prisma = { runWithTenant } as any;
  const svc = new ApprovalsNotifierService(prisma, notifications as any, audit as any);
  return { svc, tx, notifications, audit };
}

describe('ApprovalsNotifierService', () => {
  let fakes: ReturnType<typeof buildFakes>;
  beforeEach(() => { fakes = buildFakes(); });

  it('notifyApproverAssigned skips if no approverId on step (role-only step)', async () => {
    fakes.tx.approvalStep.findFirst.mockResolvedValueOnce({
      id: 'step-1', approverId: null, order: 0,
      request: { subjectType: 'QUOTE', subjectId: 'q-1' },
    });
    await fakes.svc.notifyApproverAssigned('tenant-1', 'req-1', 'step-1');
    expect(fakes.notifications.create).not.toHaveBeenCalled();
  });

  it('notifyApproverAssigned skips when on cooldown', async () => {
    fakes.tx.approvalStep.findFirst.mockResolvedValueOnce({
      id: 'step-1', approverId: 'u-mgr', order: 0,
      request: { subjectType: 'QUOTE', subjectId: 'q-1' },
    });
    fakes.tx.notification.findFirst.mockResolvedValueOnce({ id: 'recent' });
    await fakes.svc.notifyApproverAssigned('tenant-1', 'req-1', 'step-1');
    expect(fakes.notifications.create).not.toHaveBeenCalled();
  });

  it('notifyApproverAssigned creates APPROVAL_REQUEST notification when fresh', async () => {
    fakes.tx.approvalStep.findFirst.mockResolvedValueOnce({
      id: 'step-1', approverId: 'u-mgr', order: 2,
      request: { subjectType: 'CONTRACT', subjectId: 'c-1' },
    });
    fakes.tx.notification.findFirst.mockResolvedValueOnce(null);
    await fakes.svc.notifyApproverAssigned('tenant-1', 'req-1', 'step-1');
    expect(fakes.notifications.create).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      userId: 'u-mgr',
      type: NotificationType.APPROVAL_REQUEST,
    }));
    expect(fakes.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'approval.notification.sent',
    }));
  });

  it('notifyTerminal fans out to requester with APPROVAL_DECIDED', async () => {
    fakes.tx.approvalRequest.findFirst.mockResolvedValueOnce({
      requestedBy: 'u-rq', subjectType: 'QUOTE', subjectId: 'q-1',
    });
    await fakes.svc.notifyTerminal('tenant-1', 'req-1', 'APPROVED', 'u-mgr');
    expect(fakes.notifications.create).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      userId: 'u-rq',
      type: NotificationType.APPROVAL_DECIDED,
    }));
  });

  it('notifyTerminal is a no-op when the request vanishes', async () => {
    fakes.tx.approvalRequest.findFirst.mockResolvedValueOnce(null);
    await fakes.svc.notifyTerminal('tenant-1', 'req-1', 'APPROVED', 'u-mgr');
    expect(fakes.notifications.create).not.toHaveBeenCalled();
  });

  it('notifyWithdrawn notifies the current approver', async () => {
    fakes.tx.approvalRequest.findFirst.mockResolvedValueOnce({
      currentStep: { approverId: 'u-mgr' },
    });
    await fakes.svc.notifyWithdrawn('tenant-1', 'req-1', 'u-rq', 'changed mind');
    expect(fakes.notifications.create).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      userId: 'u-mgr',
    }));
  });

  it('notifyExpired logs and notifies requester', async () => {
    await fakes.svc.notifyExpired('tenant-1', 'req-1', 'u-rq');
    expect(fakes.notifications.create).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      userId: 'u-rq', type: NotificationType.APPROVAL_DECIDED,
    }));
    expect(fakes.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'approval.request.expired',
    }));
  });

  it('swallows downstream notifier errors (best-effort)', async () => {
    fakes.tx.approvalRequest.findFirst.mockRejectedValueOnce(new Error('db down'));
    // Must NOT throw — the workflow state has already committed.
    await fakes.svc.notifyTerminal('tenant-1', 'req-1', 'APPROVED', 'u-mgr');
  });
});
