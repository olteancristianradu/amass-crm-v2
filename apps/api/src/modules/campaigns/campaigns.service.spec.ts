import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

describe('CampaignsService.launch', () => {
  const makePrisma = () => {
    const findFirst = vi.fn();
    const update = vi.fn();
    return { findFirst, update, prisma: { campaign: { findFirst, update } } as any };
  };

  let p: ReturnType<typeof makePrisma>;
  let svc: CampaignsService;

  beforeEach(() => {
    p = makePrisma();
    svc = new CampaignsService(p.prisma);
  });

  it('throws NotFoundException when campaign missing', async () => {
    p.findFirst.mockResolvedValue(null);
    await expect(svc.launch('c-1', 'tenant-1')).rejects.toThrow(NotFoundException);
    expect(p.update).not.toHaveBeenCalled();
  });

  it('no-ops and returns existing when already ACTIVE', async () => {
    const existing = { id: 'c-1', status: 'ACTIVE', startDate: new Date('2026-01-01') };
    p.findFirst.mockResolvedValue(existing);

    const result = await svc.launch('c-1', 'tenant-1');
    expect(result).toBe(existing);
    expect(p.update).not.toHaveBeenCalled();
  });

  it('returns COMPLETED campaign unchanged and logs a warning', async () => {
    const existing = { id: 'c-1', status: 'COMPLETED', startDate: new Date('2026-01-01') };
    p.findFirst.mockResolvedValue(existing);

    const result = await svc.launch('c-1', 'tenant-1');
    expect(result).toBe(existing);
    expect(p.update).not.toHaveBeenCalled();
  });

  it('transitions DRAFT → ACTIVE, back-fills startDate when null', async () => {
    const existing = { id: 'c-1', status: 'DRAFT', startDate: null };
    const launched = { id: 'c-1', status: 'ACTIVE', startDate: new Date() };
    p.findFirst.mockResolvedValue(existing);
    p.update.mockResolvedValue(launched);

    const result = await svc.launch('c-1', 'tenant-1');
    expect(result).toBe(launched);
    const arg = p.update.mock.calls[0][0];
    expect(arg.data.status).toBe('ACTIVE');
    expect(arg.data.startDate).toBeInstanceOf(Date);
  });

  it('transitions PAUSED → ACTIVE, preserves existing startDate', async () => {
    const preset = new Date('2026-01-15');
    const existing = { id: 'c-1', status: 'PAUSED', startDate: preset };
    p.findFirst.mockResolvedValue(existing);
    p.update.mockResolvedValue({ ...existing, status: 'ACTIVE' });

    await svc.launch('c-1', 'tenant-1');
    expect(p.update.mock.calls[0][0].data.startDate).toBe(preset);
  });
});
