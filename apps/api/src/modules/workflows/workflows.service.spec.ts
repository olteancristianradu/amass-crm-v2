import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

import { WorkflowsService } from './workflows.service';

function build() {
  const tx = {
    workflow: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    workflowStep: { findMany: vi.fn() },
    workflowRun: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    note: { create: vi.fn() },
    task: { create: vi.fn() },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof WorkflowsService>[0];
  const queue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) } as unknown as ConstructorParameters<typeof WorkflowsService>[1];
  const campaigns = { launch: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof WorkflowsService>[2];
  const emails = { sendTransactional: vi.fn().mockResolvedValue({ id: 'm-1' }) } as unknown as ConstructorParameters<typeof WorkflowsService>[3];
  const svc = new WorkflowsService(prisma, queue, campaigns, emails);
  return { svc, prisma, tx, queue, campaigns, emails };
}

describe('WorkflowsService — CRUD', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create() persists tenantId, defaults isActive=true, and order-indexes steps', async () => {
    const h = build();
    h.tx.workflow.create.mockResolvedValueOnce({ id: 'w-1', steps: [] });
    await h.svc.create({
      name: 'Welcome',
      trigger: 'COMPANY_CREATED',
      steps: [
        { actionType: 'ADD_NOTE', actionConfig: { body: 'Hi' } },
        { actionType: 'CREATE_TASK', order: 5, actionConfig: { title: 'Call' } },
      ],
    } as never);
    const args = h.tx.workflow.create.mock.calls[0][0];
    expect(args.data.tenantId).toBe('tenant-1');
    expect(args.data.isActive).toBe(true);
    expect(args.data.steps.create[0].order).toBe(0);
    expect(args.data.steps.create[1].order).toBe(5);
  });

  it('findOne() throws WORKFLOW_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.workflow.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findOne('ghost')).rejects.toThrow(NotFoundException);
  });

  it('remove() soft-deletes via deletedAt', async () => {
    const h = build();
    h.tx.workflow.findFirst.mockResolvedValueOnce({ id: 'w-1' });
    h.tx.workflow.update.mockResolvedValueOnce({ id: 'w-1' });
    await h.svc.remove('w-1');
    const data = h.tx.workflow.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
  });
});

