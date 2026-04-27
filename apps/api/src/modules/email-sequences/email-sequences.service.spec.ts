import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

import { EmailSequencesService } from './email-sequences.service';

function build() {
  const tx = {
    emailSequence: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    sequenceEnrollment: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof EmailSequencesService>[0];
  const svc = new EmailSequencesService(prisma);
  return { svc, prisma, tx };
}

describe('EmailSequencesService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates sequence with all steps + tenantId on each', async () => {
    const h = build();
    h.tx.emailSequence.create.mockResolvedValueOnce({ id: 'seq-1' });
    await h.svc.create({
      name: 'Welcome',
      description: 'Onboarding',
      steps: [
        { order: 0, delayDays: 0, subject: 'Welcome', bodyHtml: '<p>1</p>' },
        { order: 1, delayDays: 3, subject: 'Day 3', bodyHtml: '<p>2</p>' },
      ],
    } as never);
    const args = h.tx.emailSequence.create.mock.calls[0][0];
    expect(args.data.tenantId).toBe('tenant-1');
    expect(args.data.steps.create).toHaveLength(2);
    expect(args.data.steps.create[0].tenantId).toBe('tenant-1');
  });
});

describe('EmailSequencesService.findOne', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws SEQUENCE_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.emailSequence.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findOne('ghost')).rejects.toThrow(NotFoundException);
  });
});

describe('EmailSequencesService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces steps wholesale when steps[] is in the patch', async () => {
    const h = build();
    h.tx.emailSequence.findFirst.mockResolvedValueOnce({ id: 'seq-1', steps: [] });
    h.tx.emailSequence.update.mockResolvedValueOnce({ id: 'seq-1' });
    await h.svc.update('seq-1', {
      steps: [{ order: 0, delayDays: 0, subject: 'New', bodyHtml: '<p/>' }],
    } as never);
    const data = h.tx.emailSequence.update.mock.calls[0][0].data;
    expect(data.steps.deleteMany).toEqual({ sequenceId: 'seq-1' });
    expect(data.steps.create).toHaveLength(1);
  });

  it('keeps existing steps untouched when steps is omitted', async () => {
    const h = build();
    h.tx.emailSequence.findFirst.mockResolvedValueOnce({ id: 'seq-1', steps: [] });
    h.tx.emailSequence.update.mockResolvedValueOnce({ id: 'seq-1' });
    await h.svc.update('seq-1', { name: 'Renamed' } as never);
    const data = h.tx.emailSequence.update.mock.calls[0][0].data;
    expect('steps' in data).toBe(false);
  });
});

describe('EmailSequencesService.activate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to activate a sequence with no steps', async () => {
    const h = build();
    h.tx.emailSequence.findFirst.mockResolvedValueOnce({ id: 'seq-1', steps: [] });
    await expect(h.svc.activate('seq-1')).rejects.toThrow(BadRequestException);
  });

  it('flips status to ACTIVE when at least one step exists', async () => {
    const h = build();
    h.tx.emailSequence.findFirst.mockResolvedValueOnce({
      id: 'seq-1',
      steps: [{ order: 0 }],
    });
    h.tx.emailSequence.update.mockResolvedValueOnce({ id: 'seq-1' });
    await h.svc.activate('seq-1');
    expect(h.tx.emailSequence.update.mock.calls[0][0].data).toEqual({ status: 'ACTIVE' });
  });
});

describe('EmailSequencesService.archive', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flips status=ARCHIVED + sets deletedAt', async () => {
    const h = build();
    h.tx.emailSequence.update.mockResolvedValueOnce({ id: 'seq-1' });
    await h.svc.archive('seq-1');
    const data = h.tx.emailSequence.update.mock.calls[0][0].data;
    expect(data.status).toBe('ARCHIVED');
    expect(data.deletedAt).toBeInstanceOf(Date);
  });
});

describe('EmailSequencesService.enroll', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses enrollment when sequence is not ACTIVE', async () => {
    const h = build();
    h.tx.emailSequence.findFirst.mockResolvedValueOnce({
      id: 'seq-1',
      status: 'DRAFT',
      steps: [{ delayDays: 1 }],
    });
    await expect(
      h.svc.enroll({ sequenceId: 'seq-1', toEmail: 'x@y.ro' } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('schedules nextSendAt = now + firstStep.delayDays * 86400000ms', async () => {
    const h = build();
    h.tx.emailSequence.findFirst.mockResolvedValueOnce({
      id: 'seq-1',
      status: 'ACTIVE',
      steps: [{ delayDays: 2 }],
    });
    h.tx.sequenceEnrollment.create.mockResolvedValueOnce({ id: 'e-1' });
    const before = Date.now();
    await h.svc.enroll({ sequenceId: 'seq-1', toEmail: 'x@y.ro' } as never);
    const data = h.tx.sequenceEnrollment.create.mock.calls[0][0].data;
    const nextSendAt = (data.nextSendAt as Date).getTime();
    const expected = before + 2 * 86400000;
    expect(Math.abs(nextSendAt - expected)).toBeLessThan(1000);
  });

  it('sets nextSendAt = null when sequence has no steps', async () => {
    const h = build();
    h.tx.emailSequence.findFirst.mockResolvedValueOnce({
      id: 'seq-1',
      status: 'ACTIVE',
      steps: [],
    });
    h.tx.sequenceEnrollment.create.mockResolvedValueOnce({ id: 'e-1' });
    await h.svc.enroll({ sequenceId: 'seq-1', toEmail: 'x@y.ro' } as never);
    expect(h.tx.sequenceEnrollment.create.mock.calls[0][0].data.nextSendAt).toBeNull();
  });
});

describe('EmailSequencesService.unenroll', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flips status=UNSUBSCRIBED + completedAt', async () => {
    const h = build();
    h.tx.sequenceEnrollment.update.mockResolvedValueOnce({ id: 'e-1' });
    await h.svc.unenroll('e-1');
    const data = h.tx.sequenceEnrollment.update.mock.calls[0][0].data;
    expect(data.status).toBe('UNSUBSCRIBED');
    expect(data.completedAt).toBeInstanceOf(Date);
  });
});
