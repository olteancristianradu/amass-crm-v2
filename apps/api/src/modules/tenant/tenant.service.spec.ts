import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { TenantService } from './tenant.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'actor-1' })),
}));

function build() {
  const tx = {
    tenant: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof TenantService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof TenantService>[1];
  return { svc: new TenantService(prisma, audit), tx, audit };
}

describe('TenantService.getLocaleConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns whitelisted entries unchanged', async () => {
    const h = build();
    h.tx.tenant.findUniqueOrThrow.mockResolvedValue({ defaultLocale: 'ro', enabledLocales: ['ro', 'en'] });
    expect(await h.svc.getLocaleConfig()).toEqual({ defaultLocale: 'ro', enabledLocales: ['ro', 'en'] });
  });

  it('filters out stray non-whitelisted entries (defensive normalisation)', async () => {
    const h = build();
    h.tx.tenant.findUniqueOrThrow.mockResolvedValue({ defaultLocale: 'ro', enabledLocales: ['ro', 'en', 'xx'] });
    expect(await h.svc.getLocaleConfig()).toEqual({ defaultLocale: 'ro', enabledLocales: ['ro', 'en'] });
  });

  it("falls back to 'ro' when both stored values are garbage", async () => {
    const h = build();
    h.tx.tenant.findUniqueOrThrow.mockResolvedValue({ defaultLocale: 'xx', enabledLocales: ['xx'] });
    expect(await h.svc.getLocaleConfig()).toEqual({ defaultLocale: 'ro', enabledLocales: ['ro'] });
  });
});

describe('TenantService.updateLocaleConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects when defaultLocale is not in enabledLocales', async () => {
    const h = build();
    await expect(
      h.svc.updateLocaleConfig('actor-1', { defaultLocale: 'en', enabledLocales: ['ro'] } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('persists and audits the change with before/after metadata', async () => {
    const h = build();
    h.tx.tenant.findUniqueOrThrow.mockResolvedValue({ defaultLocale: 'ro', enabledLocales: ['ro'] });
    h.tx.tenant.update.mockResolvedValue({ defaultLocale: 'en', enabledLocales: ['ro', 'en'] });
    const out = await h.svc.updateLocaleConfig('actor-1', {
      defaultLocale: 'en',
      enabledLocales: ['ro', 'en'],
    });
    expect(out.defaultLocale).toBe('en');
    expect(h.tx.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tenant-1' },
        data: { defaultLocale: 'en', enabledLocales: ['ro', 'en'] },
      }),
    );
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.locale.config.changed',
        metadata: {
          from: { defaultLocale: 'ro', enabledLocales: ['ro'] },
          to: { defaultLocale: 'en', enabledLocales: ['ro', 'en'] },
        },
      }),
    );
  });
});
