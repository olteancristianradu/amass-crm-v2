import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { EventsService } from './events.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

const mockRunWithTenant = vi.fn();
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;

describe('EventsService', () => {
  let svc: EventsService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new EventsService(mockPrisma);
  });

  it('findOne() throws NotFoundException when missing', async () => {
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ event: { findFirst: vi.fn().mockResolvedValue(null) } }),
    );
    await expect(svc.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('addAttendee() stamps registeredAt only when status=REGISTERED', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'e-1', attendees: [] });
    const create = vi.fn().mockImplementation(async ({ data }) => ({ id: 'a-1', ...data }));
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ event: { findFirst }, eventAttendee: { create } }),
    );

    const registered = await svc.addAttendee('e-1', {
      contactId: 'c-1',
      status: 'REGISTERED',
    } as any);
    expect(registered.registeredAt).toBeInstanceOf(Date);

    const invited = await svc.addAttendee('e-1', { contactId: 'c-2', status: 'INVITED' } as any);
    expect(invited.registeredAt).toBeNull();
  });

  it('updateAttendeeStatus() stamps attendedAt when moving to ATTENDED', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'e-1', attendees: [] });
    const update = vi.fn().mockImplementation(async ({ data }) => data);
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ event: { findFirst }, eventAttendee: { update } }),
    );

    await svc.updateAttendeeStatus('e-1', 'a-1', { status: 'ATTENDED' } as any);
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('ATTENDED');
    expect(data.attendedAt).toBeInstanceOf(Date);
  });

  it('remove() soft-deletes via deletedAt', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'e-1', attendees: [] });
    const update = vi.fn().mockResolvedValue({});
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ event: { findFirst, update } }),
    );

    await svc.remove('e-1');
    expect(update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
  });
});
