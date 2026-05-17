import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailTracksPiiProcessor } from './email-tracks-pii.processor';

function build() {
  const tracking = {
    purgePiiBatch: vi.fn(),
  };
  const processor = new EmailTracksPiiProcessor(tracking as never);
  return { processor, tracking };
}

beforeEach(() => vi.clearAllMocks());

describe('EmailTracksPiiProcessor.process', () => {
  it('exits cleanly when first batch returns 0 (no work)', async () => {
    const h = build();
    h.tracking.purgePiiBatch.mockResolvedValueOnce(0);
    await h.processor.process({ name: 'purge', data: { localDate: '2026-05-17' } } as never);
    expect(h.tracking.purgePiiBatch).toHaveBeenCalledTimes(1);
  });

  it('loops batches until purgePiiBatch returns 0', async () => {
    const h = build();
    h.tracking.purgePiiBatch
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(450)
      .mockResolvedValueOnce(0);
    await h.processor.process({ name: 'purge', data: { localDate: '2026-05-17' } } as never);
    expect(h.tracking.purgePiiBatch).toHaveBeenCalledTimes(4);
    // Args: olderThanDays=90, batchSize=1000
    expect(h.tracking.purgePiiBatch.mock.calls[0]).toEqual([90, 1000]);
  });

  it('ignores unknown job names', async () => {
    const h = build();
    await h.processor.process({ name: 'WRONG', data: {} } as never);
    expect(h.tracking.purgePiiBatch).not.toHaveBeenCalled();
  });

  it('bounded at MAX_BATCHES_PER_RUN to avoid infinite loops on edge cases', async () => {
    const h = build();
    // Always return >0 — without the bound this would spin forever
    h.tracking.purgePiiBatch.mockResolvedValue(1000);
    await h.processor.process({ name: 'purge', data: { localDate: '2026-05-17' } } as never);
    // 200 batches cap (private static MAX_BATCHES_PER_RUN)
    expect(h.tracking.purgePiiBatch).toHaveBeenCalledTimes(200);
  });
});
