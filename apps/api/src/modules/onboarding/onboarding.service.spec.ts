import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingService } from './onboarding.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

vi.mock('./onboarding.fixtures', () => ({
  SAMPLE_COMPANIES: [
    { name: 'Test Co 1', vatNumber: 'RO00000001', industry: 'IT', city: 'Cluj', relationshipStatus: 'ACTIVE', leadSource: 'REFERRAL', contacts: [
      { firstName: 'A', lastName: 'B', jobTitle: 'CEO', email: 'a@b.ro', isDecider: true },
    ]},
    { name: 'Test Co 2', vatNumber: 'RO00000002', industry: 'IT', city: 'București', relationshipStatus: 'LEAD', leadSource: 'WEB', contacts: [
      { firstName: 'C', lastName: 'D', jobTitle: 'CFO', email: 'c@d.ro', isDecider: true },
      { firstName: 'E', lastName: 'F', jobTitle: 'CTO', email: 'e@f.ro', isDecider: false },
    ]},
  ],
  SAMPLE_DEAL_TITLES: [
    { title: 'Deal A', value: 1000, companyIndex: 0, outcome: 'open' },
    { title: 'Deal B', value: 2000, companyIndex: 1, outcome: 'won' },
  ],
}));

function build() {
  const tx = {
    pipeline: { findFirst: vi.fn(), create: vi.fn() },
    company: { create: vi.fn() },
    contact: { create: vi.fn() },
    deal: { create: vi.fn() },
  };
  const prisma = {
    tenant: { findUnique: vi.fn(), update: vi.fn() },
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof OnboardingService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof OnboardingService>[1];
  const svc = new OnboardingService(prisma, audit);
  return { svc, prisma, tx, audit };
}

describe('OnboardingService.getStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns timestamps from tenant row', async () => {
    const h = build();
    const completedAt = new Date('2026-04-01');
    const sampleAt = new Date('2026-04-02');
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValueOnce({
      onboardingCompletedAt: completedAt,
      sampleDataLoadedAt: sampleAt,
    } as never);
    const out = await h.svc.getStatus();
    expect(out.onboardingCompletedAt).toBe(completedAt);
    expect(out.sampleDataLoadedAt).toBe(sampleAt);
  });

  it('returns nulls when tenant row missing (defensive)', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValueOnce(null);
    expect(await h.svc.getStatus()).toEqual({ onboardingCompletedAt: null, sampleDataLoadedAt: null });
  });
});

describe('OnboardingService.markComplete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates tenant + writes audit', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.update).mockResolvedValueOnce({ id: 'tenant-1' } as never);
    await h.svc.markComplete();
    expect(h.prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: { onboardingCompletedAt: expect.any(Date) },
    });
    expect(h.audit.log).toHaveBeenCalledWith({ action: 'tenant.onboarding.completed' });
  });
});

describe('OnboardingService.loadSampleData', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns alreadyLoaded:true when sampleDataLoadedAt is set', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValueOnce({
      sampleDataLoadedAt: new Date('2026-04-01'),
    } as never);
    const out = await h.svc.loadSampleData();
    expect(out.alreadyLoaded).toBe(true);
    expect(out.companies).toBe(0);
    expect(h.tx.company.create).not.toHaveBeenCalled();
  });

  it('creates companies + contacts + deals when not yet loaded', async () => {
    const h = build();
    // First check (in tenant.findUnique): not loaded yet
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValueOnce({
      sampleDataLoadedAt: null,
    } as never);
    // Pipeline find: none, will create
    h.tx.pipeline.findFirst.mockResolvedValueOnce(null);
    h.tx.pipeline.create.mockResolvedValueOnce({
      id: 'pipe-1',
      stages: [
        { id: 's1', type: 'OPEN' },
        { id: 's2', type: 'OPEN' },
        { id: 'sw', type: 'WON' },
        { id: 'sl', type: 'LOST' },
      ],
    } as never);
    // Companies + contacts + deals — return objects with ids
    h.tx.company.create
      .mockResolvedValueOnce({ id: 'co-1' } as never)
      .mockResolvedValueOnce({ id: 'co-2' } as never);
    h.tx.contact.create.mockResolvedValue({ id: 'ct' } as never);
    h.tx.deal.create.mockResolvedValue({ id: 'd' } as never);
    // Final tenant update + audit
    vi.mocked(h.prisma.tenant.update).mockResolvedValueOnce({ id: 'tenant-1' } as never);

    const out = await h.svc.loadSampleData();
    expect(out.alreadyLoaded).toBe(false);
    expect(out.companies).toBe(2);
    expect(out.contacts).toBe(3); // 1 + 2
    expect(out.deals).toBe(2);
    expect(h.tx.deal.create).toHaveBeenCalledTimes(2);
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.sample-data.loaded' }),
    );
  });

  it('reuses existing default pipeline if present', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValueOnce({ sampleDataLoadedAt: null } as never);
    h.tx.pipeline.findFirst.mockResolvedValueOnce({
      id: 'existing-pipe',
      stages: [
        { id: 'os1', type: 'OPEN' },
        { id: 'wn1', type: 'WON' },
      ],
    } as never);
    h.tx.company.create.mockResolvedValue({ id: 'co' } as never);
    h.tx.contact.create.mockResolvedValue({ id: 'ct' } as never);
    h.tx.deal.create.mockResolvedValue({ id: 'd' } as never);
    vi.mocked(h.prisma.tenant.update).mockResolvedValueOnce({ id: 'tenant-1' } as never);

    await h.svc.loadSampleData();
    expect(h.tx.pipeline.create).not.toHaveBeenCalled();
  });
});
