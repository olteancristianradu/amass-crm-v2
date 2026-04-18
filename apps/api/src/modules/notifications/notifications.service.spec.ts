import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsService } from './notifications.service';

const mockRunWithTenant = vi.fn();
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;
const mockGateway = { emitToUser: vi.fn() } as any;

// Stub tenant context
vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

describe('NotificationsService', () => {
  let svc: NotificationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new NotificationsService(mockPrisma, mockGateway);
  });

  describe('create', () => {
    it('persists notification and emits via gateway', async () => {
      const notif = { id: 'n1', type: 'SYSTEM', title: 'Test', body: null, data: null, createdAt: new Date() };
      mockRunWithTenant.mockResolvedValue(notif);

      const result = await svc.create('tenant-1', {
        userId: 'user-1',
        type: 'SYSTEM' as never,
        title: 'Test',
      });

      expect(result).toBe(notif);
      expect(mockGateway.emitToUser).toHaveBeenCalledWith('tenant-1', 'user-1', 'notification', expect.objectContaining({ id: 'n1' }));
    });
  });

  describe('markAllRead', () => {
    it('calls updateMany with isRead: true', async () => {
      mockRunWithTenant.mockResolvedValue({ count: 3 });
      await svc.markAllRead();
      expect(mockRunWithTenant).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    });
  });

  describe('unreadCount', () => {
    it('returns count from prisma', async () => {
      mockRunWithTenant.mockResolvedValue(5);
      const count = await svc.unreadCount();
      expect(count).toBe(5);
    });
  });
});
