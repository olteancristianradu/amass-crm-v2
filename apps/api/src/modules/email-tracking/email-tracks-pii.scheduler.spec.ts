import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailTracksPiiScheduler } from './email-tracks-pii.scheduler';

function build() {
  const queue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
  const scheduler = new EmailTracksPiiScheduler(queue as never);
  return { scheduler, queue };
}

beforeEach(() => vi.clearAllMocks());

describe('EmailTracksPiiScheduler.enqueue', () => {
  it('builds a deterministic jobId in Europe/Bucharest timezone', async () => {
    const h = build();
    // 2026-05-17 14:30 UTC = 17:30 Bucharest (DST → CEST = UTC+3)
    const now = new Date('2026-05-17T14:30:00Z');
    await h.scheduler.enqueue(now);
    const call = h.queue.add.mock.calls[0];
    expect(call[0]).toBe('purge');
    expect(call[2].jobId).toBe('email-tracks-pii-20260517');
  });

  it('uses local day, not UTC day, when UTC is on the day before', async () => {
    const h = build();
    // 2026-05-17 23:30 UTC = 2026-05-18 02:30 Bucharest. The cron fires
    // at 03:00 Bucharest local; the jobId MUST reflect the local date so
    // two runs in the same Bucharest day collapse to one.
    const now = new Date('2026-05-17T23:30:00Z');
    await h.scheduler.enqueue(now);
    expect(h.queue.add.mock.calls[0][2].jobId).toBe('email-tracks-pii-20260518');
  });

  it('configures BullMQ with attempts=1 + bounded retention', async () => {
    const h = build();
    await h.scheduler.enqueue(new Date('2026-05-17T03:00:00Z'));
    const opts = h.queue.add.mock.calls[0][2];
    expect(opts.attempts).toBe(1);
    expect(opts.removeOnComplete).toEqual({ count: 50 });
    expect(opts.removeOnFail).toEqual({ count: 100 });
  });
});

describe('EmailTracksPiiScheduler.handleDaily', () => {
  it('swallows enqueue errors so the cron never crashes the worker', async () => {
    const h = build();
    h.queue.add.mockRejectedValueOnce(new Error('redis down'));
    await expect(h.scheduler.handleDaily()).resolves.toBeUndefined();
  });
});
