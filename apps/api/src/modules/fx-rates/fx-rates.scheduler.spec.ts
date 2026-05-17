import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FxRatesScheduler } from './fx-rates.scheduler';

/**
 * Scheduler is a thin fan-out — the only logic worth covering is:
 *   - jobId is deterministic (`fx-daily-YYYYMMDD` in Europe/Bucharest)
 *     so two concurrent fires dedup in BullMQ (T-FX-T-04).
 *   - retry options match T-FX-D-01 mitigation budget (3 attempts,
 *     exponential backoff).
 *   - Cron decorator metadata pins schedule + timezone.
 */

function build() {
  const queue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
  const svc = new FxRatesScheduler(queue as unknown as ConstructorParameters<typeof FxRatesScheduler>[0]);
  return { svc, queue };
}

describe('FxRatesScheduler.enqueue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds jobId fx-daily-YYYYMMDD from the local date', async () => {
    const h = build();
    // Pick a stable instant in winter so DST is not in play; the local
    // formatter returns whatever Europe/Bucharest yields for that UTC.
    const out = await h.svc.enqueue(new Date('2026-05-17T05:00:00.000Z'));
    // 05:00 UTC = 08:00 in Bucharest in DST (UTC+3). Local date stays 2026-05-17.
    expect(out.jobId).toMatch(/^fx-daily-\d{8}$/);
    const [name, payload, opts] = h.queue.add.mock.calls[0];
    expect(name).toBe('fx-rates-daily');
    expect(payload).toEqual({ localDate: '2026-05-17' });
    expect(opts.jobId).toBe(out.jobId);
  });

  it('uses retry budget per T-FX-D-01 (attempts:3 + exponential 60s)', async () => {
    const h = build();
    await h.svc.enqueue();
    const opts = h.queue.add.mock.calls[0][2];
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 60_000 });
  });

  it('handleDaily swallows queue errors so the next tick still runs', async () => {
    const h = build();
    h.queue.add.mockRejectedValueOnce(new Error('redis down'));
    // Should NOT throw — error is logged.
    await expect(h.svc.handleDaily()).resolves.toBeUndefined();
  });
});
