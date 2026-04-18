import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { ApprovalsService } from './approvals.service';

const mockRunWithTenant = vi.fn();
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

const makeDecimal = (n: number) => new Prisma.Decimal(n);

describe('ApprovalsService', () => {
  let svc: ApprovalsService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new ApprovalsService(mockPrisma);
  });

  describe('checkAndRequestApproval', () => {
    it('returns false when no active policies exist', async () => {
      mockRunWithTenant.mockResolvedValue([]); // no policies
      const result = await svc.checkAndRequestApproval('quote-1', makeDecimal(100), 'RON');
      expect(result).toBe(false);
    });

    it('returns true and creates approval requests when policy matches', async () => {
      const policies = [
        {
          id: 'pol-1',
          trigger: 'QUOTE_ABOVE_VALUE',
          isActive: true,
          config: { threshold: 50, currency: 'RON' },
          approverIds: ['approver-1'],
        },
      ];
      mockRunWithTenant
        .mockResolvedValueOnce(policies)      // findMany policies
        .mockResolvedValueOnce({ count: 1 }); // createMany approval requests

      const result = await svc.checkAndRequestApproval('quote-1', makeDecimal(200), 'RON');
      expect(result).toBe(true);
      expect(mockRunWithTenant).toHaveBeenCalledTimes(2);
    });

    it('returns false when quote value is below threshold', async () => {
      const policies = [
        {
          id: 'pol-1',
          trigger: 'QUOTE_ABOVE_VALUE',
          config: { threshold: 500, currency: 'RON' },
        },
      ];
      mockRunWithTenant.mockResolvedValueOnce(policies);
      const result = await svc.checkAndRequestApproval('quote-1', makeDecimal(100), 'RON');
      expect(result).toBe(false);
    });

    it('returns false when currency does not match policy currency', async () => {
      const policies = [
        {
          id: 'pol-1',
          trigger: 'QUOTE_ABOVE_VALUE',
          config: { threshold: 50, currency: 'EUR' },
        },
      ];
      mockRunWithTenant.mockResolvedValueOnce(policies);
      const result = await svc.checkAndRequestApproval('quote-1', makeDecimal(200), 'RON');
      expect(result).toBe(false);
    });
  });
});
