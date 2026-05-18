import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalsSlaProcessor } from './approvals-sla.processor';
import type { ApprovalsService } from './approvals.service';
import type { Job } from 'bullmq';

function buildProcessor() {
  const approvals = {
    expireOverdueForAllTenants: vi.fn().mockResolvedValue({ tenants: 3, expired: 5 }),
  };
  const proc = new ApprovalsSlaProcessor(approvals as any as ApprovalsService);
  return { proc, approvals };
}

const job = (name: string, data: unknown): Job =>
  ({ name, data, id: 'j-1', attemptsMade: 0, opts: { attempts: 2 } } as unknown as Job);

describe('ApprovalsSlaProcessor', () => {
  let p: ReturnType<typeof buildProcessor>;
  beforeEach(() => { p = buildProcessor(); });

  it('runs expireOverdueForAllTenants on sla-sweep job', async () => {
    await p.proc.process(job('sla-sweep', { stamp: '202605181530' }));
    expect(p.approvals.expireOverdueForAllTenants).toHaveBeenCalledOnce();
  });

  it('ignores unknown job names with a warning (no throw)', async () => {
    await p.proc.process(job('bogus', { stamp: 'x' }));
    expect(p.approvals.expireOverdueForAllTenants).not.toHaveBeenCalled();
  });

  it('onFailed handler logs without throwing', () => {
    expect(() => p.proc.onFailed(job('sla-sweep', {}), new Error('boom'))).not.toThrow();
  });
});
