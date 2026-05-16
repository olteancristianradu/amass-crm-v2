/**
 * Tests for the IndexedDB offline mutation queue.
 *
 * We import fake-indexeddb/auto BEFORE `./offline-queue` so the module-level
 * `openDB` call lands on the in-memory polyfill instead of jsdom's empty
 * `indexedDB`. Order matters — top-level side-effect import.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetForTests,
  dequeue,
  enqueue,
  incrementAttempt,
  peekAll,
  type QueuedMutation,
} from './offline-queue';

describe('offline-queue (IndexedDB)', () => {
  beforeEach(async () => {
    await _resetForTests();
  });

  it('enqueue + peekAll returns rows in insertion order with assigned ids', async () => {
    const a = await enqueue({ method: 'POST', url: '/api/v1/deals', body: { title: 'a' } });
    const b = await enqueue({ method: 'PATCH', url: '/api/v1/deals/1', body: { stage: 'WON' } });
    const c = await enqueue({ method: 'DELETE', url: '/api/v1/deals/2', body: undefined });

    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);

    const rows = await peekAll();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.method)).toEqual(['POST', 'PATCH', 'DELETE']);
    expect(rows[0]?.body).toEqual({ title: 'a' });
    // attempts initialise to 0; createdAt is set server-side (ms epoch).
    for (const row of rows) {
      expect(row.attempts).toBe(0);
      expect(row.createdAt).toBeGreaterThan(0);
      expect(row.lastError).toBeUndefined();
    }
  });

  it('dequeue removes the matching id and leaves the rest', async () => {
    const a = await enqueue({ method: 'POST', url: '/api/v1/x', body: {} });
    const b = await enqueue({ method: 'POST', url: '/api/v1/y', body: {} });

    await dequeue(a);
    const rows = await peekAll();
    expect(rows.map((r) => r.id)).toEqual([b]);
  });

  it('incrementAttempt increments counter and stores truncated error', async () => {
    const id = await enqueue({ method: 'POST', url: '/api/v1/x', body: {} });
    await incrementAttempt(id, 'NetworkError: connection refused');
    await incrementAttempt(id, 'NetworkError: still down');

    const rows = await peekAll();
    const row = rows.find((r): r is QueuedMutation => r.id === id);
    expect(row?.attempts).toBe(2);
    expect(row?.lastError).toBe('NetworkError: still down');
  });

  it('incrementAttempt is a no-op for missing ids (defensive, drains gracefully)', async () => {
    // No throw — replay logic may race with manual queue clears.
    await expect(incrementAttempt(99999, 'lost')).resolves.toBeUndefined();
    const rows = await peekAll();
    expect(rows).toHaveLength(0);
  });

  it('truncates long error messages to 500 chars to keep rows small', async () => {
    const id = await enqueue({ method: 'POST', url: '/api/v1/x', body: {} });
    const huge = 'x'.repeat(2000);
    await incrementAttempt(id, huge);
    const rows = await peekAll();
    expect(rows[0]?.lastError?.length).toBe(500);
  });

  it('concurrent enqueues do not collide on id (each gets a distinct primary key)', async () => {
    const ids = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        enqueue({ method: 'POST', url: `/api/v1/x/${i}`, body: { i } }),
      ),
    );
    expect(new Set(ids).size).toBe(10);
    const rows = await peekAll();
    expect(rows).toHaveLength(10);
    // FIFO: rows in id-ascending order match insertion order.
    const sortedIds = [...ids].sort((a, b) => a - b);
    expect(rows.map((r) => r.id)).toEqual(sortedIds);
  });

  it('persists optional headers verbatim for the replay path', async () => {
    const id = await enqueue({
      method: 'PATCH',
      url: '/api/v1/deals/1',
      body: { stage: 'WON' },
      headers: { 'X-Idempotency-Key': 'abc-123' },
    });
    const rows = await peekAll();
    const row = rows.find((r) => r.id === id);
    expect(row?.headers).toEqual({ 'X-Idempotency-Key': 'abc-123' });
  });
});
