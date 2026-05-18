import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalsSlaScheduler } from './approvals-sla.scheduler';
import type { Queue } from 'bullmq';

function buildScheduler() {
  const queue = { add: vi.fn().mockResolvedValue({ id: 'j-1' }) };
  const sched = new ApprovalsSlaScheduler(queue as any as Queue);
  return { sched, queue };
}

describe('ApprovalsSlaScheduler', () => {
  let s: ReturnType<typeof buildScheduler>;
  beforeEach(() => { s = buildScheduler(); });

  it('enqueue uses a deterministic 15min-bucketed jobId', async () => {
    // Two ticks within the same 15min window must produce the same jobId so
    // BullMQ dedupes the second enqueue (Redis jobId UNIQUE).
    const t1 = new Date('2026-05-18T13:00:00Z');
    const t2 = new Date('2026-05-18T13:14:59Z');
    const r1 = await s.sched.enqueue(t1);
    const r2 = await s.sched.enqueue(t2);
    expect(r1.jobId).toBe(r2.jobId);
  });

  it('different 15min windows produce different jobIds', async () => {
    const t1 = new Date('2026-05-18T13:00:00Z');
    const t2 = new Date('2026-05-18T13:16:00Z');
    const r1 = await s.sched.enqueue(t1);
    const r2 = await s.sched.enqueue(t2);
    expect(r1.jobId).not.toBe(r2.jobId);
  });

  it('handleTick swallows errors so the cron daemon stays alive', async () => {
    s.queue.add.mockRejectedValueOnce(new Error('redis down'));
    // Must not throw.
    await s.sched.handleTick();
  });

  it('add called with correct queue name + payload shape', async () => {
    await s.sched.enqueue(new Date('2026-05-18T13:00:00Z'));
    expect(s.queue.add).toHaveBeenCalledWith(
      'sla-sweep',
      expect.objectContaining({ stamp: expect.any(String) }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^approval-sla-\d{12}$/),
        attempts: 2,
      }),
    );
  });
});
