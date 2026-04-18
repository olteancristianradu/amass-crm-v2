import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeadScoringService } from './lead-scoring.service';

const mockRunWithTenant = vi.fn();
const mockQueue = { add: vi.fn() } as any;
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

// computeAndSave calls runWithTenant for entityType='company':
//   1. company exists check
//   2-4. activities, calls, deals (Promise.all — email uses Promise.resolve(0) for company)
//   5. lastActivity findFirst
//   6. leadScore upsert
// Total: 6 runWithTenant calls for company type

describe('LeadScoringService', () => {
  let svc: LeadScoringService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new LeadScoringService(mockPrisma, mockQueue);
  });

  describe('computeAndSave', () => {
    it('computes 0 for a brand-new company with no activity', async () => {
      const storedScore = { id: 's1', score: 0, factors: {} };
      mockRunWithTenant
        .mockResolvedValueOnce({ id: 'c1' })     // exists check
        .mockResolvedValueOnce(0)                 // activities
        .mockResolvedValueOnce(0)                 // calls
        .mockResolvedValueOnce([])                // deals (email skipped — Promise.resolve(0))
        .mockResolvedValueOnce(null)              // lastActivity (none → 999 days)
        .mockResolvedValueOnce(storedScore);      // upsert

      const result = await svc.computeAndSave('tenant-1', 'company', 'c1');
      expect(result.score).toBe(0);
    });

    it('scores 30 pts for 30 activities alone', async () => {
      const storedScore = { id: 's1', score: 30, factors: {} };
      mockRunWithTenant
        .mockResolvedValueOnce({ id: 'c1' })
        .mockResolvedValueOnce(30)               // 30 activities = 30pts (capped)
        .mockResolvedValueOnce(0)                // calls
        .mockResolvedValueOnce([])               // deals
        .mockResolvedValueOnce({ createdAt: new Date() }) // active today → no penalty
        .mockResolvedValueOnce(storedScore);

      const result = await svc.computeAndSave('tenant-1', 'company', 'c1');
      expect(result.score).toBe(30);
    });

    it('applies recency penalty for company inactive > 30 days', async () => {
      const oldDate = new Date(Date.now() - 40 * 86400_000); // 40 days ago
      const storedScore = { id: 's1', score: 17, factors: {} };
      mockRunWithTenant
        .mockResolvedValueOnce({ id: 'c1' })
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ createdAt: oldDate })
        .mockResolvedValueOnce(storedScore);

      const result = await svc.computeAndSave('tenant-1', 'company', 'c1');
      expect(result.score).toBe(17);
    });
  });

  describe('requestRecompute', () => {
    it('queues a BullMQ job with correct payload', async () => {
      mockQueue.add.mockResolvedValue({});

      const result = await svc.requestRecompute('company', 'c1');
      expect(result).toEqual({ queued: true });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'recompute-single',
        expect.objectContaining({ entityType: 'company', entityId: 'c1' }),
        expect.any(Object),
      );
    });
  });
});
