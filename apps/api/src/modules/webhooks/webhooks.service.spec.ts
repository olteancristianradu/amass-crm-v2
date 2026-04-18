import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhooksService } from './webhooks.service';

const mockRunWithTenant = vi.fn();
const mockCreate = vi.fn();
const mockPrisma = {
  runWithTenant: mockRunWithTenant,
  webhookDelivery: { create: mockCreate },
} as any;

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

describe('WebhooksService', () => {
  let svc: WebhooksService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new WebhooksService(mockPrisma);
  });

  describe('create', () => {
    it('generates a secret and creates endpoint', async () => {
      const endpoint = { id: 'ep1', url: 'https://example.com/hook', events: ['DEAL_CREATED'], isActive: true, createdAt: new Date(), secret: 'abc' };
      mockRunWithTenant.mockResolvedValue(endpoint);

      const result = await svc.create({ url: 'https://example.com/hook', events: ['DEAL_CREATED' as never] });

      expect(result).toBe(endpoint);
      expect(mockRunWithTenant).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    });
  });

  describe('dispatch', () => {
    it('fires without throwing even when endpoint fetch fails', () => {
      // dispatch is fire-and-forget — should never throw
      mockRunWithTenant.mockResolvedValue([]);
      expect(() => svc.dispatch('tenant-1', 'DEAL_CREATED' as never, { id: 'deal-1' })).not.toThrow();
    });
  });
});
