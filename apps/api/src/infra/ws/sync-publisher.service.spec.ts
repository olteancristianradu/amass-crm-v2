import { describe, it, expect, vi } from 'vitest';
import { SyncPublisherService } from './sync-publisher.service';
import type { SyncGateway } from './sync.gateway';

describe('SyncPublisherService', () => {
  it('delegates publish to the gateway when the Socket.IO server is mounted', () => {
    const broadcast = vi.fn();
    const gateway = {
      // truthy server -> publisher should call broadcast
      server: { to: vi.fn() } as never,
      broadcast,
    } as unknown as SyncGateway;

    const svc = new SyncPublisherService(gateway);
    svc.publish('tenant-A', 'deal.updated', { id: 'd1' });

    expect(broadcast).toHaveBeenCalledWith('tenant-A', 'deal.updated', { id: 'd1' });
  });

  it('drops publish (no throw) when gateway has no Socket.IO server yet', () => {
    const broadcast = vi.fn();
    const gateway = {
      server: undefined as never,
      broadcast,
    } as unknown as SyncGateway;

    const svc = new SyncPublisherService(gateway);

    expect(() => svc.publish('tenant-A', 'deal.updated', { id: 'd1' })).not.toThrow();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
