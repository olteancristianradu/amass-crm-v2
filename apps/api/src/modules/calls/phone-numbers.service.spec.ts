import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

import { PhoneNumbersService } from './phone-numbers.service';

function build() {
  const tx = {
    phoneNumber: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof PhoneNumbersService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof PhoneNumbersService>[1];
  const svc = new PhoneNumbersService(prisma, audit);
  return { svc, prisma, tx, audit };
}

describe('PhoneNumbersService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clears existing default for the same user before inserting a new default', async () => {
    const h = build();
    h.tx.phoneNumber.create.mockResolvedValueOnce({ id: 'pn-1', number: '+40...' });
    await h.svc.create({
      twilioSid: 'PN1',
      number: '+40712345678',
      userId: 'user-9',
      isDefault: true,
    } as never);
    expect(h.tx.phoneNumber.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-9', isDefault: true }),
        data: { isDefault: false },
      }),
    );
  });

  it('skips clearDefault when isDefault=false', async () => {
    const h = build();
    h.tx.phoneNumber.create.mockResolvedValueOnce({ id: 'pn-1' });
    await h.svc.create({
      twilioSid: 'PN1',
      number: '+40712345678',
      isDefault: false,
    } as never);
    expect(h.tx.phoneNumber.updateMany).not.toHaveBeenCalled();
  });

  it('audits the create with number + label metadata', async () => {
    const h = build();
    h.tx.phoneNumber.create.mockResolvedValueOnce({ id: 'pn-1', number: '+40...', label: 'Sales' });
    await h.svc.create({
      twilioSid: 'PN1',
      number: '+40712345678',
      label: 'Sales',
      isDefault: false,
    } as never);
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'phone_number.create',
        metadata: expect.objectContaining({ number: '+40...', label: 'Sales' }),
      }),
    );
  });
});

describe('PhoneNumbersService.list / findOne', () => {
  beforeEach(() => vi.clearAllMocks());

  it('orders default-first then createdAt ascending', async () => {
    const h = build();
    h.tx.phoneNumber.findMany.mockResolvedValueOnce([]);
    await h.svc.list();
    const args = h.tx.phoneNumber.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ isDefault: 'desc' }, { createdAt: 'asc' }]);
  });

  it('findOne throws PHONE_NUMBER_NOT_FOUND on miss', async () => {
    const h = build();
    h.tx.phoneNumber.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findOne('ghost')).rejects.toThrow(NotFoundException);
  });
});

describe('PhoneNumbersService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('only writes patched fields', async () => {
    const h = build();
    h.tx.phoneNumber.findFirst.mockResolvedValueOnce({ id: 'pn-1', userId: 'user-9' });
    h.tx.phoneNumber.update.mockResolvedValueOnce({ id: 'pn-1' });
    await h.svc.update('pn-1', { label: 'Renamed' });
    const data = h.tx.phoneNumber.update.mock.calls[0][0].data;
    expect(data).toEqual({ label: 'Renamed' });
  });

  it('clears the existing user-level default before flipping a new one', async () => {
    const h = build();
    h.tx.phoneNumber.findFirst.mockResolvedValueOnce({ id: 'pn-2', userId: 'user-9' });
    h.tx.phoneNumber.update.mockResolvedValueOnce({ id: 'pn-2' });
    await h.svc.update('pn-2', { isDefault: true });
    expect(h.tx.phoneNumber.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-9', isDefault: true }),
      }),
    );
  });
});

describe('PhoneNumbersService.remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('soft-deletes via deletedAt + audits', async () => {
    const h = build();
    h.tx.phoneNumber.findFirst.mockResolvedValueOnce({ id: 'pn-1' });
    h.tx.phoneNumber.update.mockResolvedValueOnce({ id: 'pn-1' });
    await h.svc.remove('pn-1');
    const data = h.tx.phoneNumber.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'phone_number.delete' }),
    );
  });
});
