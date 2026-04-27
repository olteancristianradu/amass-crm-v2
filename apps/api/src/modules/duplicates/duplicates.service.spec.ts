import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DuplicatesService } from './duplicates.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

function build() {
  const tx = {
    company: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    contact: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    client: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    quote: { updateMany: vi.fn() },
    deal: { updateMany: vi.fn() },
    note: { updateMany: vi.fn() },
    reminder: { updateMany: vi.fn() },
    activity: { updateMany: vi.fn() },
    attachment: { updateMany: vi.fn() },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    $queryRaw: vi.fn(),
  } as unknown as ConstructorParameters<typeof DuplicatesService>[0];
  const svc = new DuplicatesService(prisma);
  return { svc, prisma, tx };
}

describe('DuplicatesService.findCompanyDuplicates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFound when the source company is missing', async () => {
    const h = build();
    h.tx.company.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findCompanyDuplicates('ghost')).rejects.toThrow(NotFoundException);
    expect(vi.mocked(h.prisma.$queryRaw)).not.toHaveBeenCalled();
  });

  it('issues the trigram-similarity raw query with the source fields bound', async () => {
    const h = build();
    h.tx.company.findFirst.mockResolvedValueOnce({
      id: 'co-1',
      name: 'Acme',
      vatNumber: 'RO123',
      email: 'a@x.ro',
    });
    vi.mocked(h.prisma.$queryRaw).mockResolvedValueOnce([
      { id: 'co-2', name: 'Acme SRL', similarity: 0.91 },
    ] as never);
    const out = await h.svc.findCompanyDuplicates('co-1');
    expect(out[0]).toMatchObject({ id: 'co-2', similarity: 0.91 });
    // The Prisma tagged-template binds parameters; check that the source
    // values landed in the `values` array.
    const call = vi.mocked(h.prisma.$queryRaw).mock.calls[0];
    const values = call.slice(1) as unknown[];
    expect(values).toContain('Acme');
    expect(values).toContain('RO123');
    expect(values).toContain('a@x.ro');
    expect(values).toContain('co-1');
    expect(values).toContain('tenant-1');
  });
});

describe('DuplicatesService.findContactDuplicates / findClientDuplicates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds the full-name binding from firstName + lastName', async () => {
    const h = build();
    h.tx.contact.findFirst.mockResolvedValueOnce({
      id: 'c-1',
      firstName: 'Andrei',
      lastName: 'Popescu',
      email: null,
    });
    vi.mocked(h.prisma.$queryRaw).mockResolvedValueOnce([] as never);
    await h.svc.findContactDuplicates('c-1');
    const values = vi.mocked(h.prisma.$queryRaw).mock.calls[0].slice(1);
    expect(values).toContain('Andrei Popescu');
    expect(values).toContain(''); // email='' fallback
  });

  it('throws NotFound when the source client is missing', async () => {
    const h = build();
    h.tx.client.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findClientDuplicates('ghost')).rejects.toThrow(NotFoundException);
  });
});

describe('DuplicatesService.mergeCompanies', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects when survivorId is included in victimIds', async () => {
    const h = build();
    await expect(
      h.svc.mergeCompanies('co-1', ['co-2', 'co-1']),
    ).rejects.toThrow(BadRequestException);
    expect(h.prisma.runWithTenant).not.toHaveBeenCalled();
  });

  it('throws NotFound when the survivor does not exist', async () => {
    const h = build();
    h.tx.company.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.mergeCompanies('ghost', ['co-2'])).rejects.toThrow(NotFoundException);
  });

  it('skips a victim that does not exist (continue), keeping the rest', async () => {
    const h = build();
    h.tx.company.findFirst
      .mockResolvedValueOnce({ id: 'co-1' }) // survivor
      .mockResolvedValueOnce(null) // victim co-2 missing → skip
      .mockResolvedValueOnce({ id: 'co-3' }); // victim co-3 present
    await h.svc.mergeCompanies('co-1', ['co-2', 'co-3']);
    // Polymorphic moves run once per real victim — we asserted exactly 1.
    expect(h.tx.contact.updateMany).toHaveBeenCalledTimes(1);
    expect(h.tx.deal.updateMany).toHaveBeenCalledTimes(1);
  });

  it('repoints contacts/quotes/deals/notes/etc. and soft-deletes the victim', async () => {
    const h = build();
    h.tx.company.findFirst
      .mockResolvedValueOnce({ id: 'co-1' })
      .mockResolvedValueOnce({ id: 'co-2' });
    await h.svc.mergeCompanies('co-1', ['co-2']);
    expect(h.tx.contact.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'co-2', tenantId: 'tenant-1' },
        data: { companyId: 'co-1' },
      }),
    );
    expect(h.tx.note.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ subjectType: 'COMPANY', subjectId: 'co-2' }),
        data: { subjectId: 'co-1' },
      }),
    );
    const softDelete = h.tx.company.update.mock.calls[0][0];
    expect(softDelete.where).toEqual({ id: 'co-2' });
    expect(softDelete.data.deletedAt).toBeInstanceOf(Date);
  });
});

describe('DuplicatesService.mergeContacts + mergeClients', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mergeContacts repoints deals.contactId + polymorphic subjects', async () => {
    const h = build();
    h.tx.contact.findFirst
      .mockResolvedValueOnce({ id: 'c-1' })
      .mockResolvedValueOnce({ id: 'c-2' });
    await h.svc.mergeContacts('c-1', ['c-2']);
    expect(h.tx.deal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contactId: 'c-2', tenantId: 'tenant-1' },
        data: { contactId: 'c-1' },
      }),
    );
    expect(h.tx.contact.update).toHaveBeenCalled();
  });

  it('mergeClients soft-deletes only after polymorphic moves run', async () => {
    const h = build();
    h.tx.client.findFirst
      .mockResolvedValueOnce({ id: 'cl-1' })
      .mockResolvedValueOnce({ id: 'cl-2' });
    await h.svc.mergeClients('cl-1', ['cl-2']);
    const callOrder = [
      h.tx.note.updateMany.mock.invocationCallOrder[0],
      h.tx.client.update.mock.invocationCallOrder[0],
    ];
    expect(callOrder[0]).toBeLessThan(callOrder[1]);
  });

  it('mergeClients refuses when survivor === victim', async () => {
    const h = build();
    await expect(h.svc.mergeClients('cl-1', ['cl-1'])).rejects.toThrow(BadRequestException);
  });
});