describe('WorkflowsService.trigger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips a workflow when DEAL_STAGE_CHANGED config.stageId does not match the event stageId', async () => {
    const h = build();
    h.tx.workflow.findMany.mockResolvedValueOnce([
      {
        id: 'w-1',
        triggerConfig: { stageId: 'stage-A' },
        steps: [],
      },
    ]);
    await h.svc.trigger({
      trigger: 'DEAL_STAGE_CHANGED',
      subjectType: 'DEAL',
      subjectId: 'd-1',
      tenantId: 'tenant-1',
      stageId: 'stage-B',
    });
    expect(h.tx.workflowRun.create).not.toHaveBeenCalled();
  });

  it('runs a workflow when DEAL_STAGE_CHANGED config has no stageId filter', async () => {
    const h = build();
    h.tx.workflow.findMany.mockResolvedValueOnce([
      { id: 'w-1', triggerConfig: {}, steps: [] },
    ]);
    h.tx.workflowRun.findFirst.mockResolvedValueOnce(null);
    h.tx.workflowRun.create.mockResolvedValueOnce({ id: 'r-1' });
    await h.svc.trigger({
      trigger: 'DEAL_STAGE_CHANGED',
      subjectType: 'DEAL',
      subjectId: 'd-1',
      tenantId: 'tenant-1',
      stageId: 'stage-X',
    });
    expect(h.tx.workflowRun.create).toHaveBeenCalled();
  });

  it('does not double-run a workflow that already has a RUNNING run for the same subject', async () => {
    const h = build();
    h.tx.workflow.findMany.mockResolvedValueOnce([{ id: 'w-1', triggerConfig: {}, steps: [] }]);
    h.tx.workflowRun.findFirst.mockResolvedValueOnce({ id: 'existing' });
    await h.svc.trigger({
      trigger: 'COMPANY_CREATED',
      subjectType: 'COMPANY',
      subjectId: 'co-1',
      tenantId: 'tenant-1',
    });
    expect(h.tx.workflowRun.create).not.toHaveBeenCalled();
  });

  it('swallows errors so a failure never bubbles into the request handler', async () => {
    const h = build();
    h.tx.workflow.findMany.mockRejectedValueOnce(new Error('boom'));
    await expect(
      h.svc.trigger({
        trigger: 'COMPANY_CREATED',
        subjectType: 'COMPANY',
        subjectId: 'co-1',
        tenantId: 'tenant-1',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('WorkflowsService.executeFromStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns silently when the run is missing or no longer RUNNING', async () => {
    const h = build();
    h.tx.workflowRun.findFirst.mockResolvedValueOnce(null);
    await h.svc.executeFromStep('r-1', 'tenant-1', 0);
    expect(h.tx.workflowRun.update).not.toHaveBeenCalled();
  });

  it('marks the run COMPLETED when no steps remain', async () => {
    const h = build();
    h.tx.workflowRun.findFirst.mockResolvedValueOnce({
      id: 'r-1',
      status: 'RUNNING',
      workflowId: 'w-1',
      subjectType: 'COMPANY',
      subjectId: 'co-1',
    });
    await h.svc.executeFromStep('r-1', 'tenant-1', 0, []);
    const lastUpdate = h.tx.workflowRun.update.mock.calls.at(-1)![0];
    expect(lastUpdate.data.status).toBe('COMPLETED');
    expect(lastUpdate.data.completedAt).toBeInstanceOf(Date);
  });

  it('pauses on WAIT_DAYS by enqueueing a delayed resume job and stops without completing', async () => {
    const h = build();
    h.tx.workflowRun.findFirst.mockResolvedValueOnce({
      id: 'r-1',
      status: 'RUNNING',
      workflowId: 'w-1',
      subjectType: 'COMPANY',
      subjectId: 'co-1',
    });
    const steps = [
      { id: 's-1', order: 0, actionType: 'WAIT_DAYS', actionConfig: { days: 3 } },
      { id: 's-2', order: 1, actionType: 'ADD_NOTE', actionConfig: { body: 'after' } },
    ];
    await h.svc.executeFromStep('r-1', 'tenant-1', 0, steps as never);
    expect(h.queue.add).toHaveBeenCalledWith(
      'resume',
      { runId: 'r-1', tenantId: 'tenant-1', stepIndex: 1 },
      { delay: 3 * 24 * 60 * 60 * 1000 },
    );
    // We did NOT mark COMPLETED — paused, will resume.
    const lastUpdate = h.tx.workflowRun.update.mock.calls.at(-1)![0];
    expect(lastUpdate.data.status).not.toBe('COMPLETED');
    // Note step never ran.
    expect(h.tx.note.create).not.toHaveBeenCalled();
  });

  it('falls back to days=1 when WAIT_DAYS config has no numeric days', async () => {
    const h = build();
    h.tx.workflowRun.findFirst.mockResolvedValueOnce({
      id: 'r-1',
      status: 'RUNNING',
      workflowId: 'w-1',
      subjectType: 'COMPANY',
      subjectId: 'co-1',
    });
    await h.svc.executeFromStep('r-1', 'tenant-1', 0, [
      { id: 's-1', order: 0, actionType: 'WAIT_DAYS', actionConfig: {} },
    ] as never);
    expect(h.queue.add).toHaveBeenCalledWith(
      'resume',
      expect.anything(),
      { delay: 1 * 24 * 60 * 60 * 1000 },
    );
  });
});

describe('WorkflowsService — step actions', () => {
  beforeEach(() => vi.clearAllMocks());

  function setupRun(subjectType: string, subjectId: string) {
    const h = build();
    h.tx.workflowRun.findFirst.mockResolvedValueOnce({
      id: 'r-1',
      status: 'RUNNING',
      workflowId: 'w-1',
      subjectType,
      subjectId,
    });
    return h;
  }

  it('ADD_NOTE creates a note when subjectType is COMPANY/CONTACT/CLIENT', async () => {
    const h = setupRun('CONTACT', 'c-1');
    await h.svc.executeFromStep('r-1', 'tenant-1', 0, [
      { id: 's-1', order: 0, actionType: 'ADD_NOTE', actionConfig: { body: 'Hi' } },
    ] as never);
    expect(h.tx.note.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ subjectType: 'CONTACT', subjectId: 'c-1', body: 'Hi' }),
      }),
    );
  });

  it('ADD_NOTE skips when run subjectType is DEAL (notes are not polymorphic over deals)', async () => {
    const h = setupRun('DEAL', 'd-1');
    await h.svc.executeFromStep('r-1', 'tenant-1', 0, [
      { id: 's-1', order: 0, actionType: 'ADD_NOTE', actionConfig: { body: 'Hi' } },
    ] as never);
    expect(h.tx.note.create).not.toHaveBeenCalled();
  });

  it('CREATE_TASK on a DEAL writes dealId, not subjectType/subjectId', async () => {
    const h = setupRun('DEAL', 'd-1');
    await h.svc.executeFromStep('r-1', 'tenant-1', 0, [
      { id: 's-1', order: 0, actionType: 'CREATE_TASK', actionConfig: { title: 'Follow up', dueInDays: 2 } },
    ] as never);
    const data = h.tx.task.create.mock.calls[0][0].data;
    expect(data.dealId).toBe('d-1');
    expect(data.subjectType).toBeUndefined();
    expect(data.subjectId).toBeUndefined();
    expect(data.title).toBe('Follow up');
    expect(data.dueAt).toBeInstanceOf(Date);
  });

  it('CREATE_TASK on a COMPANY writes subjectType + subjectId, not dealId', async () => {
    const h = setupRun('COMPANY', 'co-1');
    await h.svc.executeFromStep('r-1', 'tenant-1', 0, [
      { id: 's-1', order: 0, actionType: 'CREATE_TASK', actionConfig: { title: 'X' } },
    ] as never);
    const data = h.tx.task.create.mock.calls[0][0].data;
    expect(data.dealId).toBeUndefined();
    expect(data.subjectType).toBe('COMPANY');
    expect(data.subjectId).toBe('co-1');
  });

  it('SEND_EMAIL skips silently when to/subject/bodyHtml are missing', async () => {
    const h = setupRun('CONTACT', 'c-1');
    await h.svc.executeFromStep('r-1', 'tenant-1', 0, [
      { id: 's-1', order: 0, actionType: 'SEND_EMAIL', actionConfig: { to: 'x@y.ro' } }, // missing subject + body
    ] as never);
    expect(h.emails.sendTransactional).not.toHaveBeenCalled();
  });

  it('SEND_EMAIL dispatches when to/subject/bodyHtml are all set', async () => {
    const h = setupRun('CONTACT', 'c-1');
    await h.svc.executeFromStep('r-1', 'tenant-1', 0, [
      {
        id: 's-1',
        order: 0,
        actionType: 'SEND_EMAIL',
        actionConfig: { to: 'x@y.ro', subject: 'Hi', bodyHtml: '<p>Hi</p>' },
      },
    ] as never);
    expect(h.emails.sendTransactional).toHaveBeenCalledWith('tenant-1', {
      to: 'x@y.ro',
      subject: 'Hi',
      bodyHtml: '<p>Hi</p>',
      bodyText: undefined,
    });
  });

  it('SEND_CAMPAIGN delegates to CampaignsService.launch with tenantId', async () => {
    const h = setupRun('CONTACT', 'c-1');
    await h.svc.executeFromStep('r-1', 'tenant-1', 0, [
      { id: 's-1', order: 0, actionType: 'SEND_CAMPAIGN', actionConfig: { campaignId: 'cmp-1' } },
    ] as never);
    expect(h.campaigns.launch).toHaveBeenCalledWith('cmp-1', 'tenant-1');
  });
});

describe('WorkflowsService.cancelRun', () => {
  beforeEach(() => vi.clearAllMocks());

  it('only flips RUNNING runs to CANCELLED (updateMany scopes by status)', async () => {
    const h = build();
    h.tx.workflowRun.updateMany.mockResolvedValueOnce({ count: 1 });
    await h.svc.cancelRun('r-1');
    const args = h.tx.workflowRun.updateMany.mock.calls[0][0];
    expect(args.where.status).toBe('RUNNING');
    expect(args.where.tenantId).toBe('tenant-1');
    expect(args.data.status).toBe('CANCELLED');
    expect(args.data.completedAt).toBeInstanceOf(Date);
  });
});
